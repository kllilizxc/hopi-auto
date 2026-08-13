import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { stableIdSchema } from '../domain/stableId'
import { writeJsonAtomically, writeTextAtomically } from '../storage/atomicFile'
import { runStoragePath } from './runPaths'

const commitSchema = z.string().regex(/^[a-f0-9]{40,64}$/)
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const patchPathSchema = z.string().regex(/^change-set\/[a-f0-9]{64}\.patch$/)

const runChangeSetRepoSchema = z
  .object({
    repoId: stableIdSchema,
    baseCommit: commitSchema,
    resultCommit: commitSchema,
    patchPath: patchPathSchema,
    contentHash: hashSchema,
  })
  .strict()

export const runChangeSetSchema = z
  .object({
    id: stableIdSchema,
    projectId: stableIdSchema,
    goalId: stableIdSchema,
    workId: stableIdSchema,
    producerRunId: stableIdSchema,
    disposition: z.literal('unaccepted'),
    createdAt: z.string().datetime(),
    repos: z.array(runChangeSetRepoSchema).min(1),
    manifestHash: hashSchema,
  })
  .strict()

export type RunChangeSet = z.infer<typeof runChangeSetSchema>

export interface RunChangeSetRepoInput {
  repoId: string
  worktreePath: string
  baseCommit: string
  resultCommit: string
}

export interface FreezeRunChangeSetInput {
  projectId: string
  goalId: string
  workId: string
  runId: string
  repos: readonly RunChangeSetRepoInput[]
}

export interface RunChangeSetStore {
  freeze(input: FreezeRunChangeSetInput): Promise<RunChangeSet | null>
  read(runId: string): Promise<RunChangeSet | null>
  readById(changeSetId: string): Promise<RunChangeSet | null>
  readPatch(changeSet: RunChangeSet, repoId: string): Promise<Uint8Array>
}

export function createRunChangeSetStore(
  homeRoot: string,
  options: { now?: () => Date } = {},
): RunChangeSetStore {
  const now = options.now ?? (() => new Date())

  return {
    async freeze(input) {
      const identity = parseIdentity(input)
      const existing = await this.read(identity.runId)
      if (existing) {
        assertSameFrozenHeads(existing, input.repos)
        return existing
      }

      const runRoot = runStoragePath(homeRoot, identity.runId)
      const patchRoot = join(runRoot, 'change-set')
      const repos: RunChangeSet['repos'] = []
      for (const source of [...input.repos].sort((left, right) =>
        left.repoId.localeCompare(right.repoId),
      )) {
        const repoId = stableIdSchema.parse(source.repoId)
        const baseCommit = commitSchema.parse(source.baseCommit)
        const resultCommit = commitSchema.parse(source.resultCommit)
        if (baseCommit === resultCommit) continue
        const patch = await gitPatch(source.worktreePath, baseCommit, resultCommit)
        if (patch.byteLength === 0) continue
        const contentHash = hashBytes(patch)
        const patchPath = `change-set/${contentHash}.patch`
        await mkdir(patchRoot, { recursive: true })
        await writeTextAtomically(join(runRoot, patchPath), patch)
        repos.push({ repoId, baseCommit, resultCommit, patchPath, contentHash })
      }
      if (repos.length === 0) return null

      const core = {
        id: `CS-${identity.runId}`,
        projectId: identity.projectId,
        goalId: identity.goalId,
        workId: identity.workId,
        producerRunId: identity.runId,
        disposition: 'unaccepted' as const,
        createdAt: now().toISOString(),
        repos,
      }
      const changeSet = runChangeSetSchema.parse({
        ...core,
        manifestHash: hashText(JSON.stringify(core)),
      })
      await writeJsonAtomically(join(runRoot, 'change-set.json'), changeSet)
      return changeSet
    },

    async read(runId) {
      const normalizedRunId = stableIdSchema.parse(runId)
      const runRoot = runStoragePath(homeRoot, normalizedRunId)
      const file = Bun.file(join(runRoot, 'change-set.json'))
      if (!(await file.exists())) return null
      const changeSet = runChangeSetSchema.parse(await file.json())
      const { manifestHash, ...core } = changeSet
      if (hashText(JSON.stringify(core)) !== manifestHash) {
        throw new Error(`ChangeSet manifest hash mismatch: ${changeSet.id}`)
      }
      for (const repo of changeSet.repos) {
        const patch = new Uint8Array(await Bun.file(join(runRoot, repo.patchPath)).arrayBuffer())
        if (hashBytes(patch) !== repo.contentHash) {
          throw new Error(`ChangeSet patch hash mismatch: ${changeSet.id}/${repo.repoId}`)
        }
      }
      return changeSet
    },

    async readById(changeSetId) {
      const normalized = stableIdSchema.parse(changeSetId)
      if (!normalized.startsWith('CS-')) return null
      const changeSet = await this.read(normalized.slice(3))
      return changeSet?.id === normalized ? changeSet : null
    },

    async readPatch(changeSet, repoId) {
      const validated = runChangeSetSchema.parse(changeSet)
      const normalizedRepoId = stableIdSchema.parse(repoId)
      const repo = validated.repos.find((candidate) => candidate.repoId === normalizedRepoId)
      if (!repo) throw new Error(`ChangeSet Repo not found: ${validated.id}/${normalizedRepoId}`)
      const bytes = new Uint8Array(
        await Bun.file(
          join(runStoragePath(homeRoot, validated.producerRunId), repo.patchPath),
        ).arrayBuffer(),
      )
      if (hashBytes(bytes) !== repo.contentHash) {
        throw new Error(`ChangeSet patch hash mismatch: ${validated.id}/${normalizedRepoId}`)
      }
      return bytes
    },
  }
}

export async function readGitHead(cwd: string) {
  const result = await git(cwd, ['rev-parse', 'HEAD'])
  return commitSchema.parse(new TextDecoder().decode(result).trim())
}

function parseIdentity(input: FreezeRunChangeSetInput) {
  return {
    projectId: stableIdSchema.parse(input.projectId),
    goalId: stableIdSchema.parse(input.goalId),
    workId: stableIdSchema.parse(input.workId),
    runId: stableIdSchema.parse(input.runId),
  }
}

function assertSameFrozenHeads(
  existing: RunChangeSet,
  requested: readonly RunChangeSetRepoInput[],
) {
  const requestedByRepo = new Map(
    requested
      .filter((repo) => repo.baseCommit !== repo.resultCommit)
      .map((repo) => [repo.repoId, repo] as const),
  )
  for (const repo of existing.repos) {
    const source = requestedByRepo.get(repo.repoId)
    if (source?.baseCommit !== repo.baseCommit || source.resultCommit !== repo.resultCommit) {
      throw new Error(`ChangeSet is immutable: ${existing.id}/${repo.repoId}`)
    }
    requestedByRepo.delete(repo.repoId)
  }
  if (requestedByRepo.size > 0) throw new Error(`ChangeSet is immutable: ${existing.id}`)
}

async function gitPatch(cwd: string, baseCommit: string, resultCommit: string) {
  return git(cwd, ['diff', '--binary', baseCommit, resultCommit, '--', '.', ':(exclude).hopi/**'])
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${stderr.trim()}`)
  }
  return new Uint8Array(stdout)
}

function hashBytes(value: Uint8Array) {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

function hashText(value: string) {
  return hashBytes(new TextEncoder().encode(value))
}
