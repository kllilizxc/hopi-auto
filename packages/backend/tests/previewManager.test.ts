import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type PreviewManager,
  type PreviewManagerOptions,
  createPreviewManager,
  makePreviewAdapterExecutable,
} from '../src/runtime/previewManager'
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
    const manager = createTestPreviewManager({
      startupTimeoutMs: 2_000,
      stopGraceMs: 500,
      now: () => new Date('2026-07-11T00:00:00Z'),
    })

    const releaseHeads = { primary: await readGitHead(projectRoot) }
    const result = await manager.start({ projectId: 'P-1', projectRoot, releaseHeads })
    expect(result.kind).toBe('started')
    if (result.kind !== 'started') throw new Error('Expected started Preview')
    expect(result.session.surfaces).toEqual([
      { id: 'default', label: 'Preview', url: 'http://127.0.0.1:4321' },
    ])
    expect(result.session.releaseHeads).toEqual({ primary: await readGitHead(projectRoot) })
    expect(await Bun.file(join(dirname(result.session.logPath), 'root.txt')).text()).toBe(
      projectRoot,
    )
    expect(await manager.stop('P-1')).toMatchObject({
      status: 'stopped',
      surfaces: [],
      stoppedReason: null,
    })

    const restarted = await manager.start({ projectId: 'P-1', projectRoot, releaseHeads })
    expect(restarted).toMatchObject({ kind: 'started', session: { status: 'running' } })
    expect(await manager.stop('P-1', 'release_updated')).toMatchObject({
      status: 'stopped',
      surfaces: [],
      stoppedReason: 'release_updated',
    })
  })

  test('never reuses a Preview session after the managed release head changes', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const adapter = join(projectRoot, 'scripts', 'hopi', 'preview')
    const launches = join(temporaryRoot, 'release-launches.txt')
    await mkdir(join(projectRoot, 'scripts', 'hopi'), { recursive: true })
    await writePrepareAdapter(projectRoot)
    await Bun.write(
      adapter,
      [
        '#!/usr/bin/env bun',
        'import { appendFile } from "node:fs/promises"',
        `await appendFile(${JSON.stringify(launches)}, "started\\n")`,
        'console.log("HOPI_PREVIEW_URL=http://127.0.0.1:4321")',
        'process.on("SIGTERM", () => process.exit(0))',
        'await new Promise(() => {})',
        '',
      ].join('\n'),
    )
    await makePreviewAdapterExecutable(adapter)
    await initializeGit(projectRoot)
    const manager = createTestPreviewManager()

    const first = await manager.start({
      projectId: 'P-1',
      projectRoot,
      releaseHeads: { primary: await readGitHead(projectRoot) },
    })
    if (first.kind !== 'started') throw new Error('Expected first Preview')
    const firstSessionId = first.session.sessionId
    const firstHead = first.session.releaseHeads.primary
    await Bun.write(join(projectRoot, 'release-change.txt'), 'next release\n')
    await commitAll(projectRoot, 'next release')
    const second = await manager.start({
      projectId: 'P-1',
      projectRoot,
      releaseHeads: { primary: await readGitHead(projectRoot) },
    })

    expect(second).toMatchObject({
      kind: 'started',
      session: {
        status: 'running',
        releaseHeads: { primary: await readGitHead(projectRoot) },
      },
    })
    if (second.kind !== 'started') throw new Error('Expected second Preview')
    expect(second.session.sessionId).not.toBe(firstSessionId)
    expect(second.session.releaseHeads.primary).not.toBe(firstHead)
    expect(first.session).toMatchObject({
      status: 'stopped',
      stoppedReason: 'release_updated',
      surfaces: [],
    })
    expect(await Bun.file(launches).text()).toBe('started\nstarted\n')
    await manager.stop('P-1')
  })

  test('publishes one Project Preview session with every declared surface', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const adapter = join(projectRoot, 'scripts', 'hopi', 'preview')
    const sender = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response('sender ready'),
    })
    const receiver = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response('receiver ready'),
    })
    const surfaces = [
      { id: 'sender', label: '发件端', url: `http://127.0.0.1:${sender.port}/sender` },
      { id: 'receiver', label: '收件端', url: `http://127.0.0.1:${receiver.port}/receiver` },
    ]
    await mkdir(join(projectRoot, 'scripts', 'hopi'), { recursive: true })
    await writePrepareAdapter(projectRoot)
    await Bun.write(
      adapter,
      [
        '#!/usr/bin/env bun',
        'process.on("SIGTERM", () => process.exit(0))',
        `console.log(${JSON.stringify(`HOPI_PREVIEW_SURFACES=${JSON.stringify(surfaces)}`)})`,
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

    try {
      const result = await manager.start({
        projectId: 'P-1',
        projectRoot,
        releaseHeads: { primary: 'release-1' },
      })

      expect(result).toMatchObject({
        kind: 'started',
        session: { projectId: 'P-1', status: 'running', surfaces },
      })
      expect(await manager.stop('P-1')).toMatchObject({ status: 'stopped', surfaces: [] })
    } finally {
      await manager.stopAll()
      sender.stop(true)
      receiver.stop(true)
    }
  })

  test('fails the complete Preview for an invalid declaration or unreachable surface', async () => {
    const invalidRoot = join(temporaryRoot, 'invalid')
    const invalidAdapter = join(invalidRoot, 'scripts', 'hopi', 'preview')
    await mkdir(join(invalidRoot, 'scripts', 'hopi'), { recursive: true })
    await writePrepareAdapter(invalidRoot)
    await Bun.write(
      invalidAdapter,
      [
        '#!/usr/bin/env bun',
        'process.on("SIGTERM", () => process.exit(0))',
        'console.log(\'HOPI_PREVIEW_SURFACES=[{"id":"app","label":"One","url":"http://127.0.0.1:1"},{"id":"app","label":"Two","url":"http://127.0.0.1:2"}]\')',
        'await new Promise(() => {})',
        '',
      ].join('\n'),
    )
    await makePreviewAdapterExecutable(invalidAdapter)
    await initializeGit(invalidRoot)
    const invalidManager = createTestPreviewManager()

    const invalid = await invalidManager.start({ projectId: 'P-invalid', projectRoot: invalidRoot })

    expect(invalid).toMatchObject({ kind: 'repair_required', reason: 'startup_failed' })
    expect(invalidManager.inspect('P-invalid')).toMatchObject({
      status: 'failed',
      surfaces: [],
      error: 'Preview surface declaration is invalid: surface ids must be unique',
    })

    const unreachableRoot = join(temporaryRoot, 'unreachable')
    const unreachableAdapter = join(unreachableRoot, 'scripts', 'hopi', 'preview')
    const surfaces = [
      { id: 'sender', label: '发件端', url: 'http://127.0.0.1:4321' },
      { id: 'receiver', label: '收件端', url: 'http://127.0.0.1:4322' },
    ]
    await mkdir(join(unreachableRoot, 'scripts', 'hopi'), { recursive: true })
    await writePrepareAdapter(unreachableRoot)
    await Bun.write(
      unreachableAdapter,
      [
        '#!/usr/bin/env bun',
        'process.on("SIGTERM", () => process.exit(0))',
        `console.log(${JSON.stringify(`HOPI_PREVIEW_SURFACES=${JSON.stringify(surfaces)}`)})`,
        'await new Promise(() => {})',
        '',
      ].join('\n'),
    )
    await makePreviewAdapterExecutable(unreachableAdapter)
    await initializeGit(unreachableRoot)
    const unreachableManager = createTestPreviewManager({
      surfaceProbe: async (url) => {
        if (url.endsWith('4322')) throw new Error('connection refused')
      },
    })

    const unreachable = await unreachableManager.start({
      projectId: 'P-unreachable',
      projectRoot: unreachableRoot,
    })

    expect(unreachable).toMatchObject({ kind: 'repair_required', reason: 'startup_failed' })
    expect(unreachableManager.inspect('P-unreachable')).toMatchObject({
      status: 'failed',
      surfaces: [],
      error: expect.stringContaining('surface receiver (收件端)'),
      repair: { reason: 'startup_failed' },
    })
  })

  test('prepares every integrated Repo before launching the primary Preview adapter', async () => {
    const projectRoot = join(temporaryRoot, 'web')
    const apiRoot = join(temporaryRoot, 'api')
    const orderFile = join(temporaryRoot, 'prepare-order.txt')
    const adapter = join(projectRoot, 'scripts', 'hopi', 'preview')
    const appendOrder = (repoId: string) =>
      [
        'import { appendFile } from "node:fs/promises"',
        `await appendFile(${JSON.stringify(orderFile)}, ${JSON.stringify(`${repoId}\n`)})`,
      ].join('\n')
    await writePrepareAdapter(projectRoot, appendOrder('web'))
    await writePrepareAdapter(apiRoot, appendOrder('api'))
    await Bun.write(
      adapter,
      [
        '#!/usr/bin/env bun',
        `if (await Bun.file(${JSON.stringify(orderFile)}).text() !== "web\\napi\\n") process.exit(2)`,
        'console.log("HOPI_PREVIEW_URL=http://127.0.0.1:4321")',
        'process.on("SIGTERM", () => process.exit(0))',
        'await new Promise(() => {})',
        '',
      ].join('\n'),
    )
    await makePreviewAdapterExecutable(adapter)
    await initializeGit(projectRoot)
    await initializeGit(apiRoot)
    const manager = createTestPreviewManager({
      startupTimeoutMs: 2_000,
      stopGraceMs: 500,
    })

    const result = await manager.start({
      projectId: 'P-1',
      projectRoot,
      primaryRepoId: 'web',
      repoRoots: [
        { repoId: 'web', path: projectRoot },
        { repoId: 'api', path: apiRoot },
      ],
    })

    expect(result).toMatchObject({ kind: 'started', session: { status: 'running' } })
    expect(await Bun.file(orderFile).text()).toBe('web\napi\n')
    await manager.stop('P-1')
  })

  test('returns an ordinary Assistant repair prompt when the adapter is missing', async () => {
    const manager = createTestPreviewManager()
    const projectRoot = join(temporaryRoot, 'integration')
    await mkdir(projectRoot, { recursive: true })
    await initializeGit(projectRoot)

    const result = await manager.start({
      projectId: 'P-1',
      projectRoot,
    })

    expect(result).toMatchObject({ kind: 'repair_required', reason: 'missing' })
    if (result.kind !== 'repair_required') throw new Error('Expected repair prompt')
    expect(result.prompt).toContain('Failure class: missing')
    expect(result.prompt).toContain('Desired outcome:')
    expect(result.prompt).toContain('scripts/hopi/preview')
    expect(result.prompt).toContain('clean managed integration worktree')
    expect(manager.inspect('P-1')).toMatchObject({
      status: 'failed',
      repair: { reason: 'missing', prompt: result.prompt },
    })
    expect(result.prompt).toContain('operator-usable surfaces')
    expect(result.prompt).toContain('independent candidate browser evidence')
    expect(result.prompt).not.toContain('Planning')
    expect(result.prompt).not.toContain('First check')
  })

  test('shares one preparation and adapter launch across concurrent Start calls', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const launchLog = await writeCountingFailureAdapter(projectRoot)
    const controlled = createControlledPreparer()
    const manager = createTestPreviewManager({
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

  test('Stop during Repo preparation prevents the Preview adapter from launching', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const launchLog = await writeCountingFailureAdapter(projectRoot)
    const controlled = createControlledPreparer()
    const manager = createTestPreviewManager({
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
    const manager = createTestPreviewManager({
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
          repos: [
            {
              repoId: 'primary',
              repoRoot: input.projectRoot,
              kind: 'ready',
              adapterPath: join(input.projectRoot, 'scripts', 'hopi', 'prepare'),
              exitCode: 0,
              logs: '',
              logPath: join(input.runtimeDir, 'prepare.log'),
            },
          ],
        }
      },
    }
    const manager = createTestPreviewManager({ preparer })

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

  test('stopAll waits for blocked Repo preparation to settle', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const launchLog = await writeCountingFailureAdapter(projectRoot)
    const controlled = createControlledPreparer()
    const manager = createTestPreviewManager({
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

  test('runs Repo preparation before Preview and returns its logs on failure', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const adapter = join(projectRoot, 'scripts', 'hopi', 'preview')
    await mkdir(join(projectRoot, 'scripts', 'hopi'), { recursive: true })
    await Bun.write(adapter, '#!/usr/bin/env bun\nthrow new Error("preview must not start")\n')
    await makePreviewAdapterExecutable(adapter)
    await writePrepareAdapter(projectRoot, 'console.error("lockfile is stale"); process.exit(2)')
    await initializeGit(projectRoot)
    const manager = createTestPreviewManager()

    const result = await manager.start({ projectId: 'P-1', projectRoot })

    expect(result).toMatchObject({ kind: 'repair_required', reason: 'preparation_failed' })
    if (result.kind !== 'repair_required') throw new Error('Expected repair prompt')
    expect(result.logs).toContain('lockfile is stale')
    expect(result.prompt).toContain('scripts/hopi/prepare')
    expect(manager.inspect('P-1')).toMatchObject({
      status: 'failed',
      repair: { reason: 'preparation_failed', logs: expect.stringContaining('lockfile is stale') },
    })
  })

  test('returns startup logs for a failed adapter without creating workflow state', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const adapter = join(projectRoot, 'scripts', 'hopi', 'preview')
    await mkdir(join(projectRoot, 'scripts', 'hopi'), { recursive: true })
    await writePrepareAdapter(projectRoot)
    await Bun.write(adapter, '#!/bin/sh\nprintf "missing database\\n" >&2\nexit 2\n')
    await makePreviewAdapterExecutable(adapter)
    await initializeGit(projectRoot)
    const manager = createTestPreviewManager({ startupTimeoutMs: 2_000 })

    const result = await manager.start({ projectId: 'P-1', projectRoot })

    expect(result).toMatchObject({ kind: 'repair_required', reason: 'startup_failed' })
    if (result.kind !== 'repair_required') throw new Error('Expected repair prompt')
    expect(result.logs).toContain('missing database')
    expect(result.prompt).toContain('diagnosis rather than successful Preview')
    expect(result.prompt).toContain('Failure class: startup_failed')
    expect(result.prompt).not.toContain('Planning')
  })

  test('bounds returned startup logs while preserving the complete Preview transcript', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const adapter = join(projectRoot, 'scripts', 'hopi', 'preview')
    await mkdir(join(projectRoot, 'scripts', 'hopi'), { recursive: true })
    await writePrepareAdapter(projectRoot)
    await Bun.write(
      adapter,
      [
        '#!/usr/bin/env bun',
        'for (let index = 0; index < 250; index += 1) console.error(`preview-${String(index).padStart(3, "0")}`)',
        'process.exit(2)',
        '',
      ].join('\n'),
    )
    await makePreviewAdapterExecutable(adapter)
    await initializeGit(projectRoot)
    const manager = createTestPreviewManager({ startupTimeoutMs: 2_000 })

    const result = await manager.start({ projectId: 'P-1', projectRoot })

    expect(result).toMatchObject({ kind: 'repair_required', reason: 'startup_failed' })
    if (result.kind !== 'repair_required') throw new Error('Expected repair prompt')
    expect(result.logs).not.toContain('preview-000')
    expect(result.logs).toContain('preview-249')
    const previewRoot = join(temporaryRoot, 'home', '.hopi', 'runtime', 'preview')
    const sessions = await Array.fromAsync(
      new Bun.Glob('**/preview.log').scan({
        cwd: previewRoot,
        onlyFiles: true,
      }),
    )
    expect(sessions).toHaveLength(1)
    const transcript = await Bun.file(join(previewRoot, sessions[0] as string)).text()
    expect(transcript).toContain('preview-000')
    expect(transcript).toContain('preview-249')
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
    const manager = createTestPreviewManager({
      startupTimeoutMs: 2_000,
      stopGraceMs: 500,
    })

    const start = manager.start({ projectId: 'P-1', projectRoot })
    expect(manager.inspect('P-1')).toMatchObject({ status: 'starting', surfaces: [] })
    const result = await start

    expect(result).toMatchObject({
      kind: 'started',
      session: {
        status: 'running',
        surfaces: [{ id: 'default', label: 'Preview', url: 'http://127.0.0.1:4321' }],
      },
    })
    await manager.stop('P-1')
  })

  test('keeps Preview starting until Coordinator probes the exact advertised endpoint', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const adapter = join(projectRoot, 'scripts', 'hopi', 'preview')
    await mkdir(join(projectRoot, 'scripts', 'hopi'), { recursive: true })
    await writePrepareAdapter(projectRoot)
    let signalProbe: () => void = () => undefined
    const probeEntered = new Promise<void>((resolve) => {
      signalProbe = resolve
    })
    let releaseProbe: () => void = () => undefined
    const probeGate = new Promise<void>((resolve) => {
      releaseProbe = resolve
    })
    const endpointServer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch() {
        signalProbe()
        await probeGate
        return new Response('ready')
      },
    })
    await Bun.write(
      adapter,
      [
        '#!/usr/bin/env bun',
        `console.log("HOPI_PREVIEW_URL=http://127.0.0.1:${endpointServer.port}/app")`,
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

    try {
      const starting = manager.start({
        projectId: 'P-1',
        projectRoot,
        releaseHeads: { primary: 'release-1' },
      })
      await probeEntered
      expect(manager.inspect('P-1')).toMatchObject({ status: 'starting', surfaces: [] })
      releaseProbe()
      expect(await starting).toMatchObject({
        kind: 'started',
        session: {
          status: 'running',
          surfaces: [
            {
              id: 'default',
              label: 'Preview',
              url: `http://127.0.0.1:${endpointServer.port}/app`,
            },
          ],
        },
      })
      await manager.stop('P-1')
    } finally {
      releaseProbe()
      endpointServer.stop(true)
    }
  })

  test('fails startup when the advertised endpoint does not return a successful response', async () => {
    const projectRoot = join(temporaryRoot, 'integration')
    const adapter = join(projectRoot, 'scripts', 'hopi', 'preview')
    await mkdir(join(projectRoot, 'scripts', 'hopi'), { recursive: true })
    await writePrepareAdapter(projectRoot)
    const endpointServer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        return new Response('missing', { status: 404 })
      },
    })
    await Bun.write(
      adapter,
      [
        '#!/usr/bin/env bun',
        `console.log("HOPI_PREVIEW_URL=http://127.0.0.1:${endpointServer.port}/missing")`,
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

    try {
      const result = await manager.start({
        projectId: 'P-1',
        projectRoot,
        releaseHeads: { primary: 'release-1' },
      })
      expect(result).toMatchObject({ kind: 'repair_required', reason: 'startup_failed' })
      if (result.kind !== 'repair_required') throw new Error('Expected repair prompt')
      expect(result.logs).toContain('GET returned HTTP 404')
      expect(manager.inspect('P-1')).toMatchObject({
        status: 'failed',
        surfaces: [],
        error: expect.stringContaining('GET returned HTTP 404'),
      })
    } finally {
      endpointServer.stop(true)
    }
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
    const manager = createTestPreviewManager({
      startupTimeoutMs: 500,
      stopGraceMs: 500,
    })

    const starting = manager.start({ projectId: 'P-1', projectRoot })
    expect(await manager.stop('P-1', 'release_updated')).toMatchObject({
      status: 'stopped',
      surfaces: [],
      stoppedReason: 'release_updated',
    })
    expect(await starting).toMatchObject({
      kind: 'started',
      session: {
        status: 'stopped',
        surfaces: [],
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
    const manager = createTestPreviewManager({
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

type TestPreviewStartInput = Omit<Parameters<PreviewManager['start']>[0], 'releaseHeads'> & {
  releaseHeads?: Readonly<Record<string, string>>
}

function createTestPreviewManager(options: PreviewManagerOptions = {}) {
  const manager = createPreviewManager(join(temporaryRoot, 'home'), {
    surfaceProbe: async () => undefined,
    ...options,
  })
  return {
    ...manager,
    start(input: TestPreviewStartInput) {
      const repos =
        input.repoRoots && input.repoRoots.length > 0
          ? input.repoRoots
          : [{ repoId: input.primaryRepoId ?? 'primary' }]
      return manager.start({
        ...input,
        releaseHeads:
          input.releaseHeads ??
          Object.fromEntries(repos.map((repo) => [repo.repoId, `release-${repo.repoId}`])),
      })
    },
  }
}

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
        repos: [
          {
            repoId: 'primary',
            repoRoot: input.projectRoot,
            kind: 'ready',
            adapterPath: join(input.projectRoot, 'scripts', 'hopi', 'prepare'),
            exitCode: 0,
            logs: '',
            logPath: join(input.runtimeDir, 'prepare.log'),
          },
        ],
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
  await initializeGit(projectRoot)
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
  await run(['commit', '--allow-empty', '-m', 'initial'])
}

async function commitAll(projectRoot: string, message: string) {
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
  await run(['add', '.'])
  await run(['commit', '-m', message])
}

async function readGitHead(projectRoot: string) {
  const child = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
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
  return stdout.trim()
}
