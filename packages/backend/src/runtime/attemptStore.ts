import { mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FailureKind } from '../domain/board'
import { withFileLock } from '../storage/lock'
import { createProjectPaths } from '../storage/paths'

type AttemptsOverlay = Record<string, number>

export interface AttemptStore {
  get(taskRef: string, failureKind: FailureKind): Promise<number>
  increment(taskRef: string, failureKind: FailureKind): Promise<number>
  reset(taskRef: string, failureKind: FailureKind): Promise<void>
  resetTask(taskRef: string): Promise<void>
}

export function createAttemptStore(rootDir = process.cwd()): AttemptStore {
  const paths = createProjectPaths(rootDir)
  const attemptsPath = paths.attemptsPath()
  const lockPath = `${attemptsPath}.lock`

  return {
    async get(taskRef, failureKind) {
      const attempts = await readAttempts(attemptsPath)
      return attempts[attemptKey(taskRef, failureKind)] ?? 0
    },
    async increment(taskRef, failureKind) {
      return withFileLock(lockPath, async () => {
        const attempts = await readAttempts(attemptsPath)
        const key = attemptKey(taskRef, failureKind)
        const nextValue = (attempts[key] ?? 0) + 1
        attempts[key] = nextValue
        await writeAttemptsAtomically(attemptsPath, attempts)
        return nextValue
      })
    },
    async reset(taskRef, failureKind) {
      await withFileLock(lockPath, async () => {
        const attempts = await readAttempts(attemptsPath)
        delete attempts[attemptKey(taskRef, failureKind)]
        await writeAttemptsAtomically(attemptsPath, attempts)
      })
    },
    async resetTask(taskRef) {
      await withFileLock(lockPath, async () => {
        const attempts = await readAttempts(attemptsPath)
        for (const key of Object.keys(attempts)) {
          if (key.startsWith(`${taskRef}:`)) {
            delete attempts[key]
          }
        }
        await writeAttemptsAtomically(attemptsPath, attempts)
      })
    },
  }
}

function attemptKey(taskRef: string, failureKind: FailureKind) {
  return `${taskRef}:${failureKind}`
}

async function readAttempts(attemptsPath: string): Promise<AttemptsOverlay> {
  const file = Bun.file(attemptsPath)
  if (!(await file.exists())) {
    return {}
  }

  const raw = await file.text()
  if (raw.trim() === '') {
    return {}
  }

  const parsed = JSON.parse(raw)
  return validateAttemptsOverlay(parsed)
}

function validateAttemptsOverlay(value: unknown): AttemptsOverlay {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid attempts overlay: expected object')
  }

  for (const [key, count] of Object.entries(value)) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`Invalid attempts overlay count for ${key}`)
    }
  }

  return value as AttemptsOverlay
}

async function writeAttemptsAtomically(attemptsPath: string, attempts: AttemptsOverlay) {
  await mkdir(dirname(attemptsPath), { recursive: true })
  const tmpPath = `${attemptsPath}.tmp.${crypto.randomUUID()}`
  await Bun.write(tmpPath, `${JSON.stringify(attempts, null, 2)}\n`)
  await rename(tmpPath, attemptsPath)
}
