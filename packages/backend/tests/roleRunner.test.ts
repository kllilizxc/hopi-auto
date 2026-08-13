import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfiguredRoleRunner } from '../src/agent/RoleRunner'
import type { AgentRuntimeEvent } from '../src/agent/runtimeEvents'
import type { RoleContextBundle } from '../src/runtime/roleContextStager'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('ConfiguredRoleRunner', () => {
  test('returns a process Report as the only semantic output', async () => {
    const fixture = await createFixture()
    const runner = processRunner(
      'await Bun.write(process.env.HOPI_REPORT_FILE, "# Report\\n\\nImplemented and checked.\\n")',
    )
    expect(await runner.run(fixture.input('generator', 'isolated_write'))).toEqual({
      reportMarkdown: '# Report\n\nImplemented and checked.',
      artifacts: [],
      exitCode: 0,
      termination: 'normal',
    })
  })

  test('creates a factual fallback Report when a normal process emits no final text', async () => {
    const fixture = await createFixture()
    const result = await processRunner('console.log("work completed")').run(
      fixture.input('planner', 'none'),
    )
    expect(result).toMatchObject({ termination: 'normal', exitCode: 0 })
    expect(result.reportMarkdown).toContain(
      'exited normally without a final natural-language response',
    )
  })

  test('settles nonzero exits and timeouts as facts rather than semantic Work results', async () => {
    const fixture = await createFixture()
    const crashed = await processRunner('console.error("provider failed"); process.exit(7)').run(
      fixture.input('reviewer', 'read_only'),
    )
    expect(crashed).toMatchObject({ termination: 'crashed', exitCode: 7 })
    expect(crashed.reportMarkdown).toContain('provider failed')

    const timedOut = await processRunner('console.error("request timed out"); process.exit(1)').run(
      fixture.input('reviewer', 'read_only'),
    )
    expect(timedOut.termination).toBe('timed_out')
  })

  test('records explicit cancellation and interruption termination', async () => {
    const fixture = await createFixture()
    const cancel = new AbortController()
    const cancelling = processRunner('setInterval(() => {}, 1000)').run({
      ...fixture.input('generator', 'isolated_write'),
      signal: cancel.signal,
    })
    await Bun.sleep(30)
    cancel.abort({ termination: 'cancelled' })
    expect(await cancelling).toMatchObject({ termination: 'cancelled' })

    const interrupt = new AbortController()
    const interrupting = processRunner('setInterval(() => {}, 1000)').run({
      ...fixture.input('generator', 'isolated_write'),
      signal: interrupt.signal,
    })
    await Bun.sleep(30)
    interrupt.abort()
    expect(await interrupting).toMatchObject({ termination: 'interrupted' })
  })

  test('enforces read-only source while allowing isolated_write source changes', async () => {
    const readOnlyFixture = await createFixture()
    const readOnly = await processRunner(
      'await Bun.write("source.ts", "changed\\n"); await Bun.write(process.env.HOPI_REPORT_FILE, "Reviewed.\\n")',
    ).run(readOnlyFixture.input('reviewer', 'read_only'))
    expect(readOnly.termination).toBe('crashed')
    expect(readOnly.reportMarkdown).toContain('read-only Run modified a task worktree')

    const writableFixture = await createFixture()
    const writable = await processRunner(
      'await Bun.write("source.ts", "changed\\n"); await Bun.write(process.env.HOPI_REPORT_FILE, "Implemented.\\n")',
    ).run(writableFixture.input('generator', 'isolated_write'))
    expect(writable).toMatchObject({ termination: 'normal', reportMarkdown: 'Implemented.' })
  })

  test('rejects canonical .hopi writes from Engineering Runs', async () => {
    const fixture = await createFixture()
    const result = await processRunner(
      'await Bun.write(".hopi/forbidden.md", "bad\\n"); await Bun.write(process.env.HOPI_REPORT_FILE, "Implemented.\\n")',
    ).run(fixture.input('generator', 'isolated_write'))
    expect(result.termination).toBe('crashed')
    expect(result.reportMarkdown).toContain('modified canonical .hopi content')
  })

  test('records actual execution identity and redacts inherited secrets', async () => {
    const fixture = await createFixture()
    const previous = process.env.HOPI_TEST_SECRET_TOKEN
    process.env.HOPI_TEST_SECRET_TOKEN = 'top-secret-value'
    const events: AgentRuntimeEvent[] = []
    let execution: unknown
    try {
      const result = await processRunner(
        'console.error(process.env.HOPI_TEST_SECRET_TOKEN); await Bun.write(process.env.HOPI_REPORT_FILE, "Done.\\n")',
      ).run(fixture.input('planner', 'none'), {
        onExecution(value) {
          execution = value
        },
        onEvent(event) {
          events.push(event)
        },
      })
      expect(result.termination).toBe('normal')
      expect(execution).toEqual({ transport: 'process', model: null, reasoningEffort: null })
      expect(await Bun.file(join(fixture.runRoot, 'transcript.log')).text()).toContain(
        '[REDACTED_SECRET]',
      )
      expect(JSON.stringify(events)).not.toContain('top-secret-value')
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, 'HOPI_TEST_SECRET_TOKEN')
      else process.env.HOPI_TEST_SECRET_TOKEN = previous
    }
  })
})

function processRunner(code: string) {
  return new ConfiguredRoleRunner({
    resolveConfig: () => ({ transport: 'process', cwdMode: 'worktree', cmd: ['bun', '-e', code] }),
  })
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'hopi-role-runner-'))
  temporaryRoots.push(root)
  const repoRoot = join(root, 'repo')
  const runRoot = join(root, 'run')
  const runtimeScratchDir = join(runRoot, 'scratch')
  const runtimeCacheDir = join(root, 'cache')
  const reportFile = join(runRoot, 'report.md')
  await mkdir(join(repoRoot, '.hopi'), { recursive: true })
  await mkdir(join(runRoot, 'output-artifacts'), { recursive: true })
  await Bun.write(join(repoRoot, 'source.ts'), 'original\n')
  await Bun.write(join(repoRoot, '.hopi', 'canonical.md'), 'authority\n')
  await git(repoRoot, ['init', '-b', 'main'])
  await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
  await git(repoRoot, ['add', '.'])
  await git(repoRoot, ['commit', '-m', 'initial'])

  const context: RoleContextBundle = {
    runRoot,
    artifactOutputDir: join(runRoot, 'output-artifacts'),
    runtimeScratchDir,
    runtimeCacheDir,
    contextRoot: join(runRoot, 'context'),
    authorityRoot: join(runRoot, 'context', 'authority'),
    primaryRepoRoot: repoRoot,
    reportFile,
    releaseHead: 'a'.repeat(40),
    repoReleaseHeads: { primary: 'a'.repeat(40) },
    repoProjectionHeads: { primary: 'a'.repeat(40) },
    repoProjection: 'candidate',
    goalHash: 'a'.repeat(64),
    workHash: 'b'.repeat(64),
    authorityFiles: [],
    guardFiles: {},
    guardPrefixes: [],
    repoRoots: [{ repoId: 'primary', path: repoRoot, primary: true }],
    reposFile: join(runRoot, 'repos.json'),
    goalFile: join(runRoot, 'goal.md'),
    designFile: join(runRoot, 'design.md'),
    contextFile: join(runRoot, 'context.md'),
    promptFile: join(runRoot, 'prompt.md'),
    browserHarnessDir: 'scripts/hopi/browser-harness',
    browserHarnessArtifactDir: join(runRoot, 'browser-harness'),
    canonicalBrowserHarnessArtifactDir: join(runRoot, 'browser-harness'),
  }
  await Bun.write(context.contextFile, '# Context\n')
  await Bun.write(context.promptFile, '# Prompt\n')

  return {
    repoRoot,
    runRoot,
    input(
      responsibility: 'planner' | 'generator' | 'reviewer',
      workspaceMode: 'none' | 'read_only' | 'isolated_write',
    ) {
      return {
        projectId: 'project-1',
        goalId: 'goal-1',
        workId: 'work-1',
        runId: `R-${crypto.randomUUID()}`,
        responsibility,
        workspaceMode,
        cwd: repoRoot,
        sourceRoots: [repoRoot],
        context,
      } as const
    },
  }
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || stdout)
}
