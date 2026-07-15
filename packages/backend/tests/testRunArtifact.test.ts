import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { LIVE_STEPS, PREFLIGHT_STEPS, aggregateUsage } from './e2e/regression'
import {
  type TestRunCodeProvenance,
  type TestRunContext,
  type TestRunReport,
  collectScreenshotEvidence,
  readTestRun,
  writeTestRunReport,
} from './testRunArtifact'

const CODE: TestRunCodeProvenance = {
  head: 'a'.repeat(40),
  branch: 'main',
  dirty: false,
  status: [],
  worktreeDigest: 'b'.repeat(64),
}

test('one Test Run indexes evidence, derives a gallery, and becomes immutable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hopi-test-run-'))
  const context = runContext(root, 'browser-proof', 'browser')
  try {
    await writeTestRunReport(context, 'running')
    await mkdir(join(root, 'screenshots'), { recursive: true })
    await Bun.write(join(root, 'result.json'), '{"accepted":true}\n')
    await Bun.write(join(root, 'screenshots', 'terminal.png'), new Uint8Array(1_200).fill(7))

    const report = await writeTestRunReport(context, 'passed', {
      resultFile: 'result.json',
      providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
    })
    expect(report).toMatchObject({
      version: 1,
      kind: 'test-run',
      scenario: 'browser-proof',
      claim: 'browser',
      status: 'passed',
      code: CODE,
    })
    expect(report.evidence.map((entry) => [entry.kind, entry.path])).toEqual([
      ['gallery', 'evidence.html'],
      ['file', 'result.json'],
      ['screenshot', 'screenshots/terminal.png'],
    ])
    expect(await Bun.file(join(root, 'evidence.html')).text()).toContain('terminal.png')
    await expect(writeTestRunReport(context, 'failed')).rejects.toThrow(
      'Terminal Test Run is immutable',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('visual review creates a separate Inspection Test Run without mutating its source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hopi-test-review-'))
  const sourceRoot = join(root, 'source')
  const reviewRoot = join(root, 'reviews')
  const context = runContext(sourceRoot, 'visual-source', 'browser')
  try {
    await mkdir(join(sourceRoot, 'screenshots'), { recursive: true })
    await writeTestRunReport(context, 'running')
    await Bun.write(join(sourceRoot, 'screenshots', 'state.png'), new Uint8Array(1_200).fill(9))
    await writeTestRunReport(context, 'passed')
    const sourceBefore = await Bun.file(join(sourceRoot, 'run.json')).text()

    const child = Bun.spawn(
      [
        'bun',
        'run',
        'tests/e2e/recordArtifactReview.ts',
        '--',
        sourceRoot,
        '--result=passed',
        '--note=The expected state is visible.',
      ],
      {
        cwd: resolve(import.meta.dir, '..'),
        env: { ...process.env, HOPI_E2E_ARTIFACT_ROOT: reviewRoot },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(exitCode, `${stdout}\n${stderr}`).toBe(0)
    const reports = await Array.fromAsync(
      new Bun.Glob('*/run.json').scan({ cwd: reviewRoot, onlyFiles: true }),
    )
    expect(reports).toHaveLength(1)
    const reportPath = reports[0]
    if (!reportPath) throw new Error('Visual review did not retain its Test Run')
    const review = await readTestRun(resolve(reviewRoot, reportPath, '..'))
    expect(review).toMatchObject({
      claim: 'inspection',
      status: 'passed',
      source: { artifactRoot: sourceRoot, scenario: 'visual-source' },
      review: { result: 'passed', note: 'The expected state is visible.' },
      providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
    })
    const reviewedScreenshot = (review.review as { screenshots: Array<{ sha256: string }> })
      .screenshots[0]
    expect(reviewedScreenshot?.sha256).toHaveLength(64)
    expect(await Bun.file(join(sourceRoot, 'run.json')).text()).toBe(sourceBefore)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Regression profiles stay linear and keep real models out of preflight', () => {
  expect(PREFLIGHT_STEPS.some((step) => step.claim === 'live')).toBe(false)
  expect(PREFLIGHT_STEPS.map((step) => step.id)).toEqual([
    'check',
    'contract-suite',
    'HOPI-E2E-011',
    'HOPI-E2E-012',
    'HOPI-E2E-016',
    'HOPI-E2E-020',
    'HOPI-E2E-021',
    'HOPI-E2E-025',
    'HOPI-E2E-001',
    'HOPI-E2E-014',
    'HOPI-E2E-015',
    'HOPI-E2E-023',
    'HOPI-E2E-028',
    'HOPI-E2E-029',
  ])
  expect(LIVE_STEPS.every((step) => step.claim === 'live')).toBe(true)
  expect(new Set(LIVE_STEPS.map((step) => step.id)).size).toBe(LIVE_STEPS.length)
})

test('Regression aggregates detailed Live and compact zero-provider usage', () => {
  const detailed = {
    usage: {
      logicalRunTotal: 2,
      providerUsageEvents: 1,
      tokens: { input: 20, cachedInput: 5, uncachedInput: 15, output: 3 },
    },
  } as unknown as TestRunReport
  const compact = {
    providerUsage: { runs: 1, inputTokens: 10, cachedInputTokens: 4, outputTokens: 2 },
  } as unknown as TestRunReport

  expect(aggregateUsage([detailed, compact, null])).toEqual({
    logicalRunTotal: 3,
    providerUsageEvents: 2,
    tokens: { input: 30, cachedInput: 9, uncachedInput: 21, output: 5 },
  })
})

test('gallery evidence preserves source order and capture order within each source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hopi-gallery-order-'))
  const first = join(root, 'first')
  const second = join(root, 'second')
  try {
    for (const [sourceRoot, scenario] of [
      [first, 'first-scenario'],
      [second, 'second-scenario'],
    ] as const) {
      await mkdir(join(sourceRoot, 'screenshots'), { recursive: true })
      const context = runContext(sourceRoot, scenario, 'browser')
      await writeTestRunReport(context, 'running')
      const firstPath = join(sourceRoot, 'screenshots', 'z-first.png')
      const secondPath = join(sourceRoot, 'screenshots', 'a-second.png')
      await Bun.write(firstPath, new Uint8Array(32).fill(1))
      await Bun.write(secondPath, new Uint8Array(32).fill(2))
      await utimes(firstPath, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))
      await utimes(secondPath, new Date('2026-01-01T00:00:01Z'), new Date('2026-01-01T00:00:01Z'))
      await writeTestRunReport(context, 'passed')
    }
    const screenshots = await collectScreenshotEvidence([second, first])
    expect(screenshots.map((entry) => `${entry.scenario}/${entry.path}`)).toEqual([
      'second-scenario/screenshots/z-first.png',
      'second-scenario/screenshots/a-second.png',
      'first-scenario/screenshots/z-first.png',
      'first-scenario/screenshots/a-second.png',
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function runContext(
  artifactRoot: string,
  scenario: string,
  claim: TestRunContext['claim'],
): TestRunContext {
  return {
    artifactRoot,
    scenario,
    claim,
    startedAt: '2026-07-14T00:00:00.000Z',
    code: CODE,
  }
}
