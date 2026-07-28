import { assertStableId } from './stableId'

export const DEFAULT_PRIMARY_REPO_ID = 'primary'

export function projectReleaseBranch(projectId: string) {
  assertStableId(projectId, 'projectId')
  return `hopi/project/${projectId}/release`
}

export function projectReleaseRef(projectId: string) {
  return `refs/heads/${projectReleaseBranch(projectId)}`
}

export interface AssistantHomeDocument {
  homeId: string
}

export interface ProjectRepoLink {
  repoId: string
  repoPath: string
  projectPath?: string
}

export interface ProjectLink {
  projectId: string
  label?: string
  primaryRepoId: string
  repos: ProjectRepoLink[]
}

export interface ProjectLinksDocument {
  projects: ProjectLink[]
}

export interface ProjectRepoDocument {
  repoId: string
  projectPath?: string
  releaseCommit?: string
}

export interface ProjectDocument {
  projectId: string
  primaryRepoId: string
  repos: ProjectRepoDocument[]
}

export interface LinkedProjectRepo extends ProjectRepoLink {
  projectPath: string
  integrationRoot: string
  primary: boolean
}

export interface LinkedProject extends ProjectLink {
  repos: LinkedProjectRepo[]
  /** Primary Repo convenience projection. */
  repoPath: string
  /** Primary Repo portable source scope. */
  projectPath: string
  /** Primary Repo canonical document root. */
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
