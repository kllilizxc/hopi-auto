import type { WorktreeManager } from '../runtime/worktreeManager'
import { type WriteTraceRecorder, createWriteTraceRecorder } from '../runtime/writeTraceRecorder'
import type { AgentOutcome, AgentRunObserver, AgentRunner, AgentStepInput } from './AgentRunner'
import { type ProcessTranscriptFormat, normalizeProcessOutputLine } from './vendorTranscript'

export interface ProcessAgentCommand {
  cmd: string[]
  cwdMode: 'root' | 'worktree'
  stdin?: string
  transcriptFormat?: ProcessTranscriptFormat
  env?: Record<string, string>
  baseRef?: string
  successArtifactRef?: string
  successArtifactLabel?: string
  outcomeFile?: string
}

export interface ProcessAgentRunnerOptions {
  rootDir?: string
  worktrees: WorktreeManager
  writeTraceRecorder?: WriteTraceRecorder
  resolveCommand(input: AgentStepInput): ProcessAgentCommand | Promise<ProcessAgentCommand>
}

export class ProcessAgentRunner implements AgentRunner {
  private readonly rootDir: string
  private readonly worktrees: WorktreeManager
  private readonly writeTraceRecorder: WriteTraceRecorder
  private readonly resolveCommand: ProcessAgentRunnerOptions['resolveCommand']

  constructor(options: ProcessAgentRunnerOptions) {
    this.rootDir = options.rootDir ?? process.cwd()
    this.worktrees = options.worktrees
    this.writeTraceRecorder = options.writeTraceRecorder ?? createWriteTraceRecorder(this.rootDir)
    this.resolveCommand = options.resolveCommand
  }

  async run(input: AgentStepInput, observer?: AgentRunObserver): Promise<AgentOutcome> {
    const command = await this.resolveCommand(input)
    let cwd = this.rootDir

    if (command.cwdMode === 'worktree') {
      const prepared = await this.worktrees.prepare({
        goalKey: input.goalKey,
        taskRef: input.taskRef,
        runId: input.runId,
        baseRef: command.baseRef,
      })
      cwd = prepared.path
      await observer?.onEvent?.({
        kind: 'worktree_prepared',
        path: prepared.path,
        branch: prepared.branch,
        baseBranch: prepared.baseRef,
      })
    }

    const child = Bun.spawn(command.cmd, {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: command.stdin === undefined ? 'ignore' : 'pipe',
      env: {
        ...process.env,
        ...command.env,
      },
    })
    if (command.stdin !== undefined && child.stdin) {
      child.stdin.write(command.stdin)
      child.stdin.end()
    }

    const stdoutLines: string[] = []
    const stderrLines: string[] = []
    const beforeSnapshot = await this.writeTraceRecorder.snapshot(cwd)

    const exitCodePromise = child.exited
    await Promise.all([
      consumeTextLines(child.stdout, async (line) => {
        stdoutLines.push(line)
        for (const event of normalizeProcessOutputLine({
          format: command.transcriptFormat ?? 'plain',
          stream: 'stdout',
          role: input.role,
          line,
        })) {
          await observer?.onEvent?.(event)
        }
      }),
      consumeTextLines(child.stderr, async (line) => {
        stderrLines.push(line)
        for (const event of normalizeProcessOutputLine({
          format: command.transcriptFormat ?? 'plain',
          stream: 'stderr',
          role: input.role,
          line,
        })) {
          await observer?.onEvent?.(event)
        }
      }),
    ])

    const exitCode = await exitCodePromise
    const afterSnapshot = await this.writeTraceRecorder.snapshot(cwd)
    await this.writeTraceRecorder.recordProcessExecution({
      goalKey: input.goalKey,
      runId: input.runId,
      stepId: input.stepId,
      taskRef: input.taskRef,
      role: input.role,
      cwd,
      command: command.cmd,
      exitCode,
      before: beforeSnapshot,
      after: afterSnapshot,
    })

    if (exitCode === 0) {
      const structuredOutcome = await readStructuredOutcome(command.outcomeFile)
      if (structuredOutcome) {
        if (structuredOutcome.artifactRef) {
          await observer?.onEvent?.({
            kind: 'artifact',
            ref: structuredOutcome.artifactRef,
            label: structuredOutcome.artifactLabel ?? 'Process output',
          })
        }

        return structuredOutcomeToAgentOutcome(structuredOutcome)
      }

      if (command.successArtifactRef) {
        await observer?.onEvent?.({
          kind: 'artifact',
          ref: command.successArtifactRef,
          label: command.successArtifactLabel ?? 'Process output',
        })
      }

      return {
        kind: 'success',
        artifactRef: command.successArtifactRef,
      }
    }

    const detail = stderrLines.at(-1) ?? stdoutLines.at(-1)
    return {
      kind: 'fail',
      reason: detail
        ? `process exited with code ${exitCode}: ${detail}`
        : `process exited with code ${exitCode}`,
    }
  }
}

interface StructuredOutcomeFile {
  kind: 'success' | 'reject' | 'merge_conflict' | 'fail' | 'timeout'
  reason?: string
  artifactRef?: string
  artifactLabel?: string
}

async function readStructuredOutcome(outcomeFile: string | undefined) {
  if (!outcomeFile) {
    return null
  }

  const file = Bun.file(outcomeFile)
  if (!(await file.exists())) {
    return null
  }

  const raw = await file.text()
  if (raw.trim() === '') {
    return null
  }

  return JSON.parse(raw) as StructuredOutcomeFile
}

function structuredOutcomeToAgentOutcome(outcome: StructuredOutcomeFile): AgentOutcome {
  if (outcome.kind === 'success') {
    return {
      kind: 'success',
      artifactRef: outcome.artifactRef,
    }
  }

  if (outcome.kind === 'reject') {
    return {
      kind: 'reject',
      reason: outcome.reason ?? 'review rejected without a reason',
      artifactRef: outcome.artifactRef,
    }
  }

  if (outcome.kind === 'merge_conflict') {
    return {
      kind: 'merge_conflict',
      artifactRef: outcome.artifactRef ?? 'merge_conflict',
    }
  }

  if (outcome.kind === 'timeout') {
    return {
      kind: 'timeout',
      reason: outcome.reason ?? 'process reported timeout',
    }
  }

  return {
    kind: 'fail',
    reason: outcome.reason ?? 'process reported failure',
  }
}

async function consumeTextLines(
  stream: ReadableStream<Uint8Array> | null,
  onLine: (line: string) => Promise<void>,
) {
  if (!stream) {
    return
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffered = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        break
      }

      buffered += decoder.decode(value, { stream: true })
      const lines = buffered.split(/\r?\n/)
      buffered = lines.pop() ?? ''

      for (const line of lines) {
        if (line.length > 0) {
          await onLine(line)
        }
      }
    }

    buffered += decoder.decode()
    if (buffered.length > 0) {
      await onLine(buffered)
    }
  } finally {
    reader.releaseLock()
  }
}
