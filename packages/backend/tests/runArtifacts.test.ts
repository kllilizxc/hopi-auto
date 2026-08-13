import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cleanupRunScratch,
  parsePortableArtifactReference,
  preserveRunArtifacts,
} from '../src/runtime/runArtifacts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('Run artifacts', () => {
  test('promotes declared proof into the durable Run store without rewriting a semantic result', async () => {
    const root = await temporaryRoot()
    const runRoot = join(root, 'R-1')
    const scratch = join(runRoot, 'scratch')
    const source = join(scratch, 'deep', 'asset.png')
    await mkdir(join(scratch, 'deep'), { recursive: true })
    await Bun.write(source, 'proof')

    const result = await preserveRunArtifacts({
      runId: 'R-1',
      runRoot,
      artifacts: [source, 'deep/asset.png'],
      sourceRoots: [scratch],
    })

    expect(result.references).toEqual(['artifact:R-1/001-asset.png'])
    expect(await Bun.file(join(runRoot, 'artifacts', '001-asset.png')).text()).toBe('proof')
    expect(await Bun.file(join(runRoot, 'artifacts.json')).json()).toMatchObject({
      runId: 'R-1',
      artifacts: [{ reference: 'artifact:R-1/001-asset.png', path: 'artifacts/001-asset.png' }],
    })
    await cleanupRunScratch(scratch)
    expect(await Bun.file(source).exists()).toBe(false)
    expect(await Bun.file(join(runRoot, 'artifacts', '001-asset.png')).text()).toBe('proof')
  })

  test('retains a portable unavailable diagnostic without rejecting the outcome', async () => {
    const root = await temporaryRoot()
    const runRoot = join(root, 'R-1')
    const result = await preserveRunArtifacts({
      runId: 'R-1',
      runRoot,
      artifacts: ['reports/missing.png', join(root, 'host-only-missing.png')],
    })

    expect(result.references).toEqual(['reports/missing.png'])
    expect(result.unavailable).toEqual([
      {
        reference: 'reports/missing.png',
        reason: 'Declared Run artifact is unavailable.',
      },
      {
        reference: join(root, 'host-only-missing.png'),
        reason: 'Declared Run artifact is unavailable.',
      },
    ])
    expect(await Bun.file(join(runRoot, 'artifacts.json')).json()).toMatchObject({
      artifacts: [],
      unavailable: result.unavailable,
    })

    expect(parsePortableArtifactReference('artifact:R-1/001-proof.txt')).toEqual({
      runId: 'R-1',
      artifactPath: '001-proof.txt',
    })
    expect(parsePortableArtifactReference('artifact:test-log')).toBeNull()
  })

  test('keeps a verified Project-relative source path portable without duplicating it', async () => {
    const root = await temporaryRoot()
    const runRoot = join(root, 'R-1')
    const projectRoot = join(root, 'project')
    await mkdir(join(projectRoot, 'scripts'), { recursive: true })
    await Bun.write(join(projectRoot, 'scripts', 'preview'), '#!/bin/sh\n')

    const result = await preserveRunArtifacts({
      runId: 'R-1',
      runRoot,
      artifacts: ['scripts/preview'],
      sourceRoots: [projectRoot],
      portableRoots: [projectRoot],
    })

    expect(result.references).toEqual(['scripts/preview'])
    expect(result.preserved).toEqual([])
    expect(await Bun.file(join(runRoot, 'artifacts.json')).exists()).toBe(false)
  })

  test('retains a relative file from the Run artifact output instead of treating it as source', async () => {
    const root = await temporaryRoot()
    const runRoot = join(root, 'R-1')
    const outputRoot = join(runRoot, 'output-artifacts')
    await mkdir(outputRoot, { recursive: true })
    await Bun.write(join(outputRoot, 'proof.json'), '{"passed":true}\n')

    const result = await preserveRunArtifacts({
      runId: 'R-1',
      runRoot,
      artifacts: ['proof.json'],
      sourceRoots: [outputRoot],
      portableRoots: [],
    })

    expect(result.references).toEqual(['artifact:R-1/001-proof.json'])
    expect(await Bun.file(join(runRoot, 'artifacts', '001-proof.json')).text()).toContain(
      '"passed":true',
    )
  })

  test('snapshots a declared Run-local directory as one durable artifact subtree', async () => {
    const root = await temporaryRoot()
    const runRoot = join(root, 'R-1')
    const source = join(root, 'temporary-proof')
    await mkdir(join(source, 'nested'), { recursive: true })
    await Bun.write(join(source, 'ledger.json'), '{"phase":"validated"}\n')
    await Bun.write(join(source, 'nested', 'proof.txt'), 'durable proof\n')
    const result = await preserveRunArtifacts({
      runId: 'R-1',
      runRoot,
      artifacts: [source],
    })

    expect(result.references).toEqual(['artifact:R-1/001-temporary-proof'])
    expect(result.unavailable).toEqual([])
    expect(result.preserved).toMatchObject([
      {
        reference: 'artifact:R-1/001-temporary-proof',
        kind: 'directory',
        sizeBytes: expect.any(Number),
      },
    ])
    expect(
      await Bun.file(
        join(runRoot, 'artifacts', '001-temporary-proof', 'nested', 'proof.txt'),
      ).text(),
    ).toBe('durable proof\n')
  })

  test('does not retain a special proposal-path compatibility branch', async () => {
    const root = await temporaryRoot()
    const runRoot = join(root, 'R-1')
    const proposalRoot = join(runRoot, 'proposal')
    const proposalPath = '.hopi/docs/goals/goal-1/work/publish-preview.md'
    await mkdir(join(proposalRoot, '.hopi/docs/goals/goal-1/work'), { recursive: true })
    await Bun.write(join(proposalRoot, proposalPath), 'proposal proof')

    const result = await preserveRunArtifacts({
      runId: 'R-1',
      runRoot,
      artifacts: [proposalPath],
      sourceRoots: [proposalRoot],
    })

    expect(result.references).toEqual(['artifact:R-1/001-publish-preview.md'])
    expect(result.preserved).toHaveLength(1)
  })

  test('keeps a Project-relative artifact directory as portable supporting material', async () => {
    const root = await temporaryRoot()
    const runRoot = join(root, 'R-1')
    const projectRoot = join(root, 'project')
    await mkdir(join(projectRoot, 'reports', 'bundle'), { recursive: true })
    await Bun.write(join(projectRoot, 'reports', 'bundle', 'proof.json'), '{}\n')

    const result = await preserveRunArtifacts({
      runId: 'R-1',
      runRoot,
      artifacts: ['reports/bundle'],
      sourceRoots: [projectRoot],
      portableRoots: [projectRoot],
    })

    expect(result.references).toEqual(['reports/bundle'])
    expect(result.unavailable).toEqual([])
  })

  test('retains a candidate-only Project-relative directory instead of publishing a broken path', async () => {
    const root = await temporaryRoot()
    const runRoot = join(root, 'run')
    const candidateRoot = join(root, 'candidate')
    const releaseRoot = join(root, 'release')
    await Promise.all([
      mkdir(join(candidateRoot, 'reports', 'bundle'), { recursive: true }),
      mkdir(releaseRoot, { recursive: true }),
    ])
    await Bun.write(join(candidateRoot, 'reports', 'bundle', 'manifest.json'), '{"ok":true}\n')

    const result = await preserveRunArtifacts({
      runId: 'R-candidate-directory',
      runRoot,
      artifacts: ['reports/bundle'],
      sourceRoots: [candidateRoot],
      portableRoots: [releaseRoot],
    })

    expect(result.references).toEqual(['artifact:R-candidate-directory/001-bundle'])
    expect(result.preserved[0]).toMatchObject({ kind: 'directory' })
    expect(await Bun.file(join(runRoot, 'artifacts', '001-bundle', 'manifest.json')).text()).toBe(
      '{"ok":true}\n',
    )
  })
})

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'hopi-run-artifacts-'))
  temporaryRoots.push(root)
  return root
}
