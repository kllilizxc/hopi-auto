import { existsSync } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { homedir, platform, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BROWSER_TARGETS = ['managed', 'operator'] as const
export type BrowserTarget = (typeof BROWSER_TARGETS)[number]

export interface BrowserTargetManifest {
  version: 1
  defaultTarget: BrowserTarget
  selector: string
  targets: Record<
    BrowserTarget,
    {
      loginState: string
      persistence: string
      attachment: string
      ownership: string
    }
  >
}

export interface ManagedBrowserEndpoint {
  httpUrl: string
  webSocketUrl: string
  profileRoot: string
}

const MANAGED_BROWSER_START_TIMEOUT_MS = 20_000

export function browserEnvironmentRoot(homeRoot: string) {
  return join(resolve(homeRoot), '.hopi', 'browser')
}

export function managedBrowserProfileRoot(homeRoot: string) {
  return join(browserEnvironmentRoot(homeRoot), 'managed', 'profile')
}

export function browserHarnessStateRoot(homeRoot: string) {
  return join(browserEnvironmentRoot(homeRoot), 'harness')
}

export function browserHarnessRuntimeRoot(homeRoot: string) {
  const hash = new Bun.CryptoHasher('sha256').update(resolve(homeRoot)).digest('hex').slice(0, 16)
  const runtimeBase = platform() === 'darwin' ? '/tmp' : tmpdir()
  return join(runtimeBase, `hopi-bh-${hash}`)
}

export function browserHarnessAdapterCommand() {
  return fileURLToPath(new URL('../browserHarnessAdapter.ts', import.meta.url))
}

export function resolveBrowserHarnessBackendCommand() {
  const explicit = process.env.HOPI_BROWSER_HARNESS_COMMAND?.trim()
  return explicit || Bun.which('codex-browser-harness') || Bun.which('browser-harness') || undefined
}

export function resolveManagedBrowserCommand() {
  const explicit = process.env.HOPI_BROWSER_CHROME_COMMAND?.trim()
  if (explicit) return existsSync(explicit) ? resolve(explicit) : Bun.which(explicit)

  if (platform() === 'darwin') {
    for (const candidate of [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]) {
      if (existsSync(candidate)) return candidate
    }
  }

  for (const candidate of [
    'google-chrome-stable',
    'google-chrome',
    'chromium',
    'chromium-browser',
    'microsoft-edge',
    'brave-browser',
  ]) {
    const command = Bun.which(candidate)
    if (command) return command
  }
  return undefined
}

export function browserTargetManifest(): BrowserTargetManifest {
  return {
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
  }
}

export function browserAdapterEnvironment(homeRoot: string, backendCommand: string) {
  return {
    HOPI_BROWSER_HOME: resolve(homeRoot),
    HOPI_BROWSER_HARNESS_BACKEND_COMMAND: backendCommand,
  }
}

export async function ensureManagedBrowser(
  homeRoot: string,
  options: { timeoutMs?: number; browserCommand?: string } = {},
): Promise<ManagedBrowserEndpoint> {
  const profileRoot = managedBrowserProfileRoot(homeRoot)
  const managedRoot = dirname(profileRoot)
  const runtimeRoot = browserHarnessRuntimeRoot(homeRoot)
  const launchLock = join(runtimeRoot, 'managed-launch.lock')
  await Promise.all([
    mkdir(profileRoot, { recursive: true }),
    mkdir(runtimeRoot, { recursive: true }),
  ])

  const existing = await readManagedBrowserEndpoint(profileRoot)
  if (existing) return existing

  let ownsLaunch = false
  try {
    await mkdir(launchLock)
    await Bun.write(
      join(launchLock, 'owner.json'),
      `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
    )
    ownsLaunch = true
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) throw error
  }

  const timeoutMs = options.timeoutMs ?? MANAGED_BROWSER_START_TIMEOUT_MS
  if (!ownsLaunch) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const endpoint = await readManagedBrowserEndpoint(profileRoot)
      if (endpoint) return endpoint
      if (!(await launchLockOwnerAlive(launchLock))) {
        await rm(launchLock, { recursive: true, force: true })
        return ensureManagedBrowser(homeRoot, options)
      }
      await Bun.sleep(100)
    }
    throw new Error(
      `Managed browser launch did not publish a healthy DevTools endpoint within ${timeoutMs}ms`,
    )
  }

  try {
    const afterLock = await readManagedBrowserEndpoint(profileRoot)
    if (afterLock) return afterLock

    const browserCommand = options.browserCommand ?? resolveManagedBrowserCommand()
    if (!browserCommand) {
      throw new Error(
        'Managed browser is unavailable: no supported Chrome, Chromium, Edge, or Brave executable was found',
      )
    }

    await rm(join(profileRoot, 'DevToolsActivePort'), { force: true })
    const chromeLog = join(managedRoot, 'chrome.log')
    const child = Bun.spawn(
      [
        browserCommand,
        `--user-data-dir=${profileRoot}`,
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
        '--no-first-run',
        '--no-default-browser-check',
        '--enable-logging',
        `--log-file=${chromeLog}`,
        'data:text/html,<title>HOPI%20Managed%20Browser</title>',
      ],
      {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
        detached: true,
      },
    )
    child.unref()

    const endpoint = await waitForManagedBrowser(profileRoot, timeoutMs)
    if (!endpoint) {
      throw new Error(
        `Managed browser did not publish a healthy DevTools endpoint within ${timeoutMs}ms; inspect ${chromeLog}`,
      )
    }
    await Bun.write(
      join(managedRoot, 'state.json'),
      `${JSON.stringify(
        {
          browserCommand,
          launchedPid: child.pid,
          httpUrl: endpoint.httpUrl,
          profileRoot,
          observedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    )
    return endpoint
  } finally {
    await rm(launchLock, { recursive: true, force: true })
  }
}

async function launchLockOwnerAlive(launchLock: string) {
  let pid: unknown
  try {
    const owner = (await Bun.file(join(launchLock, 'owner.json')).json()) as { pid?: unknown }
    pid = owner.pid
  } catch {
    try {
      return Date.now() - (await stat(launchLock)).mtimeMs < 1_000
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return false
      throw error
    }
  }
  if (!Number.isSafeInteger(pid) || (pid as number) <= 0) return false
  try {
    process.kill(pid as number, 0)
    return true
  } catch (error) {
    if (hasErrorCode(error, 'ESRCH')) return false
    throw error
  }
}

async function waitForManagedBrowser(profileRoot: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const endpoint = await readManagedBrowserEndpoint(profileRoot)
    if (endpoint) return endpoint
    await Bun.sleep(100)
  }
  return null
}

async function readManagedBrowserEndpoint(
  profileRoot: string,
): Promise<ManagedBrowserEndpoint | null> {
  let lines: string[]
  try {
    lines = (await Bun.file(join(profileRoot, 'DevToolsActivePort')).text()).split(/\r?\n/)
  } catch {
    return null
  }
  const port = Number(lines[0]?.trim())
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null
  const browserPath = lines[1]?.trim()
  if (!browserPath?.startsWith('/devtools/browser/')) return null
  const httpUrl = `http://127.0.0.1:${port}`
  try {
    const response = await fetch(`${httpUrl}/json/version`, {
      signal: AbortSignal.timeout(1_000),
    })
    if (!response.ok) return null
    const body = (await response.json()) as { webSocketDebuggerUrl?: unknown }
    if (typeof body.webSocketDebuggerUrl !== 'string' || !body.webSocketDebuggerUrl) return null
    const webSocketUrl = new URL(body.webSocketDebuggerUrl)
    if (
      webSocketUrl.protocol !== 'ws:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(webSocketUrl.hostname) ||
      Number(webSocketUrl.port) !== port ||
      `${webSocketUrl.pathname}${webSocketUrl.search}` !== browserPath
    ) {
      return null
    }
    return {
      httpUrl,
      webSocketUrl: webSocketUrl.href,
      profileRoot,
    }
  } catch {
    return null
  }
}

function hasErrorCode(error: unknown, code: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}

export function defaultBrowserTestHome() {
  return join(homedir(), '.hopi', 'browser-test-host')
}
