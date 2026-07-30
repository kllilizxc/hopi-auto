import { parse, stringify } from 'yaml'
import { z } from 'zod'
import type { ProjectDocument } from './project'
import { isNormalizedProjectPath, normalizeProjectPath } from './projectPath'
import { stableIdSchema } from './stableId'

const projectRepoDocumentSchema = z
  .object({
    repoId: stableIdSchema,
    projectPath: z.string().refine(isNormalizedProjectPath).optional(),
    releaseCommit: z
      .string()
      .regex(/^[a-f0-9]{40,64}$/)
      .optional(),
  })
  .strict()

export const projectDocumentSchema = z
  .object({
    projectId: stableIdSchema,
    primaryRepoId: stableIdSchema,
    repos: z.array(projectRepoDocumentSchema).min(1),
  })
  .strict()

const historicalProjectDocumentV2Schema = projectDocumentSchema
  .extend({
    version: z.literal(2),
  })
  .strict()

class ProjectDocumentError extends Error {}

export function parseProjectDocument(source: string): ProjectDocument {
  const value = parseProjectYaml(source)
  const parsed = projectDocumentSchema.safeParse(value)
  if (!parsed.success) {
    throw invalidProjectDocument(parsed.error.issues)
  }
  const document: ProjectDocument = parsed.data
  validateProjectDocument(document)
  return document
}

export function parseHistoricalProjectDocument(source: string): ProjectDocument {
  const value = parseProjectYaml(source)
  const current = projectDocumentSchema.safeParse(value)
  if (current.success) {
    validateProjectDocument(current.data)
    return current.data
  }
  const historical = historicalProjectDocumentV2Schema.safeParse(value)
  if (!historical.success) throw invalidProjectDocument(historical.error.issues)
  const { version: _version, ...document } = historical.data
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
    try {
      normalizeProjectPath(repo.projectPath)
    } catch (error) {
      throw new ProjectDocumentError(
        `project.yml contains invalid projectPath for ${repo.repoId}: ${errorMessage(error)}`,
      )
    }
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function parseProjectYaml(source: string) {
  try {
    return parse(source)
  } catch (error) {
    throw new ProjectDocumentError(`project.yml YAML is invalid: ${errorMessage(error)}`)
  }
}

function invalidProjectDocument(issues: readonly z.ZodIssue[]) {
  return new ProjectDocumentError(
    `project.yml is invalid: ${issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')}`,
  )
}
