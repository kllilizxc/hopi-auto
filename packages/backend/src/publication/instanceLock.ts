import { FFIType, dlopen, suffix } from 'bun:ffi'
import { closeSync, openSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface CoordinatorInstanceLock {
  readonly path: string
  release(): Promise<void>
}

export class CoordinatorInstanceLockError extends Error {}

// biome-ignore lint/suspicious/noExplicitAny: Required for FFI return type
let libc: any = null
try {
  const libcPath = process.platform === 'darwin' ? 'libSystem.B.dylib' : `libc.${suffix}`
  libc = dlopen(libcPath, {
    flock: {
      args: [FFIType.i32, FFIType.i32],
      returns: FFIType.i32,
    },
  })
} catch (e) {
  // Ignore
}

const LOCK_EX = 2
const LOCK_NB = 4
const LOCK_UN = 8

export async function acquireCoordinatorInstanceLock(
  lockPath: string,
): Promise<CoordinatorInstanceLock> {
  await mkdir(dirname(lockPath), { recursive: true })

  if (!libc) {
    throw new CoordinatorInstanceLockError('Failed to load libc for flock')
  }

  let fd: number
  try {
    fd = openSync(lockPath, 'w')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    throw new CoordinatorInstanceLockError(`Cannot open lock file ${lockPath}: ${message}`)
  }

  const res = libc.symbols.flock(fd, LOCK_EX | LOCK_NB)

  if (res !== 0) {
    closeSync(fd)
    throw new CoordinatorInstanceLockError(`Another Coordinator owns ${lockPath}`)
  }

  let released = false
  return {
    path: lockPath,
    async release() {
      if (released) {
        return
      }
      released = true
      try {
        libc.symbols.flock(fd, LOCK_UN)
      } finally {
        closeSync(fd)
      }
    },
  }
}
