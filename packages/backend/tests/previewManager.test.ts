import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createPreviewManager, makePreviewAdapterExecutable } from '../src/runtime/previewManager'

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
      startupTimeoutMs: 500,
      stopGraceMs: 500,
      now: () => new Date('2026-07-11T00:00:00Z'),
    })

    const result = await manager.start({ projectId: 'P-1', projectRoot })
    expect(result.kind).toBe('started')
    if (result.kind !== 'started') throw new Error('Expected started Preview')
    await Bun.sleep(30)
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
    await Bun.write(
      adapter,
      '#!/usr/bin/env bun\nconsole.error("missing database")\nprocess.exit(2)\n',
    )
    await makePreviewAdapterExecutable(adapter)
    await initializeGit(projectRoot)
    const manager = createPreviewManager(join(temporaryRoot, 'home'), { startupTimeoutMs: 100 })

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
      startupTimeoutMs: 500,
      stopGraceMs: 500,
    })

    const start = manager.start({ projectId: 'P-1', projectRoot })
    await Bun.sleep(30)
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
    await Bun.sleep(30)
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
        'console.error("still preparing")',
        'process.on("SIGTERM", () => process.exit(0))',
        'await new Promise(() => {})',
        '',
      ].join('\n'),
    )
    await makePreviewAdapterExecutable(adapter)
    await initializeGit(projectRoot)
    const manager = createPreviewManager(join(temporaryRoot, 'home'), {
      startupTimeoutMs: 80,
      stopGraceMs: 500,
    })

    const result = await manager.start({ projectId: 'P-1', projectRoot })

    expect(result).toMatchObject({ kind: 'repair_required', reason: 'startup_failed' })
    if (result.kind !== 'repair_required') throw new Error('Expected repair prompt')
    expect(result.logs).toContain('still preparing')
    expect(manager.inspect('P-1')).toMatchObject({
      status: 'failed',
      error: 'Preview adapter did not become ready within 80ms',
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
