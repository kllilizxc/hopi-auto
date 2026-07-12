import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { DEFAULT_PRIMARY_REPO_ID, type ProjectDocument, type ProjectRepoDocument } from './project'

const stableIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)

export const projectRepoDocumentSchema = z
  .object({
    repoId: stableIdSchema,
    releaseCommit: z
      .string()
      .regex(/^[a-f0-9]{40,64}$/)
      .optional(),
  })
  .strict()

export const projectDocumentSchema = z
  .object({
    version: z.literal(2),
    projectId: stableIdSchema,
    primaryRepoId: stableIdSchema,
    repos: z.array(projectRepoDocumentSchema).min(1),
  })
  .strict()

export const legacyProjectDocumentSchema = z
  .object({
    version: z.literal(1),
    projectId: stableIdSchema,
  })
  .strict()

export class ProjectDocumentError extends Error {}

export function parseProjectDocument(
  source: string,
  legacyPrimaryRepoId = DEFAULT_PRIMARY_REPO_ID,
): ProjectDocument {
  let value: unknown
  try {
    value = parse(source)
  } catch (error) {
    throw new ProjectDocumentError(`project.yml YAML is invalid: ${errorMessage(error)}`)
  }
  const parsed = z.union([projectDocumentSchema, legacyProjectDocumentSchema]).safeParse(value)
  if (!parsed.success) {
    throw new ProjectDocumentError(
      `project.yml is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ')}`,
    )
  }
  const document: ProjectDocument =
    parsed.data.version === 2
      ? parsed.data
      : {
          version: 2,
          projectId: parsed.data.projectId,
          primaryRepoId: legacyPrimaryRepoId,
          repos: [{ repoId: legacyPrimaryRepoId }],
        }
  validateProjectDocument(document)
  return document
}

export function renderProjectDocument(document: ProjectDocument) {
  validateProjectDocument(document)
  return stringify(document, { indent: 2 })
}

export function validateProjectDocument(document: ProjectDocument) {
  const repoIds = new Set<string>()
  for (const repo of document.repos) {
    if (repoIds.has(repo.repoId)) {
      throw new ProjectDocumentError(`project.yml contains duplicate Repo ${repo.repoId}`)
    }
    if (repo.repoId === document.primaryRepoId && repo.releaseCommit) {
      throw new ProjectDocumentError('primary Repo releaseCommit must be implicit')
    }
    if (repo.repoId !== document.primaryRepoId && !repo.releaseCommit) {
      throw new ProjectDocumentError(`secondary Repo ${repo.repoId} is missing releaseCommit`)
    }
    repoIds.add(repo.repoId)
  }
  if (!repoIds.has(document.primaryRepoId)) {
    throw new ProjectDocumentError('project.yml is missing its primary Repo')
  }
}

export function withRepoRelease(
  document: ProjectDocument,
  repoId: string,
  releaseCommit: string,
): ProjectDocument {
  if (repoId === document.primaryRepoId) {
    throw new ProjectDocumentError('primary Repo release is represented by C1 itself')
  }
  const existing = document.repos.find((repo) => repo.repoId === repoId)
  if (!existing) throw new ProjectDocumentError(`project.yml does not contain Repo ${repoId}`)
  return {
    ...document,
    repos: document.repos.map((repo) =>
      repo.repoId === repoId ? { ...repo, releaseCommit } : repo,
    ),
  }
}

export function repoRelease(document: ProjectDocument, repoId: string) {
  return document.repos.find((repo) => repo.repoId === repoId)?.releaseCommit
}

export function sortProjectRepos(
  primaryRepoId: string,
  repos: readonly ProjectRepoDocument[],
): ProjectRepoDocument[] {
  return [...repos].sort((left, right) => {
    if (left.repoId === primaryRepoId) return right.repoId === primaryRepoId ? 0 : -1
    if (right.repoId === primaryRepoId) return 1
    return left.repoId.localeCompare(right.repoId)
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
