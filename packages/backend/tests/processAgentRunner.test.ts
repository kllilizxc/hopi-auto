import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentRuntimeEvent } from '../src/agent/AgentRunner'
import { ProcessAgentRunner } from '../src/agent/ProcessAgentRunner'
import { createWorktreeManager } from '../src/runtime/worktreeManager'
import { createWriteTraceStore } from '../src/runtime/writeTraceStore'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'process-agent-runner')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('ProcessAgentRunner', () => {
  test('runs commands in the repo root when root mode is selected', async () => {
    const rootDir = await initGitRepo(testRoot())
    const runner = new ProcessAgentRunner({
      rootDir,
      worktrees: createWorktreeManager(rootDir),
      resolveCommand() {
        return {
          cmd: ['bun', '-e', 'console.log(process.cwd())'],
          cwdMode: 'root',
        }
      },
    })

    const events: AgentRuntimeEvent[] = []
    const result = await runner.run(stepInput(), {
      onEvent(event) {
        events.push(event)
      },
    })

    expect(result).toEqual({ kind: 'success' })
    expect(events).toEqual([
      {
        kind: 'message',
        level: 'info',
        role: 'generator',
        content: rootDir,
      },
    ])
    await expect(createWriteTraceStore(rootDir).readGoalTrace('goal-1')).resolves.toEqual({
      goalKey: 'goal-1',
      entries: [],
    })
  })

  test('prepares a worktree, executes inside it, and streams stdout and stderr', async () => {
    const rootDir = await initGitRepo(testRoot())
    const worktrees = createWorktreeManager(rootDir)
    const runner = new ProcessAgentRunner({
      rootDir,
      worktrees,
      resolveCommand() {
        return {
          cmd: [
            'bun',
            '-e',
            "await Bun.write('marker.txt', process.cwd()); console.log('hello from stdout'); console.error('hello from stderr')",
          ],
          cwdMode: 'worktree',
          successArtifactRef: 'patch:T-1',
        }
      },
    })

    const events: AgentRuntimeEvent[] = []
    const result = await runner.run(stepInput(), {
      onEvent(event) {
        events.push(event)
      },
    })

    expect(result).toEqual({ kind: 'success', artifactRef: 'patch:T-1' })
    const prepared = events[0]
    expect(prepared).toMatchObject({
      kind: 'worktree_prepared',
      baseBranch: 'HEAD',
    })
    if (!prepared || prepared.kind !== 'worktree_prepared') {
      throw new Error('Expected worktree_prepared event')
    }

    expect(await pathExists(join(prepared.path, 'marker.txt'))).toBeTrue()
    expect(await readFile(join(prepared.path, 'marker.txt'), 'utf8')).toBe(prepared.path)
    expect(events.slice(1)).toEqual([
      {
        kind: 'message',
        level: 'info',
        role: 'generator',
        content: 'hello from stdout',
      },
      {
        kind: 'message',
        level: 'error',
        role: 'generator',
        content: 'hello from stderr',
      },
      {
        kind: 'artifact',
        ref: 'patch:T-1',
        label: 'Process output',
      },
    ])
    await expect(createWriteTraceStore(rootDir).readGoalTrace('goal-1')).resolves.toMatchObject({
      goalKey: 'goal-1',
      entries: [
        {
          runId: 'run-1',
          stepId: 'step-1',
          taskRef: 'T-1',
          role: 'generator',
          agent: 'process_runner',
          toolName: 'process',
          callId: 'step-1',
          targetPaths: ['marker.txt'],
          changes: [{ path: 'marker.txt', kind: 'added' }],
        },
      ],
    })
  })

  test('maps non-zero exits to fail outcomes with stderr context', async () => {
    const rootDir = await initGitRepo(testRoot())
    const runner = new ProcessAgentRunner({
      rootDir,
      worktrees: createWorktreeManager(rootDir),
      resolveCommand() {
        return {
          cmd: ['bun', '-e', "console.error('adapter crashed'); process.exit(7)"],
          cwdMode: 'root',
        }
      },
    })

    const events: AgentRuntimeEvent[] = []
    const result = await runner.run(stepInput(), {
      onEvent(event) {
        events.push(event)
      },
    })

    expect(result).toEqual({
      kind: 'fail',
      reason: 'process exited with code 7: adapter crashed',
    })
    expect(events).toEqual([
      {
        kind: 'message',
        level: 'error',
        role: 'generator',
        content: 'adapter crashed',
      },
    ])
  })

  test('parses a typed structured outcome file on successful exit', async () => {
    const rootDir = await initGitRepo(testRoot())
    const outcomeFile = join(rootDir, '.hopi', 'runtime', 'outcome.json')
    const runner = new ProcessAgentRunner({
      rootDir,
      worktrees: createWorktreeManager(rootDir),
      resolveCommand() {
        return {
          cmd: [
            'bun',
            '-e',
            `await Bun.write(${JSON.stringify(outcomeFile)}, JSON.stringify({ kind: 'reject', reason: 'needs tests', artifactRef: 'review:T-1', artifactLabel: 'Review notes' }))`,
          ],
          cwdMode: 'root',
          outcomeFile,
        }
      },
    })

    const events: AgentRuntimeEvent[] = []
    const result = await runner.run(
      {
        ...stepInput(),
        role: 'reviewer',
      },
      {
        onEvent(event) {
          events.push(event)
        },
      },
    )

    expect(result).toEqual({
      kind: 'reject',
      reason: 'needs tests',
      artifactRef: 'review:T-1',
    })
    expect(events).toContainEqual({
      kind: 'artifact',
      ref: 'review:T-1',
      label: 'Review notes',
    })
  })

  test('records planner writes under .hopi/docs through the worktree symlink', async () => {
    const rootDir = await initGitRepo(testRoot())
    await mkdir(join(rootDir, '.hopi', 'docs', 'goals', 'goal-1'), { recursive: true })
    await writeFile(join(rootDir, '.hopi', 'docs', 'goals', 'goal-1', 'design.md'), 'before\n', 'utf8')
    const runner = new ProcessAgentRunner({
      rootDir,
      worktrees: createWorktreeManager(rootDir),
      resolveCommand() {
        return {
          cmd: ['bun', '-e', "await Bun.write('.hopi/docs/goals/goal-1/design.md', 'after\\n')"],
          cwdMode: 'worktree',
        }
      },
    })

    await expect(
      runner.run({
        ...stepInput(),
        taskKind: 'planning',
        role: 'planner',
      }),
    ).resolves.toEqual({ kind: 'success' })

    await expect(Bun.file(join(rootDir, '.hopi', 'docs', 'goals', 'goal-1', 'design.md')).text()).resolves.toBe(
      'after\n',
    )
    await expect(createWriteTraceStore(rootDir).readGoalTrace('goal-1')).resolves.toMatchObject({
      goalKey: 'goal-1',
      entries: [
        {
          role: 'planner',
          targetPaths: ['.hopi/docs/goals/goal-1/design.md'],
          changes: [{ path: '.hopi/docs/goals/goal-1/design.md', kind: 'modified' }],
        },
      ],
    })
  })

  test('ignores concurrent Goal-doc drift while tracing non-planner worktree writes', async () => {
    const rootDir = await initGitRepo(testRoot())
    await mkdir(join(rootDir, '.hopi', 'docs', 'goals', 'goal-1'), { recursive: true })
    const todoPath = join(rootDir, '.hopi', 'docs', 'goals', 'goal-1', 'todo.yml')
    await writeFile(todoPath, 'version: 1\ngoal:\n  goalKey: goal-1\n  title: Goal 1\nitems: []\n', 'utf8')

    const runner = new ProcessAgentRunner({
      rootDir,
      worktrees: createWorktreeManager(rootDir),
      resolveCommand() {
        return {
          cmd: [
            'bun',
            '-e',
            "await new Promise((resolve) => setTimeout(resolve, 100)); await Bun.write('marker.txt', 'ok\\n')",
          ],
          cwdMode: 'worktree',
        }
      },
    })

    const drift = new Promise<void>((resolve) => {
      setTimeout(async () => {
        await Bun.write(
          todoPath,
          'version: 1\ngoal:\n  goalKey: goal-1\n  title: Goal 1\nitems:\n  - ref: T-1\n    kind: engineering\n    status: planned\n    title: Task T-1\n    blockedBy: []\n',
        )
        resolve()
      }, 20)
    })

    await expect(runner.run(stepInput())).resolves.toEqual({ kind: 'success' })
    await drift
    await expect(createWriteTraceStore(rootDir).readGoalTrace('goal-1')).resolves.toMatchObject({
      goalKey: 'goal-1',
      entries: [
        {
          role: 'generator',
          targetPaths: ['marker.txt'],
          changes: [{ path: 'marker.txt', kind: 'added' }],
        },
      ],
    })
  })

  test('allows generator to create project Browser Harness scenarios in its worktree', async () => {
    const rootDir = await initGitRepo(testRoot())
    const runner = new ProcessAgentRunner({
      rootDir,
      worktrees: createWorktreeManager(rootDir),
      resolveCommand() {
        return {
          cmd: [
            'bun',
            '-e',
            "await Bun.write('scripts/hopi/browser-harness/scenarios/layout.py', 'print(\"ok\")\\n')",
          ],
          cwdMode: 'worktree',
        }
      },
    })

    await expect(runner.run(stepInput())).resolves.toEqual({ kind: 'success' })
    await expect(createWriteTraceStore(rootDir).readGoalTrace('goal-1')).resolves.toMatchObject({
      entries: [
        {
          role: 'generator',
          targetPaths: ['scripts/hopi/browser-harness/scenarios/layout.py'],
        },
      ],
    })
  })

  test('fails closed when planner creates project Browser Harness scenarios', async () => {
    const rootDir = await initGitRepo(testRoot())
    const runner = new ProcessAgentRunner({
      rootDir,
      worktrees: createWorktreeManager(rootDir),
      resolveCommand() {
        return {
          cmd: [
            'bun',
            '-e',
            "await Bun.write('scripts/hopi/browser-harness/scenarios/layout.py', 'print(\"planner\")\\n')",
          ],
          cwdMode: 'worktree',
        }
      },
    })

    await expect(
      runner.run({
        ...stepInput(),
        taskKind: 'planning',
        role: 'planner',
      }),
    ).rejects.toThrow('forbidden planner worktree writes detected')
  })

  test('syncs Browser Harness artifacts from worktree runtime to canonical runtime', async () => {
    const rootDir = await initGitRepo(testRoot())
    const worktreeArtifactDir = join(
      rootDir,
      '.hopi',
      'worktrees',
      'goal-1',
      'T-1',
      'run-1',
      '.hopi-runtime',
      'goals',
      'goal-1',
      'runs',
      'run-1',
      'step-1',
      'browser-harness',
    )
    const canonicalArtifactDir = join(
      rootDir,
      '.hopi',
      'runtime',
      'goals',
      'goal-1',
      'runs',
      'run-1',
      'step-1',
      'browser-harness',
    )
    const runner = new ProcessAgentRunner({
      rootDir,
      worktrees: createWorktreeManager(rootDir),
      resolveCommand() {
        return {
          cmd: [
            'bun',
            '-e',
            "await Bun.write(`${process.env.HOPI_BROWSER_HARNESS_ARTIFACT_DIR}/layout.txt`, 'verified\\n')",
          ],
          cwdMode: 'worktree',
          browserHarnessArtifactDir: worktreeArtifactDir,
          canonicalBrowserHarnessArtifactDir: canonicalArtifactDir,
          env: {
            HOPI_BROWSER_HARNESS_ARTIFACT_DIR: worktreeArtifactDir,
          },
        }
      },
    })

    await expect(runner.run(stepInput())).resolves.toEqual({ kind: 'success' })
    await expect(Bun.file(join(canonicalArtifactDir, 'layout.txt')).text()).resolves.toBe(
      'verified\n',
    )
  })

  test('records a durable write trace for root-mode file writes', async () => {
    const rootDir = await initGitRepo(testRoot())
    const runner = new ProcessAgentRunner({
      rootDir,
      worktrees: createWorktreeManager(rootDir),
      resolveCommand() {
        return {
          cmd: ['bun', '-e', "await Bun.write('generated.txt', 'root mode output')"],
          cwdMode: 'root',
        }
      },
    })

    await expect(runner.run(stepInput())).resolves.toEqual({ kind: 'success' })
    await expect(createWriteTraceStore(rootDir).readGoalTrace('goal-1')).resolves.toMatchObject({
      goalKey: 'goal-1',
      entries: [
        {
          runId: 'run-1',
          stepId: 'step-1',
          taskRef: 'T-1',
          role: 'generator',
          targetPaths: ['generated.txt'],
          changes: [{ path: 'generated.txt', kind: 'added' }],
          resultSummary: 'exit 0 (1 changed file)',
        },
      ],
    })
  })

  test('pipes stdin content into the child process when provided by the transport', async () => {
    const rootDir = await initGitRepo(testRoot())
    const runner = new ProcessAgentRunner({
      rootDir,
      worktrees: createWorktreeManager(rootDir),
      resolveCommand() {
        return {
          cmd: ['bun', '-e', "await Bun.write('stdin.txt', await Bun.stdin.text())"],
          cwdMode: 'root',
          stdin: 'Prompt from built-in transport',
        }
      },
    })

    await expect(runner.run(stepInput())).resolves.toEqual({ kind: 'success' })
    await expect(Bun.file(join(rootDir, 'stdin.txt')).text()).resolves.toBe(
      'Prompt from built-in transport',
    )
  })

  test('normalizes Codex JSONL stdout into transcript events instead of raw messages', async () => {
    const rootDir = await initGitRepo(testRoot())
    const outcomeFile = join(rootDir, '.hopi', 'runtime', 'outcome.json')
    const runner = new ProcessAgentRunner({
      rootDir,
      worktrees: createWorktreeManager(rootDir),
      resolveCommand() {
        return {
          cmd: [
            'bun',
            '-e',
            `console.log(JSON.stringify({ method: 'item/completed', params: { item: { type: 'agent_message', text: 'Implemented the patch' } } })); console.log(JSON.stringify({ method: 'item/completed', params: { item: { type: 'local_shell_call', tool_name: 'Bash' } } })); await Bun.write(${JSON.stringify(outcomeFile)}, JSON.stringify({ kind: 'success', artifactRef: 'patch:T-1' }))`,
          ],
          cwdMode: 'root',
          outcomeFile,
          transcriptFormat: 'codex_jsonl',
        }
      },
    })

    const events: AgentRuntimeEvent[] = []
    const result = await runner.run(stepInput(), {
      onEvent(event) {
        events.push(event)
      },
    })

    expect(result).toEqual({ kind: 'success', artifactRef: 'patch:T-1' })
    expect(events).toEqual([
      {
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'assistant',
        summary: 'Implemented the patch',
        vendorEventType: 'item/completed',
      },
      {
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'tool_call',
        toolName: 'Bash',
        summary: 'Tool call: Bash',
        vendorEventType: 'item/completed',
      },
      {
        kind: 'artifact',
        ref: 'patch:T-1',
        label: 'Process output',
      },
    ])
  })

})

function stepInput() {
  return {
    goalKey: 'goal-1',
    runId: 'run-1',
    stepId: 'step-1',
    taskRef: 'T-1',
    taskKind: 'engineering' as const,
    role: 'generator' as const,
  }
}

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}

async function initGitRepo(rootDir: string) {
  await mkdir(rootDir, { recursive: true })
  await git(rootDir, ['init'])
  await git(rootDir, ['config', 'user.name', 'HOPI Tests'])
  await git(rootDir, ['config', 'user.email', 'hopi@example.com'])
  await writeFile(join(rootDir, 'README.md'), '# test repo\n', 'utf8')
  await git(rootDir, ['add', 'README.md'])
  await git(rootDir, ['commit', '-m', 'init'])
  return rootDir
}

async function git(cwd: string, args: string[]) {
  const command = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(command.stdout).text(),
    new Response(command.stderr).text(),
    command.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`)
  }

  return stdout.trim()
}

async function pathExists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
