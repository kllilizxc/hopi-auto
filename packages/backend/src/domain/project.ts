import type { ProjectCodingDefaults } from './projectCodingDefaults'

export const HOPI_RELEASE_BRANCH = 'hopi/release'
export const HOPI_RELEASE_REF = `refs/heads/${HOPI_RELEASE_BRANCH}`
export const DEFAULT_PRIMARY_REPO_ID = 'primary'

export interface AssistantHomeDocument {
  version: 1
  homeId: string
}

export interface ProjectRepoLink {
  repoId: string
  repoPath: string
}

export interface ProjectLink {
  projectId: string
  primaryRepoId: string
  repos: ProjectRepoLink[]
  codingDefaults?: ProjectCodingDefaults
}

export interface ProjectLinksDocument {
  version: 2
  projects: ProjectLink[]
}

export interface ProjectRepoDocument {
  repoId: string
  releaseCommit?: string
}

export interface ProjectDocument {
  version: 2
  projectId: string
  primaryRepoId: string
  repos: ProjectRepoDocument[]
}

export interface LinkedProjectRepo extends ProjectRepoLink {
  integrationRoot: string
  primary: boolean
}

export interface LinkedProject extends ProjectLink {
  repos: LinkedProjectRepo[]
  /** Primary Repo compatibility alias. */
  repoPath: string
  /** Primary Repo compatibility alias and canonical document root. */
  integrationRoot: string
}

export function primaryProjectRepo<T extends Pick<ProjectRepoLink, 'repoId'>>(
  project: Pick<ProjectLink, 'primaryRepoId'> & { repos: readonly T[] },
): T {
  const repo = project.repos.find((candidate) => candidate.repoId === project.primaryRepoId)
  if (!repo) throw new Error(`Primary Repo is missing: ${project.primaryRepoId}`)
  return repo
}

export function requireProjectRepo<T extends Pick<ProjectRepoLink, 'repoId'>>(
  project: { repos: readonly T[] },
  repoId: string,
): T {
  const repo = project.repos.find((candidate) => candidate.repoId === repoId)
  if (!repo) throw new Error(`Project Repo is not linked: ${repoId}`)
  return repo
}
