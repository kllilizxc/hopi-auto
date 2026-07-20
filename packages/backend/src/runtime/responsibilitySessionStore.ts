import { mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import type { VendorSession } from '../agent/vendorAssistantOutput'
import { stableIdSchema } from '../domain/stableId'
import { RESPONSIBILITIES, type Responsibility } from './roleContextStager'

const vendorSessionSchema = z
  .object({
    transport: z.enum(['codex', 'claude', 'opencode']),
    sessionId: z.string().trim().min(1),
    compatibilityKey: z.string().trim().min(1).optional(),
  })
  .strict()

const sessionManifestSchema = z
  .object({
    version: z.literal(2),
    contractRevision: z.number().int().positive(),
    session: vendorSessionSchema.nullable(),
  })
  .strict()

const legacySessionManifestSchema = z
  .object({
    version: z.literal(1),
    transport: z.enum(['codex', 'claude', 'opencode']),
    sessionId: z.string().trim().min(1),
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
  session: VendorSession | null
  workspaceDir: string
}

export interface ResponsibilitySessionStore {
  open(key: ResponsibilitySessionKey, contractRevision: number): Promise<ResponsibilitySessionState>
  write(
    key: ResponsibilitySessionKey,
    contractRevision: number,
    session: VendorSession,
  ): Promise<void>
  invalidateVendor(key: ResponsibilitySessionKey, contractRevision: number): Promise<void>
  clearWork(key: ResponsibilityWorkKey): Promise<void>
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

  const revisionPaths = (key: ResponsibilitySessionKey, contractRevision: number) => {
    const revision = z.number().int().positive().parse(contractRevision)
    const responsibility = z.enum(RESPONSIBILITIES).parse(key.responsibility)
    const revisionRoot = join(workRoot(key), responsibility, `revision-${revision}`)
    return {
      revision,
      manifestPath: join(revisionRoot, 'session.json'),
      workspaceDir: join(revisionRoot, 'workspace'),
      legacyPath: join(workRoot(key), `${responsibility}.json`),
    }
  }

  const writeManifest = async (
    path: string,
    contractRevision: number,
    session: VendorSession | null,
  ) => {
    const manifest = sessionManifestSchema.parse({
      version: 2,
      contractRevision,
      session,
    })
    await mkdir(dirname(path), { recursive: true })
    await Bun.write(path, `${JSON.stringify(manifest, null, 2)}\n`)
  }

  const readManifest = async (path: string) => {
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    try {
      return sessionManifestSchema.parse(await file.json())
    } catch {
      await rm(path, { force: true })
      return null
    }
  }

  const readLegacySession = async (path: string) => {
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    try {
      const legacy = legacySessionManifestSchema.parse(await file.json())
      return { transport: legacy.transport, sessionId: legacy.sessionId } satisfies VendorSession
    } catch {
      return null
    } finally {
      await rm(path, { force: true })
    }
  }

  return {
    async open(key, contractRevision) {
      const paths = revisionPaths(key, contractRevision)
      await mkdir(paths.workspaceDir, { recursive: true })
      let manifest = await readManifest(paths.manifestPath)
      if (!manifest) {
        const session = await readLegacySession(paths.legacyPath)
        await writeManifest(paths.manifestPath, paths.revision, session)
        manifest = { version: 2, contractRevision: paths.revision, session }
      }
      return {
        contractRevision: paths.revision,
        session: manifest.session,
        workspaceDir: paths.workspaceDir,
      }
    },

    async write(key, contractRevision, session) {
      const paths = revisionPaths(key, contractRevision)
      await mkdir(paths.workspaceDir, { recursive: true })
      await writeManifest(paths.manifestPath, paths.revision, session)
    },

    async invalidateVendor(key, contractRevision) {
      const paths = revisionPaths(key, contractRevision)
      await mkdir(paths.workspaceDir, { recursive: true })
      await writeManifest(paths.manifestPath, paths.revision, null)
    },

    async clearWork(key) {
      await rm(workRoot(key), { recursive: true, force: true })
    },
  }
}
