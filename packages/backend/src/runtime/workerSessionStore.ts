import { mkdir, rename, rm, symlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import type { WorkerSession } from '../agent/WorkerRunner'
import { stableIdSchema } from '../domain/stableId'

const vendorSessionSchema = z
  .object({
    transport: z.enum(['codex', 'claude', 'opencode']),
    sessionId: z.string().trim().min(1),
    executionKey: z.string().trim().min(1),
  })
  .strict()

const assignmentHashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const runtimeDigestSchema = z.string().regex(/^[a-f0-9]{64}$/)

const sessionManifestSchema = z
  .object({
    contractRevision: z.number().int().positive(),
    assignmentHash: assignmentHashSchema,
    runtimeDigest: runtimeDigestSchema,
    session: vendorSessionSchema.nullable(),
  })
  .strict()

export interface WorkerSessionKey {
  projectId: string
  goalId: string
  workId: string
  runId: string
}

export interface WorkerKey {
  projectId: string
  goalId: string
  workId: string
}

export interface WorkerSessionState {
  contractRevision: number
  assignmentHash: string
  runtimeDigest: string
  session: WorkerSession | null
  workspaceDir: string
}

export interface WorkerSessionScope {
  contractRevision: number
  assignmentHash: string
  runtimeDigest: string
}

export interface WorkerSessionStore {
  open(key: WorkerSessionKey, scope: WorkerSessionScope): Promise<WorkerSessionState>
  write(key: WorkerSessionKey, scope: WorkerSessionScope, session: WorkerSession): Promise<void>
  invalidateVendor(key: WorkerSessionKey, scope: WorkerSessionScope): Promise<void>
  clearWork(key: WorkerKey): Promise<void>
}

export async function bindWorkerSessionRunView(
  workspaceDir: string,
  runRoot: string,
): Promise<string> {
  const workspace = resolve(workspaceDir)
  const target = resolve(runRoot)
  const current = join(workspace, 'current')
  const pending = join(workspace, `.current-${crypto.randomUUID()}`)
  await mkdir(workspace, { recursive: true })
  await symlink(target, pending, 'dir')
  try {
    await rename(pending, current)
  } catch {
    await rm(current, { recursive: true, force: true })
    await rename(pending, current)
  } finally {
    await rm(pending, { recursive: true, force: true })
  }
  return current
}

export function createWorkerSessionStore(homeRoot: string): WorkerSessionStore {
  const root = join(resolve(homeRoot), '.hopi', 'runtime', 'worker-sessions')

  const normalizedKey = (key: WorkerKey) => ({
    projectId: stableIdSchema.parse(key.projectId),
    goalId: stableIdSchema.parse(key.goalId),
    workId: stableIdSchema.parse(key.workId),
  })

  const workRoot = (key: WorkerKey) => {
    const normalized = normalizedKey(key)
    return join(root, normalized.projectId, normalized.goalId, normalized.workId)
  }

  const assignmentPaths = (key: WorkerSessionKey, scope: WorkerSessionScope) => {
    const contractRevision = z.number().int().positive().parse(scope.contractRevision)
    const assignmentHash = assignmentHashSchema.parse(scope.assignmentHash)
    const runtimeDigest = runtimeDigestSchema.parse(scope.runtimeDigest)
    const runId = stableIdSchema.parse(key.runId)
    const assignmentRoot = join(workRoot(key), `assignment-${assignmentHash}`)
    const runtimeRoot = join(assignmentRoot, `runtime-${runtimeDigest}`)
    const runRoot = join(runtimeRoot, `run-${runId}`)
    return {
      contractRevision,
      assignmentHash,
      runtimeDigest,
      manifestPath: join(runRoot, 'session.json'),
      workspaceDir: join(runRoot, 'workspace'),
    }
  }

  const writeManifest = async (
    path: string,
    contractRevision: number,
    assignmentHash: string,
    runtimeDigest: string,
    session: WorkerSession | null,
  ) => {
    const manifest = sessionManifestSchema.parse({
      contractRevision,
      assignmentHash,
      runtimeDigest,
      session,
    })
    await mkdir(dirname(path), { recursive: true })
    await Bun.write(path, `${JSON.stringify(manifest, null, 2)}\n`)
  }

  const readManifest = async (path: string) => {
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    return sessionManifestSchema.parse(await file.json())
  }

  return {
    async open(key, scope) {
      const paths = assignmentPaths(key, scope)
      await mkdir(paths.workspaceDir, { recursive: true })
      let manifest = await readManifest(paths.manifestPath)
      if (!manifest) {
        await writeManifest(
          paths.manifestPath,
          paths.contractRevision,
          paths.assignmentHash,
          paths.runtimeDigest,
          null,
        )
        manifest = {
          contractRevision: paths.contractRevision,
          assignmentHash: paths.assignmentHash,
          runtimeDigest: paths.runtimeDigest,
          session: null,
        }
      }
      return {
        contractRevision: paths.contractRevision,
        assignmentHash: paths.assignmentHash,
        runtimeDigest: paths.runtimeDigest,
        session: manifest.session,
        workspaceDir: paths.workspaceDir,
      }
    },

    async write(key, scope, session) {
      const paths = assignmentPaths(key, scope)
      await mkdir(paths.workspaceDir, { recursive: true })
      await writeManifest(
        paths.manifestPath,
        paths.contractRevision,
        paths.assignmentHash,
        paths.runtimeDigest,
        session,
      )
    },

    async invalidateVendor(key, scope) {
      const paths = assignmentPaths(key, scope)
      await mkdir(paths.workspaceDir, { recursive: true })
      await writeManifest(
        paths.manifestPath,
        paths.contractRevision,
        paths.assignmentHash,
        paths.runtimeDigest,
        null,
      )
    },

    async clearWork(key) {
      await rm(workRoot(key), { recursive: true, force: true })
    },
  }
}
