import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfiguredWorkerRunner } from '../src/agent/WorkerRunner'
import type { WorkerContextBundle } from '../src/runtime/workerContextStager'

const temporaryRoots: string[] = []
afterEach(() =>
  Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
)

describe('ConfiguredWorkerRunner', () => {
  test('returns one natural-language Report as semantic output', async () => {
    const fixture = await createFixture()
    const result = await runner(
      'await Bun.write(process.env.HOPI_REPORT_FILE, "Implemented and checked.\\n")',
    ).run(fixture.input('isolated_write'))
    expect(result).toEqual({
      reportMarkdown: 'Implemented and checked.',
      artifacts: [],
      exitCode: 0,
      termination: 'normal',
    })
  })

  test('settles process failures factually', async () => {
    const fixture = await createFixture()
    const result = await runner('console.error("provider failed"); process.exit(7)').run(
      fixture.input('read_only'),
    )
    expect(result).toMatchObject({ termination: 'crashed', exitCode: 7 })
    expect(result.reportMarkdown).toContain('provider failed')
  })

  test('enforces read-only source and canonical .hopi boundaries', async () => {
    const readOnly = await createFixture()
    expect(
      (await runner('await Bun.write("source.ts", "changed\\n")').run(readOnly.input('read_only')))
        .termination,
    ).toBe('crashed')
    const canonical = await createFixture()
    const result = await runner('await Bun.write(".hopi/forbidden.md", "bad\\n")').run(
      canonical.input('isolated_write'),
    )
    expect(result.reportMarkdown).toContain('modified canonical .hopi content')
  })
})

function runner(code: string) {
  return new ConfiguredWorkerRunner({
    resolveConfig: () => ({ cmd: ['bun', '-e', code], cwdMode: 'worktree' }),
  })
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'hopi-worker-runner-'))
  temporaryRoots.push(root)
  const repoRoot = join(root, 'repo')
  const runRoot = join(root, 'run')
  await mkdir(join(repoRoot, '.hopi'), { recursive: true })
  await mkdir(join(runRoot, 'output-artifacts'), { recursive: true })
  await Bun.write(join(repoRoot, 'source.ts'), 'original\n')
  await Bun.write(join(repoRoot, '.hopi', 'canonical.md'), 'authority\n')
  await git(repoRoot, ['init', '-b', 'main'])
  await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
  await git(repoRoot, ['add', '.'])
  await git(repoRoot, ['commit', '-m', 'initial'])
  const context: WorkerContextBundle = {
    runRoot,
    artifactOutputDir: join(runRoot, 'output-artifacts'),
    runtimeScratchDir: join(runRoot, 'scratch'),
    runtimeCacheDir: join(root, 'cache'),
    contextRoot: join(runRoot, 'context'),
    authorityRoot: join(runRoot, 'context', 'authority'),
    primaryRepoRoot: repoRoot,
    reportFile: join(runRoot, 'report.md'),
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
    input(workspaceMode: 'none' | 'read_only' | 'isolated_write') {
      return {
        projectId: 'P-1',
        goalId: 'G-1',
        workId: 'W-1',
        runId: `R-${crypto.randomUUID()}`,
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
