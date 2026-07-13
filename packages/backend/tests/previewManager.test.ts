import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createPreviewManager, makePreviewAdapterExecutable } from '../src/runtime/previewManager'
import type { ProjectPreparer } from '../src/runtime/projectPreparation'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'preview-manager')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('PreviewManager', () => {
  test('runs the fixed adapter only in the managed integration root and stops it directly', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const adapter = join(projectRoot, 'scripts', 'hopi', 'preview')
    await mkdir(join(projectRoot, 'scripts', 'hopi'), { recursive: true })
    await writePrepareAdapter(projectRoot)
    await Bun.write(
      adapter,
      [
        '#!/usr/bin/env bun',
        'await Bun.write(`${process.env.HOPI_PREVIEW_RUNTIME_DIR}/root.txt`, process.cwd())',
        'console.log("HOPI_PREVIEW_URL=http://127.0.0.1:4321")',
        'process.on("SIGTERM", () => process.exit(0))',
        'await new Promise(() => {})',
        '',
      ].join('\n'),
    )
    await makePreviewAdapterExecutable(adapter)
    await initializeGit(projectRoot)
    const manager = createPreviewManager(join(temporaryRoot, 'home'), {
      startupTimeoutMs: 2_000,
      stopGraceMs: 500,
      now: () => new Date('2026-07-11T00:00:00Z'),
    })

    const result = await manager.start({ projectId: 'P-1', projectRoot })
    expect(result.kind).toBe('started')
    if (result.kind !== 'started') throw new Error('Expected started Preview')
    expect(result.session.endpoint).toBe('http://127.0.0.1:4321')
    expect(await Bun.file(join(dirname(result.session.logPath), 'root.txt')).text()).toBe(
      projectRoot,
    )
    expect(await manager.stop('P-1')).toMatchObject({
      status: 'stopped',
      endpoint: null,
      stoppedReason: null,
    })

    const restarted = await manager.start({ projectId: 'P-1', projectRoot })
    expect(restarted).toMatchObject({ kind: 'started', session: { status: 'running' } })
    expect(await manager.stop('P-1', 'release_updated')).toMatchObject({
      status: 'stopped',
      endpoint: null,
      stoppedReason: 'release_updated',
    })
  })

  test('returns an ordinary Assistant repair prompt when the adapter is missing', async () => {
    const manager = createPreviewManager(join(temporaryRoot, 'home'))

    const result = await manager.start({
      projectId: 'P-1',
      projectRoot: join(temporaryRoot, 'integration'),
    })

    expect(result).toMatchObject({ kind: 'repair_required', reason: 'missing' })
    if (result.kind !== 'repair_required') throw new Error('Expected repair prompt')
    expect(result.prompt).toContain('nonterminal Goal or Work')
    expect(result.prompt).toContain('scripts/hopi/preview')
    expect(result.prompt).toContain('clean managed integration worktree')
  })

  test('shares one preparation and adapter launch across concurrent Start calls', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const launchLog = await writeCountingFailureAdapter(projectRoot)
    const controlled = createControlledPreparer()
    const manager = createPreviewManager(join(temporaryRoot, 'home'), {
      preparer: controlled.preparer,
    })

    const first = manager.start({ projectId: 'P-1', projectRoot })
    const second = manager.start({ projectId: 'P-1', projectRoot })
    await controlled.entered
    controlled.release()
    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(controlled.calls).toBe(1)
    expect(secondResult).toBe(firstResult)
    expect(await Bun.file(launchLog).text()).toBe('started\n')
  })

  test('Stop during Project preparation prevents the Preview adapter from launching', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const launchLog = await writeCountingFailureAdapter(projectRoot)
    const controlled = createControlledPreparer()
    const manager = createPreviewManager(join(temporaryRoot, 'home'), {
      preparer: controlled.preparer,
    })

    const starting = manager.start({ projectId: 'P-1', projectRoot })
    await controlled.entered
    const stopped = await manager.stop('P-1', 'release_updated')
    controlled.release()
    const result = await starting

    expect(stopped).toMatchObject({ status: 'stopped', stoppedReason: 'release_updated' })
    expect(result).toMatchObject({
      kind: 'started',
      session: { status: 'stopped', stoppedReason: 'release_updated' },
    })
    expect(await Bun.file(launchLog).exists()).toBe(false)
  })

  test('serializes a new Start behind preparation that was already stopped', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const launchLog = await writeCountingFailureAdapter(projectRoot)
    const controlled = createControlledPreparer()
    const manager = createPreviewManager(join(temporaryRoot, 'home'), {
      preparer: controlled.preparer,
    })

    const first = manager.start({ projectId: 'P-1', projectRoot })
    await controlled.entered
    await manager.stop('P-1', 'release_updated')
    const second = manager.start({ projectId: 'P-1', projectRoot })

    expect(controlled.calls).toBe(1)
    controlled.release()
    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(firstResult).toMatchObject({ kind: 'started', session: { status: 'stopped' } })
    expect(secondResult).toMatchObject({ kind: 'repair_required', reason: 'startup_failed' })
    expect(controlled.calls).toBe(2)
    expect(await Bun.file(launchLog).text()).toBe('started\n')
  })

  test('closes an unexpected preparation error and allows a later Start', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    await writeCountingFailureAdapter(projectRoot)
    let calls = 0
    const preparer: ProjectPreparer = {
      async prepare(input) {
        calls += 1
        if (calls === 1) throw new Error('package manager crashed')
        return {
          kind: 'ready',
          adapterPath: join(input.projectRoot, 'scripts', 'hopi', 'prepare'),
          exitCode: 0,
          logs: '',
          logPath: join(input.runtimeDir, 'prepare.log'),
        }
      },
    }
    const manager = createPreviewManager(join(temporaryRoot, 'home'), { preparer })

    const failed = await manager.start({ projectId: 'P-1', projectRoot })
    expect(failed).toMatchObject({ kind: 'repair_required', reason: 'preparation_failed' })
    expect(manager.inspect('P-1')).toMatchObject({
      status: 'failed',
      error: 'Unexpected Preview preparation failure: package manager crashed',
    })

    const retried = await manager.start({ projectId: 'P-1', projectRoot })
    expect(retried).toMatchObject({ kind: 'repair_required', reason: 'startup_failed' })
    expect(calls).toBe(2)
  })

  test('stopAll waits for blocked Project preparation to settle', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const launchLog = await writeCountingFailureAdapter(projectRoot)
    const controlled = createControlledPreparer()
    const manager = createPreviewManager(join(temporaryRoot, 'home'), {
      preparer: controlled.preparer,
    })

    const starting = manager.start({ projectId: 'P-1', projectRoot })
    await controlled.entered
    let stopAllSettled = false
    const stopping = manager.stopAll().then(() => {
      stopAllSettled = true
    })
    await Promise.resolve()
    const settledBeforeRelease = stopAllSettled
    controlled.release()
    await Promise.all([starting, stopping])

    expect(settledBeforeRelease).toBe(false)
    expect(await Bun.file(launchLog).exists()).toBe(false)
  })

  test('runs Project preparation before Preview and returns its logs on failure', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const adapter = join(projectRoot, 'scripts', 'hopi', 'preview')
    await mkdir(join(projectRoot, 'scripts', 'hopi'), { recursive: true })
    await Bun.write(adapter, '#!/usr/bin/env bun\nthrow new Error("preview must not start")\n')
    await makePreviewAdapterExecutable(adapter)
    await writePrepareAdapter(projectRoot, 'console.error("lockfile is stale"); process.exit(2)')
    await initializeGit(projectRoot)
    const manager = createPreviewManager(join(temporaryRoot, 'home'))

    const result = await manager.start({ projectId: 'P-1', projectRoot })

    expect(result).toMatchObject({ kind: 'repair_required', reason: 'preparation_failed' })
    if (result.kind !== 'repair_required') throw new Error('Expected repair prompt')
    expect(result.logs).toContain('lockfile is stale')
    expect(result.prompt).toContain('scripts/hopi/prepare')
  })

  test('returns startup logs for a failed adapter without creating workflow state', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const adapter = join(projectRoot, 'scripts', 'hopi', 'preview')
    await mkdir(join(projectRoot, 'scripts', 'hopi'), { recursive: true })
    await writePrepareAdapter(projectRoot)
    await Bun.write(adapter, '#!/bin/sh\nprintf "missing database\\n" >&2\nexit 2\n')
    await makePreviewAdapterExecutable(adapter)
    await initializeGit(projectRoot)
    const manager = createPreviewManager(join(temporaryRoot, 'home'), { startupTimeoutMs: 2_000 })

    const result = await manager.start({ projectId: 'P-1', projectRoot })

    expect(result).toMatchObject({ kind: 'repair_required', reason: 'startup_failed' })
    if (result.kind !== 'repair_required') throw new Error('Expected repair prompt')
    expect(result.logs).toContain('missing database')
    expect(result.prompt).toContain('diagnosis rather than successful Preview')
    expect(result.prompt).toContain('terminal setup Goal')
  })

  test('waits for the adapter ready signal instead of treating an alive process as running', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const adapter = join(projectRoot, 'scripts', 'hopi', 'preview')
    await mkdir(join(projectRoot, 'scripts', 'hopi'), { recursive: true })
    await writePrepareAdapter(projectRoot)
    await Bun.write(
      adapter,
      [
        '#!/usr/bin/env bun',
        'console.log("installing prerequisites")',
        'await Bun.sleep(80)',
        'console.log("HOPI_PREVIEW_URL=http://127.0.0.1:4321")',
        'process.on("SIGTERM", () => process.exit(0))',
        'await new Promise(() => {})',
        '',
      ].join('\n'),
    )
    await makePreviewAdapterExecutable(adapter)
    await initializeGit(projectRoot)
    const manager = createPreviewManager(join(temporaryRoot, 'home'), {
      startupTimeoutMs: 2_000,
      stopGraceMs: 500,
    })

    const start = manager.start({ projectId: 'P-1', projectRoot })
    expect(manager.inspect('P-1')).toMatchObject({ status: 'starting', endpoint: null })
    const result = await start

    expect(result).toMatchObject({
      kind: 'started',
      session: { status: 'running', endpoint: 'http://127.0.0.1:4321' },
    })
    await manager.stop('P-1')
  })

  test('release invalidation wins when Preview is still starting', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const adapter = join(projectRoot, 'scripts', 'hopi', 'preview')
    await mkdir(join(projectRoot, 'scripts', 'hopi'), { recursive: true })
    await writePrepareAdapter(projectRoot)
    await Bun.write(
      adapter,
      [
        '#!/usr/bin/env bun',
        'await Bun.sleep(100)',
        'console.log("HOPI_PREVIEW_URL=http://127.0.0.1:4321")',
        'process.on("SIGTERM", () => process.exit(0))',
        'await new Promise(() => {})',
        '',
      ].join('\n'),
    )
    await makePreviewAdapterExecutable(adapter)
    await initializeGit(projectRoot)
    const manager = createPreviewManager(join(temporaryRoot, 'home'), {
      startupTimeoutMs: 500,
      stopGraceMs: 500,
    })

    const starting = manager.start({ projectId: 'P-1', projectRoot })
    expect(await manager.stop('P-1', 'release_updated')).toMatchObject({
      status: 'stopped',
      endpoint: null,
      stoppedReason: 'release_updated',
    })
    expect(await starting).toMatchObject({
      kind: 'started',
      session: {
        status: 'stopped',
        endpoint: null,
        stoppedReason: 'release_updated',
      },
    })
  })

  test('fails closed and preserves logs when no ready signal arrives before timeout', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const adapter = join(projectRoot, 'scripts', 'hopi', 'preview')
    await mkdir(join(projectRoot, 'scripts', 'hopi'), { recursive: true })
    await writePrepareAdapter(projectRoot)
    await Bun.write(
      adapter,
      [
        '#!/usr/bin/env bun',
        'await Bun.write(Bun.stderr, "still preparing\\n")',
        'process.on("SIGTERM", () => process.exit(0))',
        'await new Promise(() => {})',
        '',
      ].join('\n'),
    )
    await makePreviewAdapterExecutable(adapter)
    await initializeGit(projectRoot)
    const manager = createPreviewManager(join(temporaryRoot, 'home'), {
      startupTimeoutMs: 2_000,
      stopGraceMs: 500,
    })

    const result = await manager.start({ projectId: 'P-1', projectRoot })

    expect(result).toMatchObject({ kind: 'repair_required', reason: 'startup_failed' })
    if (result.kind !== 'repair_required') throw new Error('Expected repair prompt')
    expect(result.logs).toContain('still preparing')
    expect(manager.inspect('P-1')).toMatchObject({
      status: 'failed',
      error: 'Preview adapter did not become ready within 2000ms',
    })
  })
})

function dirname(path: string) {
  return path.slice(0, path.lastIndexOf('/'))
}

async function writePrepareAdapter(projectRoot: string, body = 'console.log("prepared")') {
  const adapter = join(projectRoot, 'scripts', 'hopi', 'prepare')
  await mkdir(join(projectRoot, 'scripts', 'hopi'), { recursive: true })
  await Bun.write(adapter, `#!/usr/bin/env bun\n${body}\n`)
  await makePreviewAdapterExecutable(adapter)
}

function createControlledPreparer() {
  let calls = 0
  let releasePreparation: () => void = () => undefined
  let markEntered: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    releasePreparation = resolve
  })
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve
  })
  const preparer: ProjectPreparer = {
    async prepare(input) {
      calls += 1
      markEntered()
      await gate
      return {
        kind: 'ready',
        adapterPath: join(input.projectRoot, 'scripts', 'hopi', 'prepare'),
        exitCode: 0,
        logs: '',
        logPath: join(input.runtimeDir, 'prepare.log'),
      }
    },
  }
  return {
    preparer,
    entered,
    release: () => releasePreparation(),
    get calls() {
      return calls
    },
  }
}

async function writeCountingFailureAdapter(projectRoot: string) {
  const adapter = join(projectRoot, 'scripts', 'hopi', 'preview')
  const launchLog = join(projectRoot, 'preview-launches.log')
  await mkdir(join(projectRoot, 'scripts', 'hopi'), { recursive: true })
  await Bun.write(
    adapter,
    [
      '#!/usr/bin/env bun',
      'import { appendFile } from "node:fs/promises"',
      `await appendFile(${JSON.stringify(launchLog)}, "started\\n")`,
      'await Bun.write(Bun.stderr, "expected startup failure\\n")',
      'process.exit(2)',
      '',
    ].join('\n'),
  )
  await makePreviewAdapterExecutable(adapter)
  return launchLog
}

async function initializeGit(projectRoot: string) {
  const run = async (args: string[]) => {
    const child = Bun.spawn(['git', ...args], {
      cwd: projectRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (exitCode !== 0) throw new Error(stderr || stdout)
  }
  await run(['init', '-b', 'main'])
  await run(['config', 'user.name', 'HOPI Test'])
  await run(['config', 'user.email', 'hopi@example.test'])
  await run(['add', '.'])
  await run(['commit', '-m', 'initial'])
}
