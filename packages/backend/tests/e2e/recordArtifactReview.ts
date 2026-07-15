import { resolve } from 'node:path'
import { finishTestRun, startTestRun } from '../live/liveHarness'
import { collectScreenshotEvidence, readTestRun, writeEvidenceGallery } from '../testRunArtifact'

const sourceInput = process.argv
  .slice(2)
  .find((argument) => argument !== '--' && !argument.startsWith('--'))
const result = argumentValue('result')
const note = argumentValue('note')

if (!sourceInput || (result !== 'passed' && result !== 'failed') || !note) {
  console.error(
    'Usage: bun run artifact:review -- <artifact-root> --result=passed|failed --note=<summary>',
  )
  process.exit(2)
}

const sourceRoot = resolve(sourceInput)
const source = await readTestRun(sourceRoot)
if (source.status === 'running')
  throw new Error('Visual review requires a terminal source Test Run')
const sourceRoots = [sourceRoot, ...childArtifactRoots(source)]
const screenshots = await collectScreenshotEvidence([...new Set(sourceRoots)])
if (screenshots.length === 0) throw new Error('Visual review requires retained screenshots')

const reviewRun = await startTestRun(`${source.scenario}-visual-review`, 'inspection')
await writeEvidenceGallery(reviewRun.artifactRoot, sourceRoots)
await finishTestRun(reviewRun, result, {
  source: {
    artifactRoot: sourceRoot,
    scenario: source.scenario,
    claim: source.claim,
    status: source.status,
    code: source.code,
  },
  review: {
    result,
    note,
    reviewedAt: new Date().toISOString(),
    screenshots: screenshots.map(({ artifactRoot, path, bytes, sha256, scenario, capturedAt }) => ({
      artifactRoot,
      path,
      bytes,
      sha256,
      scenario,
      capturedAt,
    })),
  },
  providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
})

console.log(`Visual review ${result}: ${reviewRun.artifactRoot}`)
console.log(`Reviewed screenshots: ${screenshots.length}`)
if (result === 'failed') process.exitCode = 1

function argumentValue(name: string) {
  const prefix = `--${name}=`
  const inline = process.argv.find((argument) => argument.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function childArtifactRoots(report: Record<string, unknown>) {
  if (!Array.isArray(report.children)) return []
  return report.children.flatMap((child) => {
    if (!child || typeof child !== 'object') return []
    const root = (child as Record<string, unknown>).artifactRoot
    return typeof root === 'string' ? [resolve(root)] : []
  })
}
