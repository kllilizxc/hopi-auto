import { cp, mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { WorktreeManager } from '../runtime/worktreeManager'
import type { TaskKind } from '../domain/board'
import type { GoalWriteTraceEntry } from '../runtime/writeTrace'
import { type WriteTraceRecorder, createWriteTraceRecorder } from '../runtime/writeTraceRecorder'
import type {
  AgentOutcome,
  AgentRunObserver,
  AgentRunner,
  AgentStepInput,
} from './AgentRunner'
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
  canonicalOutcomeFile?: string
  browserHarnessArtifactDir?: string
  canonicalBrowserHarnessArtifactDir?: string
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

    if (command.outcomeFile) {
      await mkdir(dirname(command.outcomeFile), { recursive: true })
    }
    if (command.browserHarnessArtifactDir) {
      await mkdir(command.browserHarnessArtifactDir, { recursive: true })
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
    await observer?.onHeartbeat?.()
    const heartbeatTimer = setInterval(() => {
      void observer?.onHeartbeat?.()
    }, 10_000)
    if (command.stdin !== undefined && child.stdin) {
      child.stdin.write(command.stdin)
      child.stdin.end()
    }

    const stdoutLines: string[] = []
    const stderrLines: string[] = []
    const beforeSnapshot = await this.writeTraceRecorder.snapshot(cwd, {
      followHopiSymlink: shouldTrackDurableGoalDocs(input, command.cwdMode),
    })

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

    try {
      const exitCode = await exitCodePromise
      const afterSnapshot = await this.writeTraceRecorder.snapshot(cwd, {
        followHopiSymlink: shouldTrackDurableGoalDocs(input, command.cwdMode),
      })
      const traceEntry = await this.writeTraceRecorder.recordProcessExecution({
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
      if (command.cwdMode === 'worktree' && traceEntry) {
        assertAllowedWorkflowWrites({
          role: input.role,
          taskKind: input.taskKind,
          entry: traceEntry,
        })
      }
      await syncBrowserHarnessArtifacts(command)

      if (exitCode === 0) {
        const structuredOutcome = await readStructuredOutcome(
          command.outcomeFile,
          command.canonicalOutcomeFile,
        )
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
    } finally {
      clearInterval(heartbeatTimer)
    }
  }
}

async function syncBrowserHarnessArtifacts(command: ProcessAgentCommand) {
  if (
    !command.browserHarnessArtifactDir ||
    !command.canonicalBrowserHarnessArtifactDir ||
    command.browserHarnessArtifactDir === command.canonicalBrowserHarnessArtifactDir
  ) {
    return
  }

  if (!(await pathExists(command.browserHarnessArtifactDir))) {
    return
  }

  await mkdir(command.canonicalBrowserHarnessArtifactDir, { recursive: true })
  await cp(command.browserHarnessArtifactDir, command.canonicalBrowserHarnessArtifactDir, {
    recursive: true,
    force: true,
  })
}

async function pathExists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

interface StructuredOutcomeFile {
  kind: 'success' | 'reject' | 'merge_conflict' | 'fail' | 'timeout'
  reason?: string
  artifactRef?: string
  artifactLabel?: string
}

async function readStructuredOutcome(
  outcomeFile: string | undefined,
  canonicalOutcomeFile?: string,
) {
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

  if (canonicalOutcomeFile && canonicalOutcomeFile !== outcomeFile) {
    await mkdir(dirname(canonicalOutcomeFile), { recursive: true })
    await Bun.write(canonicalOutcomeFile, raw)
  }

  return JSON.parse(raw) as StructuredOutcomeFile
}

function assertAllowedWorkflowWrites(options: {
  role: AgentStepInput['role']
  taskKind: TaskKind
  entry: GoalWriteTraceEntry
}) {
  const forbidden = options.entry.changes
    .map((change) => classifyWorkflowWrite(change.path, options.role, options.taskKind))
    .filter((result): result is Exclude<typeof result, null> => result !== null)
    .map((result) => `${result.path}: ${result.reason}`)

  if (forbidden.length === 0) {
    return
  }

  throw new Error(
    `forbidden ${options.role} worktree writes detected: ${forbidden.join(', ')}`,
  )
}

function classifyWorkflowWrite(path: string, role: AgentStepInput['role'], taskKind: TaskKind) {
  if (path.startsWith('.hopi-runtime/')) {
    return null
  }

  if (path.startsWith('.hopi/docs/')) {
    if (role === 'planner' && taskKind === 'planning') {
      return null
    }
    return {
      path,
      reason: 'workflow roles other than planner may not edit durable Goal docs',
    }
  }

  if (path === '.hopi/preference.md') {
    return {
      path,
      reason: 'workflow roles may not edit durable preferences',
    }
  }

  if (path.startsWith('.hopi/')) {
    return {
      path,
      reason: 'workflow roles may not edit runtime-owned .hopi state from worktrees',
    }
  }

  if (role === 'planner') {
    return {
      path,
      reason: 'planner may edit only .hopi/docs/** and step-local runtime output',
    }
  }

  if (path.startsWith('scripts/hopi/browser-harness/')) {
    if ((role === 'generator' || role === 'merger') && taskKind === 'engineering') {
      return null
    }
    return {
      path,
      reason: 'only engineering generator or merger may edit scripts/hopi/browser-harness/**',
    }
  }

  if (path.startsWith('scripts/hopi/')) {
    if (role === 'merger' && taskKind === 'engineering') {
      return null
    }
    return {
      path,
      reason: 'only engineering merger may edit non-browser scripts/hopi/**',
    }
  }

  return null
}

function shouldTrackDurableGoalDocs(
  input: Pick<AgentStepInput, 'role' | 'taskKind'>,
  cwdMode: ProcessAgentCommand['cwdMode'],
) {
  return cwdMode === 'worktree' && input.role === 'planner' && input.taskKind === 'planning'
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
