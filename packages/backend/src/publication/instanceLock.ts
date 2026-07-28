import { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface CoordinatorLockOwner {
  version: 1
  instanceId: string
  kind: 'coordinator' | 'command'
  pid: number
  acquiredAt: string
  port: number | null
}

export interface CoordinatorInstanceLock {
  readonly path: string
  readonly owner: CoordinatorLockOwner
  release(): Promise<void>
}

export class CoordinatorInstanceLockError extends Error {}

export async function acquireCoordinatorInstanceLock(
  lockPath: string,
  options: { kind?: CoordinatorLockOwner['kind']; port?: number } = {},
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

  const owner: CoordinatorLockOwner = {
    version: 1,
    instanceId: randomUUID(),
    kind: options.kind ?? 'command',
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    port: options.port ?? null,
  }
  try {
    await writeCoordinatorLockOwner(lockPath, owner)
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } finally {
      database.close()
    }
    throw new CoordinatorInstanceLockError(
      `Cannot record Coordinator owner for ${lockPath}: ${errorMessage(error)}`,
    )
  }

  let released = false
  return {
    path: lockPath,
    owner,
    async release() {
      if (released) {
        return
      }
      released = true
      try {
        database.exec('ROLLBACK')
      } finally {
        database.close()
        await removeCoordinatorLockOwner(lockPath, owner.instanceId)
      }
    },
  }
}

export function coordinatorLockOwnerPath(lockPath: string) {
  return join(dirname(lockPath), 'coordinator.owner.json')
}

export async function readCoordinatorLockOwner(
  lockPath: string,
): Promise<CoordinatorLockOwner | null> {
  try {
    const value = JSON.parse(
      await readFile(coordinatorLockOwnerPath(lockPath), 'utf8'),
    ) as Partial<CoordinatorLockOwner>
    const pid = value.pid
    if (
      value.version !== 1 ||
      typeof value.instanceId !== 'string' ||
      !['coordinator', 'command'].includes(value.kind ?? '') ||
      !Number.isSafeInteger(pid) ||
      (pid ?? 0) <= 0 ||
      typeof value.acquiredAt !== 'string' ||
      (value.port !== null &&
        value.port !== undefined &&
        (!Number.isSafeInteger(value.port) || (value.port ?? 0) <= 0))
    ) {
      return null
    }
    return {
      version: 1,
      instanceId: value.instanceId,
      kind: value.kind as CoordinatorLockOwner['kind'],
      pid: pid as number,
      acquiredAt: value.acquiredAt,
      port: value.port ?? null,
    }
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null
    return null
  }
}

async function writeCoordinatorLockOwner(lockPath: string, owner: CoordinatorLockOwner) {
  const path = coordinatorLockOwnerPath(lockPath)
  const temporaryPath = `${path}.${owner.instanceId}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(owner, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

async function removeCoordinatorLockOwner(lockPath: string, instanceId: string) {
  const owner = await readCoordinatorLockOwner(lockPath)
  if (owner?.instanceId !== instanceId) return
  await rm(coordinatorLockOwnerPath(lockPath), { force: true })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function hasErrorCode(error: unknown, code: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}
