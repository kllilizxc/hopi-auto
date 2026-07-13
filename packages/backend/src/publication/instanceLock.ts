import { Database } from 'bun:sqlite'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface CoordinatorInstanceLock {
  readonly path: string
  release(): Promise<void>
}

export class CoordinatorInstanceLockError extends Error {}

export async function acquireCoordinatorInstanceLock(
  lockPath: string,
): Promise<CoordinatorInstanceLock> {
  await mkdir(dirname(lockPath), { recursive: true })

  let database: Database | null = null
  try {
    database = new Database(lockPath, { create: true })
    database.exec('PRAGMA busy_timeout = 0')
    database.exec('BEGIN EXCLUSIVE')
  } catch (err: unknown) {
    database?.close()
    const message = err instanceof Error ? err.message : String(err)
    if (/locked|busy/i.test(message)) {
      throw new CoordinatorInstanceLockError(`Another Coordinator owns ${lockPath}`)
    }
    throw new CoordinatorInstanceLockError(
      `Cannot acquire Coordinator lock ${lockPath}: ${message}`,
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
      try {
        database.exec('ROLLBACK')
      } finally {
        database.close()
      }
    },
  }
}
