import { mkdir, open, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

interface LockOptions {
  retries?: number
  initialDelayMs?: number
  staleMs?: number
}

const DEFAULT_RETRIES = 8
const DEFAULT_INITIAL_DELAY_MS = 25
const DEFAULT_STALE_MS = 30_000

const lockQueues = new Map<string, Promise<void>>()

export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const retries = options.retries ?? DEFAULT_RETRIES
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS

  return withInProcessQueue(lockPath, async () => {
    await mkdir(dirname(lockPath), { recursive: true })
    await acquireLock(lockPath, retries, initialDelayMs, staleMs)

    try {
      return await fn()
    } finally {
      await unlink(lockPath).catch(() => undefined)
    }
  })
}

async function withInProcessQueue<T>(lockPath: string, fn: () => Promise<T>) {
  const previous = lockQueues.get(lockPath) ?? Promise.resolve()
  let releaseCurrent: () => void = () => undefined
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })
  const queued = previous.catch(() => undefined).then(() => current)
  lockQueues.set(lockPath, queued)

  await previous.catch(() => undefined)

  try {
    return await fn()
  } finally {
    releaseCurrent()
    if (lockQueues.get(lockPath) === queued) {
      lockQueues.delete(lockPath)
    }
  }
}

async function acquireLock(
  lockPath: string,
  retries: number,
  initialDelayMs: number,
  staleMs: number,
) {
  let delayMs = initialDelayMs

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx')
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
      )
      await handle.close()
      return
    } catch (error) {
      if (!isFileExistsError(error)) {
        throw error
      }

      await removeStaleLock(lockPath, staleMs)

      if (attempt === retries) {
        throw new Error(`Failed to acquire lock: ${lockPath}`)
      }

      await Bun.sleep(delayMs)
      delayMs *= 2
    }
  }
}

async function removeStaleLock(lockPath: string, staleMs: number) {
  try {
    const lockStat = await stat(lockPath)
    if (Date.now() - lockStat.mtimeMs > staleMs) {
      await unlink(lockPath)
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }
}

function isFileExistsError(error: unknown): error is { code: 'EEXIST' } {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

function isMissingFileError(error: unknown): error is { code: 'ENOENT' } {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
