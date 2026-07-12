import type { ProjectCodingDefaults } from './projectCodingDefaults'

export const HOPI_RELEASE_BRANCH = 'hopi/release'
export const HOPI_RELEASE_REF = `refs/heads/${HOPI_RELEASE_BRANCH}`

export interface AssistantHomeDocument {
  version: 1
  homeId: string
}

export interface ProjectLink {
  projectId: string
  repoPath: string
  codingDefaults?: ProjectCodingDefaults
}

export interface ProjectLinksDocument {
  version: 1
  projects: ProjectLink[]
}

export interface ProjectDocument {
  version: 1
  projectId: string
}

export interface LinkedProject extends ProjectLink {
  integrationRoot: string
}
