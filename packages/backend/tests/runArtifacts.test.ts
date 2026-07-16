import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  RunArtifactError,
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
  test('promotes declared proof into the durable Run store and rewrites result.json', async () => {
    const root = await temporaryRoot()
    const runRoot = join(root, 'R-1')
    const scratch = join(runRoot, 'scratch')
    const source = join(scratch, 'deep', 'asset.png')
    const resultFile = join(runRoot, 'result.json')
    await mkdir(join(scratch, 'deep'), { recursive: true })
    await Bun.write(source, 'proof')
    await Bun.write(
      resultFile,
      `${JSON.stringify({ result: 'success', summary: 'proved', artifacts: [source] })}\n`,
    )

    const result = await preserveRunArtifacts({
      runId: 'R-1',
      runRoot,
      artifacts: [source],
      resultFile,
    })

    expect(result.references).toEqual(['artifact:R-1/001-asset.png'])
    expect(await Bun.file(join(runRoot, 'artifacts', '001-asset.png')).text()).toBe('proof')
    expect(await Bun.file(join(runRoot, 'artifacts.json')).json()).toMatchObject({
      version: 1,
      runId: 'R-1',
      artifacts: [{ reference: 'artifact:R-1/001-asset.png', path: 'artifacts/001-asset.png' }],
    })
    expect(await Bun.file(resultFile).json()).toMatchObject({
      artifacts: ['artifact:R-1/001-asset.png'],
    })

    await cleanupRunScratch(scratch)
    expect(await Bun.file(source).exists()).toBe(false)
    expect(await Bun.file(join(runRoot, 'artifacts', '001-asset.png')).text()).toBe('proof')
  })

  test('rejects a dangling declared proof and accepts portable legacy references', async () => {
    const root = await temporaryRoot()
    await expect(
      preserveRunArtifacts({
        runId: 'R-1',
        runRoot: join(root, 'R-1'),
        artifacts: [join(root, 'missing.png')],
      }),
    ).rejects.toBeInstanceOf(RunArtifactError)

    expect(parsePortableArtifactReference('artifact:R-1/001-proof.txt')).toEqual({
      runId: 'R-1',
      artifactPath: '001-proof.txt',
    })
    expect(parsePortableArtifactReference('artifact:test-log')).toEqual({
      runId: null,
      artifactPath: 'test-log',
    })
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
    })

    expect(result.references).toEqual(['scripts/preview'])
    expect(result.preserved).toEqual([])
    expect(await Bun.file(join(runRoot, 'artifacts.json')).exists()).toBe(false)
  })
})

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'hopi-run-artifacts-'))
  temporaryRoots.push(root)
  return root
}
