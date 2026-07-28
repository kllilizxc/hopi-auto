import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  type CoordinatorLockOwner,
  readCoordinatorLockOwner,
} from '../packages/backend/src/publication/instanceLock'
import { defaultAssistantHomeRoot } from '../packages/backend/src/runtime/assistantHomeMigration'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    home: { type: 'string' },
    timeout: { type: 'string' },
  },
})

const homeRoot = values.home ?? process.env.HOPI_HOME?.trim() ?? defaultAssistantHomeRoot()
const timeoutMs = readPositiveInteger(values.timeout, '--timeout') ?? 30_000
const lockPath = join(homeRoot, '.hopi', 'runtime', 'coordinator.lock')
const owner = await readCoordinatorLockOwner(lockPath)

if (owner && processExists(owner.pid)) {
  if (owner.kind !== 'coordinator') {
    console.log(`Waiting for Coordinator command PID ${owner.pid} to release the runtime lock.`)
    await waitForExit(owner.pid, timeoutMs)
  } else {
    await assertCoordinatorOwner(owner)
    console.log(`Stopping HOPI backend PID ${owner.pid}.`)
    process.kill(owner.pid, 'SIGTERM')
    try {
      await waitForExit(owner.pid, timeoutMs)
    } catch {
      console.warn(`HOPI backend PID ${owner.pid} did not stop within ${timeoutMs}ms; forcing exit.`)
      if (processExists(owner.pid)) process.kill(owner.pid, 'SIGKILL')
      await waitForExit(owner.pid, 5_000)
    }
  }
}

const projectRoot = join(import.meta.dir, '..')
const port = process.env.PORT ?? (owner?.port ? String(owner.port) : undefined)
console.log(`Starting HOPI backend for ${homeRoot}.`)
const child = Bun.spawn([process.execPath, 'run', 'dev:backend'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    HOPI_HOME: homeRoot,
    ...(port ? { PORT: port } : {}),
  },
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
})
process.exit(await child.exited)

async function assertCoordinatorOwner(owner: CoordinatorLockOwner) {
  if (await healthMatches(owner)) return
  const command = await readProcessCommand(owner.pid)
  if (command.includes('mvpServer.ts')) return
  throw new Error(
    `Refusing to signal PID ${owner.pid}: the owner record is stale and the process is not a HOPI backend.`,
  )
}

async function healthMatches(owner: CoordinatorLockOwner) {
  if (!owner.port) return false
  try {
    const response = await fetch(`http://127.0.0.1:${owner.port}/api/health`, {
      signal: AbortSignal.timeout(1_500),
    })
    if (!response.ok) return false
    const health = (await response.json()) as { pid?: unknown; instanceId?: unknown }
    return health.pid === owner.pid && health.instanceId === owner.instanceId
  } catch {
    return false
  }
}

async function readProcessCommand(pid: number) {
  const child = Bun.spawn(['ps', '-p', String(pid), '-o', 'command='], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const [command, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ])
  return exitCode === 0 ? command.trim() : ''
}

async function waitForExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (processExists(pid)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for PID ${pid} to exit`)
    await Bun.sleep(50)
  }
}

function processExists(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (hasErrorCode(error, 'ESRCH')) return false
    throw error
  }
}

function readPositiveInteger(value: string | undefined, name: string) {
  if (value === undefined) return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer in milliseconds`)
  }
  return parsed
}

function hasErrorCode(error: unknown, code: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}
