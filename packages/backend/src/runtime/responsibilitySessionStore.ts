import { mkdir, rename, rm, symlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import type { ResponsibilitySession } from '../agent/RoleRunner'
import { stableIdSchema } from '../domain/stableId'
import { RESPONSIBILITIES, type Responsibility } from './roleContextStager'

const vendorSessionSchema = z
  .object({
    transport: z.enum(['codex', 'claude', 'opencode']),
    sessionId: z.string().trim().min(1),
    executionKey: z.string().trim().min(1),
  })
  .strict()

const assignmentHashSchema = z.string().regex(/^[a-f0-9]{64}$/)

const sessionManifestSchema = z
  .object({
    contractRevision: z.number().int().positive(),
    assignmentHash: assignmentHashSchema,
    session: vendorSessionSchema.nullable(),
  })
  .strict()

export interface ResponsibilitySessionKey {
  projectId: string
  goalId: string
  workId: string
  responsibility: Responsibility
}

export interface ResponsibilityWorkKey {
  projectId: string
  goalId: string
  workId: string
}

export interface ResponsibilitySessionState {
  contractRevision: number
  assignmentHash: string
  session: ResponsibilitySession | null
  workspaceDir: string
}

export interface ResponsibilitySessionScope {
  contractRevision: number
  assignmentHash: string
}

export interface ResponsibilitySessionStore {
  open(
    key: ResponsibilitySessionKey,
    scope: ResponsibilitySessionScope,
  ): Promise<ResponsibilitySessionState>
  write(
    key: ResponsibilitySessionKey,
    scope: ResponsibilitySessionScope,
    session: ResponsibilitySession,
  ): Promise<void>
  invalidateVendor(key: ResponsibilitySessionKey, scope: ResponsibilitySessionScope): Promise<void>
  clearWork(key: ResponsibilityWorkKey): Promise<void>
}

export async function bindResponsibilitySessionRunView(
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

export function createResponsibilitySessionStore(homeRoot: string): ResponsibilitySessionStore {
  const root = join(resolve(homeRoot), '.hopi', 'runtime', 'responsibility-sessions')

  const normalizedKey = (key: ResponsibilityWorkKey) => ({
    projectId: stableIdSchema.parse(key.projectId),
    goalId: stableIdSchema.parse(key.goalId),
    workId: stableIdSchema.parse(key.workId),
  })

  const workRoot = (key: ResponsibilityWorkKey) => {
    const normalized = normalizedKey(key)
    return join(root, normalized.projectId, normalized.goalId, normalized.workId)
  }

  const assignmentPaths = (key: ResponsibilitySessionKey, scope: ResponsibilitySessionScope) => {
    const contractRevision = z.number().int().positive().parse(scope.contractRevision)
    const assignmentHash = assignmentHashSchema.parse(scope.assignmentHash)
    const responsibility = z.enum(RESPONSIBILITIES).parse(key.responsibility)
    const assignmentRoot = join(workRoot(key), responsibility, `assignment-${assignmentHash}`)
    return {
      contractRevision,
      assignmentHash,
      manifestPath: join(assignmentRoot, 'session.json'),
      workspaceDir: join(assignmentRoot, 'workspace'),
    }
  }

  const writeManifest = async (
    path: string,
    contractRevision: number,
    assignmentHash: string,
    session: ResponsibilitySession | null,
  ) => {
    const manifest = sessionManifestSchema.parse({
      contractRevision,
      assignmentHash,
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
        await writeManifest(paths.manifestPath, paths.contractRevision, paths.assignmentHash, null)
        manifest = {
          contractRevision: paths.contractRevision,
          assignmentHash: paths.assignmentHash,
          session: null,
        }
      }
      return {
        contractRevision: paths.contractRevision,
        assignmentHash: paths.assignmentHash,
        session: manifest.session,
        workspaceDir: paths.workspaceDir,
      }
    },

    async write(key, scope, session) {
      const paths = assignmentPaths(key, scope)
      await mkdir(paths.workspaceDir, { recursive: true })
      await writeManifest(paths.manifestPath, paths.contractRevision, paths.assignmentHash, session)
    },

    async invalidateVendor(key, scope) {
      const paths = assignmentPaths(key, scope)
      await mkdir(paths.workspaceDir, { recursive: true })
      await writeManifest(paths.manifestPath, paths.contractRevision, paths.assignmentHash, null)
    },

    async clearWork(key) {
      await rm(workRoot(key), { recursive: true, force: true })
    },
  }
}
