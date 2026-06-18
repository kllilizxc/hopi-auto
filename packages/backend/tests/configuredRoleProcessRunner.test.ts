import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ConfiguredRoleProcessRunner } from '../src/agent/ConfiguredRoleProcessRunner'
import type { TaskItem } from '../src/domain/board'
import { createWriteTraceStore } from '../src/runtime/writeTraceStore'
import { createBoardStore } from '../src/storage/boardStore'

const goalKey = 'goal-1'
const tmpBase = join(process.cwd(), 'tests', 'tmp', 'configured-role-process-runner')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('ConfiguredRoleProcessRunner', () => {
  test('loads generator config, substitutes context placeholders, and bootstraps goal docs', async () => {
    const rootDir = await initGitRepo(testRoot())
    await seedBoard(rootDir, [
      task({
        ref: 'T-1',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement runtime adapter',
        description: 'Use the configured role runner.',
        acceptanceCriteria: ['Role process receives a context file.'],
      }),
    ])
    await writeAdapterConfig(rootDir, {
      version: 1,
      roles: {
        generator: {
          cmd: [
            'bun',
            '-e',
            "const [contextFile, outcomeFile] = process.argv.slice(1); const context = await Bun.file(contextFile).text(); await Bun.write('generated.txt', context); await Bun.write(outcomeFile, JSON.stringify({ kind: 'success', artifactRef: 'patch:T-1', artifactLabel: 'Generated patch' })); console.log('generated')",
            '${CONTEXT_FILE}',
            '${OUTCOME_FILE}',
          ],
          cwdMode: 'worktree',
        },
      },
    })

    const runner = new ConfiguredRoleProcessRunner({ rootDir })
    const result = await runner.run({
      goalKey,
      runId: 'run-1',
      stepId: 'step-1',
      taskRef: 'T-1',
      taskKind: 'engineering',
      role: 'generator',
    })

    expect(result).toEqual({ kind: 'success', artifactRef: 'patch:T-1' })
    await expect(
      Bun.file(join(rootDir, '.hopi', 'docs', 'goals', goalKey, 'goal.md')).text(),
    ).resolves.toContain('# Goal One')
    await expect(
      Bun.file(join(rootDir, '.hopi', 'docs', 'goals', goalKey, 'design.md')).text(),
    ).resolves.toContain('# Design: Goal One')

    const trace = await createWriteTraceStore(rootDir).readGoalTrace(goalKey)
    expect(trace.entries).toHaveLength(1)
    expect(trace.entries[0]?.taskRef).toBe('T-1')
    expect(trace.entries[0]?.targetPaths).toContain('generated.txt')
    expect(trace.entries[0]?.targetPaths).toContain(
      '.hopi-runtime/goals/goal-1/runs/run-1/step-1/outcome.json',
    )
    expect(trace.entries[0]?.changes).toContainEqual({
      path: 'generated.txt',
      kind: 'added',
    })
    expect(trace.entries[0]?.changes).toContainEqual({
      path: '.hopi-runtime/goals/goal-1/runs/run-1/step-1/outcome.json',
      kind: 'added',
    })
  })

  test('returns typed reviewer rejections from configured role adapters', async () => {
    const rootDir = await initGitRepo(testRoot())
    await seedBoard(rootDir, [
      task({
        ref: 'T-9',
        kind: 'engineering',
        status: 'in_review',
        title: 'Review runtime adapter',
        description: 'Review the generated work.',
        acceptanceCriteria: ['Reviewer can reject work with a reason.'],
      }),
    ])
    await writeAdapterConfig(rootDir, {
      version: 1,
      roles: {
        reviewer: {
          cmd: [
            'bun',
            '-e',
            "const [contextFile, outcomeFile] = process.argv.slice(1); const context = await Bun.file(contextFile).text(); if (!context.includes('Role: reviewer')) throw new Error('missing reviewer context'); await Bun.write(outcomeFile, JSON.stringify({ kind: 'reject', reason: 'needs tests', artifactRef: 'review:T-9', artifactLabel: 'Review notes' }));",
            '${CONTEXT_FILE}',
            '${OUTCOME_FILE}',
          ],
          cwdMode: 'root',
        },
      },
    })

    const runner = new ConfiguredRoleProcessRunner({ rootDir })
    await expect(
      runner.run({
        goalKey,
        runId: 'run-9',
        stepId: 'step-9',
        taskRef: 'T-9',
        taskKind: 'engineering',
        role: 'reviewer',
      }),
    ).resolves.toEqual({
      kind: 'reject',
      reason: 'needs tests',
      artifactRef: 'review:T-9',
    })

    const context = await readFile(
      join(rootDir, '.hopi', 'runtime', 'goals', goalKey, 'runs', 'run-9', 'step-9', 'context.md'),
      'utf8',
    )
    expect(context).toContain('Role: reviewer')
    expect(context).toContain('Do not edit .hopi/docs/**')

    const migrated = JSON.parse(
      await Bun.file(join(rootDir, '.hopi', 'runtime', 'agent-adapters.json')).text(),
    ) as {
      version: number
      defaults?: {
        transport?: string
      }
      roles: {
        reviewer?: {
          cwdMode?: string
        }
      }
    }
    expect(migrated.version).toBe(3)
    expect(migrated.defaults?.transport).toBe('codex')
    expect(migrated.roles.reviewer?.cwdMode).toBe('worktree')
  })

  test('supports the built-in codex transport with a bundled prompt and typed outcome file', async () => {
    const rootDir = await initGitRepo(testRoot())
    await seedBoard(rootDir, [
      task({
        ref: 'T-12',
        kind: 'engineering',
        status: 'planned',
        title: 'Use the built-in codex transport',
        description: 'Resolve a real vendor transport without a hand-authored cmd array.',
        acceptanceCriteria: ['The transport receives prompt.md through stdin.'],
      }),
    ])

    const mockCodexPath = join(rootDir, 'mock-codex')
    await writeFile(
      mockCodexPath,
      `#!/usr/bin/env bun
const prompt = await Bun.stdin.text()
if (!prompt.includes('You are the HOPI generator agent')) {
  console.error('missing prompt header')
  process.exit(12)
}
if (!prompt.includes('## Bundled Context')) {
  console.error('missing bundled context section')
  process.exit(13)
}
await Bun.write('codex-output.txt', prompt)
await Bun.write(
  process.env.HOPI_OUTCOME_FILE!,
  JSON.stringify({
    kind: 'success',
    artifactRef: 'patch:T-12',
    artifactLabel: 'Codex patch',
  }),
)
console.log('mock codex ran')
`,
      'utf8',
    )
    await chmod(mockCodexPath, 0o755)

    await writeAdapterConfig(rootDir, {
      version: 1,
      roles: {
        generator: {
          transport: 'codex',
          binary: mockCodexPath,
          cwdMode: 'worktree',
          sandbox: 'workspace-write',
          approvalPolicy: 'never',
        },
      },
    })

    const runner = new ConfiguredRoleProcessRunner({ rootDir })
    await expect(
      runner.run({
        goalKey,
        runId: 'run-12',
        stepId: 'step-12',
        taskRef: 'T-12',
        taskKind: 'engineering',
        role: 'generator',
      }),
    ).resolves.toEqual({
      kind: 'success',
      artifactRef: 'patch:T-12',
    })

    const prompt = await readFile(
      join(rootDir, '.hopi', 'runtime', 'goals', goalKey, 'runs', 'run-12', 'step-12', 'prompt.md'),
      'utf8',
    )
    expect(prompt).toContain('You are the HOPI generator agent')
    expect(prompt).toContain('Task Ref: T-12')

    const writtenPrompt = await Bun.file(
      join(rootDir, '.hopi', 'worktrees', goalKey, 'T-12', 'run-12', 'codex-output.txt'),
    ).text()
    expect(writtenPrompt).toContain('Use the built-in codex transport')
  })
})

async function seedBoard(rootDir: string, items: TaskItem[]) {
  const store = createBoardStore(rootDir)
  await store.mutateBoard(goalKey, 'test', 'seed board', (board) => {
    board.goal.title = 'Goal One'
    board.items = items
  })
}

async function writeAdapterConfig(rootDir: string, config: unknown) {
  const path = join(rootDir, '.hopi', 'runtime', 'agent-adapters.json')
  await mkdir(join(rootDir, '.hopi', 'runtime'), { recursive: true })
  await Bun.write(path, `${JSON.stringify(config, null, 2)}\n`)
}

function task(overrides: Partial<TaskItem>): TaskItem {
  return {
    ref: 'T-1',
    kind: 'engineering',
    status: 'planned',
    title: 'Task',
    description: 'Do the task',
    acceptanceCriteria: ['Task is complete'],
    blockedBy: [],
    ...overrides,
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
