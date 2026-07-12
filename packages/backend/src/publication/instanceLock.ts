import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const LOCK_CONFLICT_EXIT_CODE = 73
const READY_MARKER = 'HOPI_COORDINATOR_LOCKED\n'

export interface CoordinatorInstanceLock {
  readonly path: string
  release(): Promise<void>
}

export class CoordinatorInstanceLockError extends Error {}

export async function acquireCoordinatorInstanceLock(
  lockPath: string,
): Promise<CoordinatorInstanceLock> {
  await mkdir(dirname(lockPath), { recursive: true })
  const child = Bun.spawn(
    [
      'flock',
      '--exclusive',
      '--nonblock',
      '--conflict-exit-code',
      String(LOCK_CONFLICT_EXIT_CODE),
      lockPath,
      'sh',
      '-c',
      `printf '${READY_MARKER}'; cat >/dev/null`,
    ],
    { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
  )

  const reader = child.stdout.getReader()
  const acquisition = await Promise.race([
    reader.read(),
    Bun.sleep(5_000).then(() => ({ done: true, value: undefined }) as const),
  ])
  reader.releaseLock()

  const ready = acquisition.value
    ? new TextDecoder().decode(acquisition.value).includes(READY_MARKER.trim())
    : false
  if (!ready) {
    child.kill()
    const exitCode = await child.exited
    const stderr = await new Response(child.stderr).text()
    throw new CoordinatorInstanceLockError(
      exitCode === LOCK_CONFLICT_EXIT_CODE
        ? `Another Coordinator owns ${lockPath}`
        : `Cannot acquire Coordinator lock ${lockPath}: ${stderr.trim() || `exit ${exitCode}`}`,
    )
  }

  let released = false
  return {
    path: lockPath,
    async release() {
      if (released) {
        return
      }
      released = true
      child.stdin.end()
      await child.exited
    },
  }
}
