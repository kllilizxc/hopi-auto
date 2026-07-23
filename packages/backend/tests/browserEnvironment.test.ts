import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  browserHarnessAdapterCommand,
  browserHarnessRuntimeRoot,
  browserTargetManifest,
  ensureManagedBrowser,
  managedBrowserProfileRoot,
} from '../src/runtime/browserEnvironment'

const temporaryRoots: string[] = []
const managedPids = new Set<number>()

afterEach(async () => {
  for (const pid of managedPids) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {}
  }
  managedPids.clear()
  await Bun.sleep(50)
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('browser environment', () => {
  test('describes two environment targets without Project policy', () => {
    expect(browserTargetManifest()).toEqual({
      version: 1,
      defaultTarget: 'managed',
      selector: '--target <managed|operator>',
      targets: {
        managed: {
          loginState: 'HOPI-owned persistent browser profile',
          persistence: 'Assistant Home',
          attachment: 'unattended dedicated DevTools endpoint',
          ownership: 'HOPI owns the browser process and profile',
        },
        operator: {
          loginState: "operator browser's live login state",
          persistence: 'current operator browser instance',
          attachment: 'Chrome may request authorization after a genuine attachment reset',
          ownership: 'HOPI owns only its Browser Harness daemon',
        },
      },
    })
  })

  test('reuses one managed browser endpoint and profile across callers', async () => {
    const fixture = await createFixture()
    const [first, concurrent] = await Promise.all([
      ensureManagedBrowser(fixture.homeRoot, { browserCommand: fixture.fakeBrowser }),
      ensureManagedBrowser(fixture.homeRoot, { browserCommand: fixture.fakeBrowser }),
    ])
    const second = await ensureManagedBrowser(fixture.homeRoot, {
      browserCommand: fixture.fakeBrowser,
    })
    const state = await managedState(fixture.homeRoot)
    managedPids.add(state.launchedPid)

    expect(concurrent).toEqual(first)
    expect(second).toEqual(first)
    expect(first.profileRoot).toBe(managedBrowserProfileRoot(fixture.homeRoot))
    expect(first.httpUrl).toStartWith('http://127.0.0.1:')
    expect(browserHarnessRuntimeRoot(fixture.homeRoot).length).toBeLessThan(80)
    expect(
      (await Bun.file(join(first.profileRoot, 'launch-args.json')).json()) as string[],
    ).toContain('data:text/html,<title>HOPI%20Managed%20Browser</title>')
  })

  test('recovers a launch lock whose owner no longer exists', async () => {
    const fixture = await createFixture()
    const launchLock = join(browserHarnessRuntimeRoot(fixture.homeRoot), 'managed-launch.lock')
    await mkdir(launchLock, { recursive: true })
    await Bun.write(join(launchLock, 'owner.json'), '{"pid":2147483647}\n')

    const endpoint = await ensureManagedBrowser(fixture.homeRoot, {
      timeoutMs: 5_000,
      browserCommand: fixture.fakeBrowser,
    })
    const state = await managedState(fixture.homeRoot)
    managedPids.add(state.launchedPid)

    expect(endpoint.httpUrl).toStartWith('http://127.0.0.1:')
    expect(await Bun.file(launchLock).exists()).toBe(false)
  })

  test('adapter isolates managed and operator Harness identities', async () => {
    const fixture = await createFixture()
    const managed = await runAdapter(fixture)
    const state = await managedState(fixture.homeRoot)
    managedPids.add(state.launchedPid)
    const operatorHome = join(fixture.root, 'operator-home')
    const operator = await runAdapter({ ...fixture, homeRoot: operatorHome }, 'operator')

    expect(managed.exitCode).toBe(0)
    expect(managed.output).toMatchObject({
      args: ['--reload'],
      BU_NAME: 'hopi-managed',
      BH_RUNTIME_DIR_SHARED: '1',
      BH_TMP_DIR_SHARED: '1',
    })
    expect(managed.output.BU_CDP_URL).toStartWith('http://127.0.0.1:')
    expect(operator.exitCode).toBe(0)
    expect(operator.output).toMatchObject({
      args: ['--reload'],
      BU_NAME: 'hopi-operator',
      BU_CDP_URL: null,
      BH_RUNTIME_DIR_SHARED: '1',
      BH_TMP_DIR_SHARED: '1',
    })
    expect(
      await Bun.file(join(managedBrowserProfileRoot(operatorHome), 'DevToolsActivePort')).exists(),
    ).toBe(false)
  })
})

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'hopi-browser-environment-'))
  temporaryRoots.push(root)
  const homeRoot = join(root, 'home')
  const fakeBrowser = join(root, 'fake-browser.ts')
  const fakeHarness = join(root, 'fake-harness.ts')
  await mkdir(homeRoot, { recursive: true })
  await Bun.write(
    fakeBrowser,
    `#!/usr/bin/env bun
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
const profileArg = Bun.argv.find((arg) => arg.startsWith('--user-data-dir='))
if (!profileArg) throw new Error('missing profile')
const profile = profileArg.slice('--user-data-dir='.length)
await mkdir(profile, { recursive: true })
await Bun.write(join(profile, 'launch-args.json'), JSON.stringify(Bun.argv.slice(2)))
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  routes: {
    '/json/version': () => Response.json({
      Browser: 'Fake Chrome',
      webSocketDebuggerUrl: 'ws://127.0.0.1:' + server.port + '/devtools/browser/fake',
    }),
  },
})
await Bun.write(join(profile, 'DevToolsActivePort'), String(server.port) + '\\n/devtools/browser/fake\\n')
process.on('SIGTERM', () => {
  void server.stop(true).then(() => process.exit(0))
})
await new Promise(() => {})
`,
  )
  await Bun.write(
    fakeHarness,
    `#!/usr/bin/env bun
console.log(JSON.stringify({
  args: Bun.argv.slice(2),
  BU_NAME: process.env.BU_NAME,
  BU_CDP_URL: process.env.BU_CDP_URL ?? null,
  BH_RUNTIME_DIR: process.env.BH_RUNTIME_DIR,
  BH_RUNTIME_DIR_SHARED: process.env.BH_RUNTIME_DIR_SHARED,
  BH_TMP_DIR: process.env.BH_TMP_DIR,
  BH_TMP_DIR_SHARED: process.env.BH_TMP_DIR_SHARED,
}))
`,
  )
  await Promise.all([chmod(fakeBrowser, 0o755), chmod(fakeHarness, 0o755)])
  return { root, homeRoot, fakeBrowser, fakeHarness }
}

async function runAdapter(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  target?: 'managed' | 'operator',
) {
  const targetArgs = target ? ['--target', target] : []
  const child = Bun.spawn([browserHarnessAdapterCommand(), ...targetArgs, '--reload'], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      HOPI_BROWSER_HOME: fixture.homeRoot,
      HOPI_BROWSER_CHROME_COMMAND: fixture.fakeBrowser,
      HOPI_BROWSER_HARNESS_BACKEND_COMMAND: fixture.fakeHarness,
    },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr)
  return {
    exitCode,
    output: JSON.parse(stdout) as {
      args: string[]
      BU_NAME: string
      BU_CDP_URL: string | null
      BH_RUNTIME_DIR: string
      BH_RUNTIME_DIR_SHARED: string
      BH_TMP_DIR: string
      BH_TMP_DIR_SHARED: string
    },
  }
}

async function managedState(homeRoot: string) {
  return (await Bun.file(join(managedBrowserProfileRoot(homeRoot), '..', 'state.json')).json()) as {
    launchedPid: number
  }
}
