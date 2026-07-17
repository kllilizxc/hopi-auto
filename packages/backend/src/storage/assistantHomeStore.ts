import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import {
  DEFAULT_ASSISTANT_PREFERENCE,
  normalizeAssistantPreference,
} from '../domain/assistantPreference'
import {
  type AssistantHomeDocument,
  DEFAULT_PRIMARY_REPO_ID,
  HOPI_RELEASE_BRANCH,
  HOPI_RELEASE_REF,
  type LinkedProject,
  type LinkedProjectRepo,
  type ProjectDocument,
  type ProjectLink,
  type ProjectLinksDocument,
  type ProjectRepoDocument,
  type ProjectRepoLink,
} from '../domain/project'
import {
  type ProjectCodingDefaults,
  normalizeProjectCodingDefaults,
  projectCodingDefaultsInputSchema,
} from '../domain/projectCodingDefaults'
import {
  legacyProjectDocumentSchema,
  projectDocumentSchema,
  validateProjectDocument,
} from '../domain/projectDocument'
import {
  isNormalizedProjectPath,
  normalizeProjectPath,
  storedProjectPath,
} from '../domain/projectPath'
import { STABLE_ID_PATTERN, deriveReadableId } from '../domain/stableId'
import { PublicationCoordinator, hashBytes } from '../publication/publisher'
import { managedRepoWorktreePaths, managedTaskWorktreePath } from '../runtime/managedWorktreePaths'
import {
  type GitProjectDirectoryInspection,
  ProjectDirectoryError,
  inspectGitProjectDirectory,
} from '../runtime/projectDirectory'
import { relocateRegisteredWorktree } from '../runtime/worktreeRelocator'
import { withFileLock } from './lock'

const assistantHomeDocumentSchema = z
  .object({
    version: z.literal(1),
    homeId: z.string().regex(STABLE_ID_PATTERN),
  })
  .strict()

const legacyProjectLinkSchema = z
  .object({
    projectId: z.string().regex(STABLE_ID_PATTERN),
    repoPath: z.string().min(1),
    codingDefaults: projectCodingDefaultsInputSchema
      .transform((value) => normalizeProjectCodingDefaults(value))
      .optional(),
  })
  .strict()

const projectRepoLinkSchema = z
  .object({
    repoId: z.string().regex(STABLE_ID_PATTERN),
    repoPath: z.string().min(1),
    projectPath: z.string().refine(isNormalizedProjectPath).optional(),
  })
  .strict()

const legacyMultiRepoProjectLinkSchema = z
  .object({
    projectId: z.string().regex(STABLE_ID_PATTERN),
    primaryRepoId: z.string().regex(STABLE_ID_PATTERN),
    repos: z.array(projectRepoLinkSchema).min(1),
    codingDefaults: projectCodingDefaultsInputSchema
      .transform((value) => normalizeProjectCodingDefaults(value))
      .optional(),
  })
  .strict()

const legacyMultiRepoProjectLinksDocumentSchema = z
  .object({
    version: z.literal(2),
    projects: z.array(legacyMultiRepoProjectLinkSchema),
  })
  .strict()

const projectLinkSchema = z
  .object({
    projectId: z.string().regex(STABLE_ID_PATTERN),
    primaryRepoId: z.string().regex(STABLE_ID_PATTERN),
    repos: z
      .array(projectRepoLinkSchema.extend({ deliveryBranch: z.string().min(1) }).strict())
      .min(1),
    codingDefaults: projectCodingDefaultsInputSchema
      .transform((value) => normalizeProjectCodingDefaults(value))
      .optional(),
  })
  .strict()

const projectLinksDocumentSchema = z
  .object({
    version: z.literal(3),
    projects: z.array(projectLinkSchema),
  })
  .strict()

const legacyProjectLinksDocumentSchema = z
  .object({
    version: z.literal(1),
    projects: z.array(legacyProjectLinkSchema),
  })
  .strict()

export interface AssistantHomePaths {
  rootDir: string
  hopiDir: string
  homeDocumentPath: string
  projectLinksPath: string
  preferenceDocumentPath: string
  mutationLockPath: string
  projectDir(projectId: string): string
  integrationRoot(projectId: string): string
  repoIntegrationRoot(projectId: string, repoId: string, primaryRepoId: string): string
  projectDocumentPath(projectId: string): string
  managedRepoRoot(repoPath: string): string
  managedIntegrationRoot(repoPath: string): string
  managedProjectDocumentPath(repoPath: string): string
}

export type LinkProjectInput =
  | {
      projectId?: string
      repoPath: string
      repoId?: string
      projectPath?: string
      primaryRepoId?: never
      repos?: never
    }
  | {
      projectId?: string
      primaryRepoId: string
      repos: ProjectRepoLink[]
      repoPath?: never
      repoId?: never
    }

export interface LinkRepoInput {
  projectId: string
  repoId: string
  repoPath: string
  projectPath?: string
}

export interface RebindProjectInput {
  projectId: string
  repoPath: string
  projectPath?: string
}

export interface RebindRepoInput extends RebindProjectInput {
  repoId: string
}

export interface RebindProjectReposInput {
  projectId: string
  repos: ProjectRepoLink[]
}

export interface UpdateProjectSettingsInput {
  projectId: string
  codingDefaults: ProjectCodingDefaults | null
}

export interface AssistantHomeStore {
  paths: AssistantHomePaths
  initialize(): Promise<AssistantHomeDocument>
  readHome(): Promise<AssistantHomeDocument>
  listProjects(): Promise<LinkedProject[]>
  readProject(projectId: string): Promise<LinkedProject>
  linkProject(input: LinkProjectInput): Promise<LinkedProject>
  linkRepo(input: LinkRepoInput): Promise<LinkedProject>
  rebindProject(input: RebindProjectInput): Promise<LinkedProject>
  rebindRepo(input: RebindRepoInput): Promise<LinkedProject>
  rebindRepos(input: RebindProjectReposInput): Promise<LinkedProject>
  updateProjectSettings(input: UpdateProjectSettingsInput): Promise<LinkedProject>
  validateProject(projectId: string): Promise<LinkedProject>
}

export class AssistantHomeStoreError extends Error {
  constructor(
    readonly code:
      | 'invalid_home'
      | 'invalid_project'
      | 'project_conflict'
      | 'project_not_found'
      | 'repo_invalid',
    message: string,
  ) {
    super(message)
  }
}

export function createAssistantHomePaths(rootDir = process.cwd()): AssistantHomePaths {
  const absoluteRoot = resolve(rootDir)
  const hopiDir = join(absoluteRoot, '.hopi')

  return {
    rootDir: absoluteRoot,
    hopiDir,
    homeDocumentPath: join(hopiDir, 'home.yml'),
    projectLinksPath: join(hopiDir, 'projects.yml'),
    preferenceDocumentPath: join(hopiDir, 'preference.md'),
    mutationLockPath: join(hopiDir, 'home.lock'),
    projectDir(projectId) {
      assertStableId(projectId, 'projectId')
      return join(hopiDir, 'projects', projectId)
    },
    integrationRoot(projectId) {
      return join(this.projectDir(projectId), 'integration')
    },
    repoIntegrationRoot(projectId, repoId, primaryRepoId) {
      assertStableId(repoId, 'repoId')
      assertStableId(primaryRepoId, 'primaryRepoId')
      return repoId === primaryRepoId
        ? this.integrationRoot(projectId)
        : join(this.projectDir(projectId), 'repos', repoId, 'integration')
    },
    projectDocumentPath(projectId) {
      return join(this.integrationRoot(projectId), '.hopi', 'project.yml')
    },
    managedRepoRoot(repoPath) {
      return managedRepoWorktreePaths(repoPath).root
    },
    managedIntegrationRoot(repoPath) {
      return managedRepoWorktreePaths(repoPath).integration
    },
    managedProjectDocumentPath(repoPath) {
      return join(this.managedIntegrationRoot(repoPath), '.hopi', 'project.yml')
    },
  }
}

export function createAssistantHomeStore(
  rootDir = process.cwd(),
  publisher = new PublicationCoordinator(),
): AssistantHomeStore {
  const paths = createAssistantHomePaths(rootDir)

  const store: AssistantHomeStore = {
    paths,
    async initialize() {
      return withFileLock(paths.mutationLockPath, async () => {
        const existing = await readOptionalYaml(
          paths.homeDocumentPath,
          assistantHomeDocumentSchema,
          'Assistant home',
        )
        if (existing) {
          const links = await ensureProjectLinksDocument(paths.projectLinksPath)
          await ensureAssistantPreferenceDocument(paths.preferenceDocumentPath)
          await migrateManagedWorktrees(paths, links.projects)
          return existing
        }

        const home: AssistantHomeDocument = {
          version: 1,
          homeId: `H-${crypto.randomUUID()}`,
        }
        await writeYamlAtomically(paths.homeDocumentPath, home)
        const links = await ensureProjectLinksDocument(paths.projectLinksPath)
        await ensureAssistantPreferenceDocument(paths.preferenceDocumentPath)
        await migrateManagedWorktrees(paths, links.projects)
        return home
      })
    },
    async readHome() {
      const home = await readOptionalYaml(
        paths.homeDocumentPath,
        assistantHomeDocumentSchema,
        'Assistant home',
      )
      if (!home) {
        throw new AssistantHomeStoreError(
          'invalid_home',
          `Missing Assistant home document: ${paths.homeDocumentPath}`,
        )
      }
      return home
    },
    async listProjects() {
      await this.readHome()
      const links = await readProjectLinks(paths.projectLinksPath)
      assertUniqueProjectLinks(links.projects)
      return links.projects.map((link) => presentProject(paths, link))
    },
    async readProject(projectId) {
      assertStableId(projectId, 'projectId')
      const project = (await this.listProjects()).find((entry) => entry.projectId === projectId)
      if (!project) {
        throw new AssistantHomeStoreError(
          'project_not_found',
          `Project is not linked: ${projectId}`,
        )
      }
      return project
    },
    async linkProject(input) {
      await this.initialize()

      return withFileLock(paths.mutationLockPath, async () => {
        const requested = normalizeLinkProjectInput(input)
        const { primaryRepoId, repos } = requested
        if (requested.projectId) assertStableId(requested.projectId, 'projectId')
        assertStableId(primaryRepoId, 'primaryRepoId')
        for (const repo of repos) assertStableId(repo.repoId, 'repoId')
        const inspected = await Promise.all(
          repos.map(async (repo) => ({
            ...repo,
            inspection: await inspectRepo(repo.repoPath, repo.projectPath),
          })),
        )
        const primary = inspected.find((repo) => repo.repoId === primaryRepoId)
        if (!primary) {
          throw new AssistantHomeStoreError(
            'project_conflict',
            `Primary Repo is missing: ${primaryRepoId}`,
          )
        }
        const links = await readProjectLinks(paths.projectLinksPath)
        assertUniqueProjectLinks(links.projects)
        const byRepos = await Promise.all(
          inspected.map((repo) => findLinkForRepo(links.projects, repo.inspection)),
        )

        if (!requested.projectId) {
          const existingLinks = [
            ...new Set(byRepos.filter((link): link is ProjectLink => Boolean(link))),
          ]
          if (
            existingLinks.length === 1 &&
            existingLinks[0] &&
            exactProjectLink(existingLinks[0], primaryRepoId, inspected)
          ) {
            return this.validateProject(existingLinks[0].projectId)
          }
        }

        const projectId = requested.projectId ?? deriveProjectId(primary.inspection, links.projects)
        assertUniqueRequestedRepos(projectId, primaryRepoId, inspected)
        const byId = links.projects.find((entry) => entry.projectId === projectId)
        if (byId || byRepos.some(Boolean)) {
          if (byId && exactProjectLink(byId, primaryRepoId, inspected)) {
            return this.validateProject(projectId)
          }

          throw new AssistantHomeStoreError(
            'project_conflict',
            byId
              ? `Project ID is already linked to another Repo: ${projectId}`
              : `Repo is already linked as Project: ${byRepos.find(Boolean)?.projectId}`,
          )
        }

        const link: ProjectLink = {
          projectId,
          primaryRepoId,
          repos: inspected
            .map((repo) => repoLink(repo.repoId, repo.inspection))
            .sort((left, right) => repoLinkOrder(primaryRepoId, left, right)),
        }
        await ensureManagedPrimaryRoot(
          paths,
          projectId,
          primaryRepoId,
          primary.inspection,
          publisher,
        )
        for (const repo of inspected) {
          if (repo.repoId === primaryRepoId) continue
          await ensureManagedSecondaryRoot(paths, link, repo.repoId, repo.inspection)
        }
        const projectDocument: ProjectDocument = {
          version: 2,
          projectId,
          primaryRepoId,
          repos: await Promise.all(
            link.repos.map(async (repo) =>
              repo.repoId === primaryRepoId
                ? repoDocument(repo)
                : {
                    ...repoDocument(repo),
                    releaseCommit: (await runGit(repo.repoPath, ['rev-parse', HOPI_RELEASE_REF]))
                      .stdout,
                  },
            ),
          ),
        }
        await publishProjectDocument(paths, link, projectDocument, publisher)
        links.projects.push(link)
        links.projects.sort((left, right) => left.projectId.localeCompare(right.projectId))
        await publishYamlFile(
          publisher,
          { id: 'assistant-home', path: paths.rootDir },
          paths.projectLinksPath,
          links,
          projectLinksDocumentSchema,
          'Project links',
        )
        return presentProject(paths, link)
      })
    },
    async linkRepo(input) {
      assertStableId(input.projectId, 'projectId')
      assertStableId(input.repoId, 'repoId')
      await this.initialize()
      return withFileLock(paths.mutationLockPath, async () => {
        const links = await readProjectLinks(paths.projectLinksPath)
        assertUniqueProjectLinks(links.projects)
        const link = links.projects.find((entry) => entry.projectId === input.projectId)
        if (!link) {
          throw new AssistantHomeStoreError(
            'project_not_found',
            `Project is not linked: ${input.projectId}`,
          )
        }
        const repo = await inspectRepo(input.repoPath, input.projectPath)
        const existing = link.repos.find((candidate) => candidate.repoId === input.repoId)
        const byRepo = await findLinkForRepo(links.projects, repo)
        if (existing || byRepo) {
          if (
            existing?.repoPath === repo.repoPath &&
            normalizeProjectPath(existing.projectPath) === repo.projectPath &&
            byRepo?.projectId === input.projectId &&
            byRepo.repos.some((candidate) => candidate.repoId === input.repoId)
          ) {
            return this.validateProject(input.projectId)
          }
          throw new AssistantHomeStoreError(
            'project_conflict',
            existing
              ? `Repo ID is already linked in Project ${input.projectId}: ${input.repoId}`
              : `Repo is already linked in Project ${byRepo?.projectId}`,
          )
        }

        await ensureManagedSecondaryRoot(paths, link, input.repoId, repo)
        const releaseCommit = (await runGit(repo.repoPath, ['rev-parse', HOPI_RELEASE_REF])).stdout
        const projectDocument = await readAndValidateProjectDocument(paths, link)
        const documentedRepo = projectDocument.repos.find(
          (candidate) => candidate.repoId === input.repoId,
        )
        if (documentedRepo && documentedRepo.releaseCommit !== releaseCommit) {
          throw invalidProject(
            input.projectId,
            `partially linked Repo ${input.repoId} has an unexpected release`,
          )
        }
        const nextProjectDocument: ProjectDocument = {
          ...projectDocument,
          repos: documentedRepo
            ? projectDocument.repos
            : [
                ...projectDocument.repos,
                { ...repoDocument({ repoId: input.repoId, ...repo }), releaseCommit },
              ].sort((left, right) => repoDocumentOrder(link.primaryRepoId, left, right)),
        }
        await publishProjectDocument(paths, link, nextProjectDocument, publisher)

        const updatedLink: ProjectLink = {
          ...link,
          repos: [...link.repos, repoLink(input.repoId, repo)].sort((left, right) =>
            repoLinkOrder(link.primaryRepoId, left, right),
          ),
        }
        links.projects = links.projects.map((entry) =>
          entry.projectId === input.projectId ? updatedLink : entry,
        )
        await publishYamlFile(
          publisher,
          { id: 'assistant-home', path: paths.rootDir },
          paths.projectLinksPath,
          links,
          projectLinksDocumentSchema,
          'Project links',
        )
        return presentProject(paths, updatedLink)
      })
    },
    async rebindProject(input) {
      const project = await this.readProject(input.projectId)
      return this.rebindRepo({
        ...input,
        repoId: project.primaryRepoId,
      })
    },
    async rebindRepo(input) {
      assertStableId(input.projectId, 'projectId')
      assertStableId(input.repoId, 'repoId')
      const project = await this.readProject(input.projectId)
      if (!project.repos.some((repo) => repo.repoId === input.repoId)) {
        throw new AssistantHomeStoreError(
          'project_not_found',
          `Repo is not linked in Project ${input.projectId}: ${input.repoId}`,
        )
      }
      return this.rebindRepos({
        projectId: input.projectId,
        repos: project.repos.map((repo) => ({
          repoId: repo.repoId,
          repoPath: repo.repoId === input.repoId ? input.repoPath : repo.repoPath,
          projectPath:
            repo.repoId === input.repoId
              ? (input.projectPath ?? repo.projectPath)
              : repo.projectPath,
        })),
      })
    },
    async rebindRepos(input) {
      assertStableId(input.projectId, 'projectId')
      for (const repo of input.repos) assertStableId(repo.repoId, 'repoId')
      await this.initialize()
      return withFileLock(paths.mutationLockPath, async () => {
        const links = await readProjectLinks(paths.projectLinksPath)
        assertUniqueProjectLinks(links.projects)
        const link = links.projects.find((entry) => entry.projectId === input.projectId)
        if (!link) {
          throw new AssistantHomeStoreError(
            'project_not_found',
            `Project is not linked: ${input.projectId}`,
          )
        }
        const requestedIds = input.repos.map((repo) => repo.repoId).sort()
        const linkedIds = link.repos.map((repo) => repo.repoId).sort()
        if (JSON.stringify(requestedIds) !== JSON.stringify(linkedIds)) {
          throw new AssistantHomeStoreError(
            'project_conflict',
            `Rebind requires the complete Repo set for ${input.projectId}: ${linkedIds.join(', ')}`,
          )
        }
        const inspected = await Promise.all(
          input.repos.map(async (repo) => ({
            ...repo,
            inspection: await inspectRepo(repo.repoPath, repo.projectPath),
          })),
        )
        assertUniqueRequestedRepos(input.projectId, link.primaryRepoId, inspected)
        await assertRepoSetAvailableForRebind(links.projects, input.projectId, inspected)
        for (const requested of inspected) {
          const repoLink = link.repos.find((repo) => repo.repoId === requested.repoId)
          if (!repoLink)
            throw invalidProject(input.projectId, `Repo ${requested.repoId} is missing`)
          if (normalizeProjectPath(repoLink.projectPath) !== requested.inspection.projectPath) {
            throw new AssistantHomeStoreError(
              'project_conflict',
              `Rebind cannot change projectPath for ${requested.repoId}; link a different Project instead`,
            )
          }
          if (repoLink.deliveryBranch !== requested.inspection.deliveryBranch) {
            throw new AssistantHomeStoreError(
              'project_conflict',
              `Rebind checkout for ${requested.repoId} is on ${requested.inspection.deliveryBranch}, expected delivery branch ${repoLink.deliveryBranch}`,
            )
          }
          await repairManagedRepoRoot(paths, link, repoLink, requested.inspection)
        }
        const updatedLink: ProjectLink = {
          ...link,
          repos: inspected
            .map((repo) => repoLink(repo.repoId, repo.inspection))
            .sort((left, right) => repoLinkOrder(link.primaryRepoId, left, right)),
        }
        const projectDocument = await readAndValidateProjectDocument(paths, updatedLink, publisher)
        assertProjectMembership(presentProject(paths, updatedLink), projectDocument)
        for (const repo of presentProject(paths, updatedLink).repos) {
          const targetHead = await validateManagedRepoProjection(input.projectId, repo)
          if (repo.primary) continue
          const documented = projectDocument.repos.find(
            (candidate) => candidate.repoId === repo.repoId,
          )?.releaseCommit
          if (documented !== targetHead) {
            throw invalidProject(
              input.projectId,
              `Repo ${repo.repoId} release disagrees with project.yml after rebind`,
            )
          }
        }
        links.projects = links.projects.map((entry) =>
          entry.projectId === input.projectId ? updatedLink : entry,
        )
        await publishYamlFile(
          publisher,
          { id: 'assistant-home', path: paths.rootDir },
          paths.projectLinksPath,
          links,
          projectLinksDocumentSchema,
          'Project links',
        )
        return presentProject(paths, updatedLink)
      })
    },
    async updateProjectSettings(input) {
      assertStableId(input.projectId, 'projectId')
      await this.initialize()
      return withFileLock(paths.mutationLockPath, async () => {
        const links = await readProjectLinks(paths.projectLinksPath)
        assertUniqueProjectLinks(links.projects)
        const link = links.projects.find((entry) => entry.projectId === input.projectId)
        if (!link) {
          throw new AssistantHomeStoreError(
            'project_not_found',
            `Project is not linked: ${input.projectId}`,
          )
        }

        const codingDefaults = input.codingDefaults
          ? normalizeProjectCodingDefaults(input.codingDefaults)
          : undefined
        if (sameCodingDefaults(link.codingDefaults, codingDefaults)) {
          return presentProject(paths, link)
        }
        const updatedLink = codingDefaults
          ? { ...link, codingDefaults }
          : {
              projectId: link.projectId,
              primaryRepoId: link.primaryRepoId,
              repos: link.repos,
            }
        links.projects = links.projects.map((entry) =>
          entry.projectId === input.projectId ? updatedLink : entry,
        )

        await publishYamlFile(
          publisher,
          { id: 'assistant-home', path: paths.rootDir },
          paths.projectLinksPath,
          links,
          projectLinksDocumentSchema,
          'Project links',
        )
        return presentProject(paths, updatedLink)
      })
    },
    async validateProject(projectId) {
      const project = await this.readProject(projectId)
      const projectDocument = await readAndValidateProjectDocument(paths, project)
      assertProjectMembership(project, projectDocument)

      for (const repo of project.repos) {
        const targetHead = await validateManagedRepoProjection(projectId, repo)
        if (repo.primary) continue
        const documented = projectDocument.repos.find(
          (candidate) => candidate.repoId === repo.repoId,
        )?.releaseCommit
        if (documented !== targetHead) {
          throw invalidProject(
            projectId,
            `Repo ${repo.repoId} release ${targetHead} disagrees with project.yml ${documented ?? 'missing'}`,
          )
        }
      }

      return project
    },
  }

  return store
}

type RepoInspection = GitProjectDirectoryInspection & { deliveryBranch: string }

async function findLinkForRepo(links: ProjectLink[], repo: RepoInspection) {
  for (const link of links) {
    for (const candidate of link.repos) {
      if (candidate.repoPath === repo.repoPath) return link
      const linkedRepo = await inspectRepo(candidate.repoPath).catch((error) => {
        throw new AssistantHomeStoreError(
          'invalid_home',
          `Cannot validate linked Repo ${candidate.repoId} for ${link.projectId}: ${errorMessage(error)}`,
        )
      })
      if (linkedRepo.commonDir === repo.commonDir) return link
    }
  }
  return undefined
}

async function assertRepoSetAvailableForRebind(
  links: ProjectLink[],
  projectId: string,
  repos: Array<ProjectRepoLink & { inspection: RepoInspection }>,
) {
  for (const link of links) {
    if (link.projectId === projectId) continue
    for (const candidate of link.repos) {
      const linkedRepo = await inspectRepo(candidate.repoPath).catch((error) => {
        throw new AssistantHomeStoreError(
          'invalid_home',
          `Cannot validate linked Repo ${candidate.repoId} for ${link.projectId}: ${errorMessage(error)}`,
        )
      })
      if (
        repos.some(
          (repo) =>
            candidate.repoPath === repo.inspection.repoPath ||
            linkedRepo.commonDir === repo.inspection.commonDir,
        )
      ) {
        throw new AssistantHomeStoreError(
          'project_conflict',
          `Repo is already linked as ${link.projectId}/${candidate.repoId}`,
        )
      }
    }
  }
}

function normalizeLinkProjectInput(input: LinkProjectInput) {
  if ('repos' in input && input.repos) {
    return {
      projectId: input.projectId,
      primaryRepoId: input.primaryRepoId,
      repos: input.repos,
    }
  }
  const repoId = input.repoId ?? DEFAULT_PRIMARY_REPO_ID
  return {
    projectId: input.projectId,
    primaryRepoId: repoId,
    repos: [{ repoId, repoPath: input.repoPath, projectPath: input.projectPath }],
  }
}

function deriveProjectId(primary: RepoInspection, links: ProjectLink[]) {
  const selectedFolder =
    primary.projectPath === '.' ? basename(primary.repoPath) : basename(primary.projectPath)
  return deriveReadableId(
    'P',
    selectedFolder,
    links.map((link) => link.projectId),
  )
}

function assertUniqueRequestedRepos(
  projectId: string,
  primaryRepoId: string,
  repos: Array<ProjectRepoLink & { inspection: RepoInspection }>,
) {
  const ids = new Set<string>()
  const commonDirs = new Set<string>()
  for (const repo of repos) {
    if (ids.has(repo.repoId)) {
      throw new AssistantHomeStoreError(
        'project_conflict',
        `Duplicate Repo ID in Project ${projectId}: ${repo.repoId}`,
      )
    }
    if (commonDirs.has(repo.inspection.commonDir)) {
      throw new AssistantHomeStoreError(
        'project_conflict',
        'The selected paths contain the same Git Repo more than once',
      )
    }
    ids.add(repo.repoId)
    commonDirs.add(repo.inspection.commonDir)
  }
  if (!ids.has(primaryRepoId)) {
    throw new AssistantHomeStoreError(
      'project_conflict',
      `Primary Repo is missing in Project ${projectId}: ${primaryRepoId}`,
    )
  }
}

function exactProjectLink(
  link: ProjectLink,
  primaryRepoId: string,
  repos: Array<ProjectRepoLink & { inspection: RepoInspection }>,
) {
  if (link.primaryRepoId !== primaryRepoId || link.repos.length !== repos.length) return false
  return repos.every((repo) =>
    link.repos.some(
      (candidate) =>
        candidate.repoId === repo.repoId &&
        candidate.repoPath === repo.inspection.repoPath &&
        normalizeProjectPath(candidate.projectPath) === repo.inspection.projectPath,
    ),
  )
}

async function inspectRepo(inputPath: string, projectPath?: string): Promise<RepoInspection> {
  try {
    const repo = await inspectGitProjectDirectory(inputPath, projectPath)
    return { ...repo, deliveryBranch: await readDeliveryBranch(repo.repoPath) }
  } catch (error) {
    if (error instanceof ProjectDirectoryError) {
      throw new AssistantHomeStoreError('repo_invalid', error.message)
    }
    throw error
  }
}

function repoLink(repoId: string, repo: RepoInspection): ProjectRepoLink {
  return {
    repoId,
    repoPath: repo.repoPath,
    deliveryBranch: repo.deliveryBranch,
    ...(storedProjectPath(repo.projectPath) ? { projectPath: repo.projectPath } : {}),
  }
}

function repoDocument(repo: Pick<ProjectRepoLink, 'repoId' | 'projectPath'>): ProjectRepoDocument {
  const projectPath = storedProjectPath(repo.projectPath)
  return { repoId: repo.repoId, ...(projectPath ? { projectPath } : {}) }
}

async function ensureManagedPrimaryRoot(
  paths: AssistantHomePaths,
  projectId: string,
  repoId: string,
  repo: RepoInspection,
  publisher: PublicationCoordinator,
) {
  const integrationRoot = paths.managedIntegrationRoot(repo.repoPath)
  if (await pathExists(integrationRoot)) {
    const entries = await readdir(integrationRoot)
    if (entries.length > 0) {
      await validateExistingManagedRepoRoot(integrationRoot, projectId, repoId, repo)
      const link: ProjectLink = {
        projectId,
        primaryRepoId: repoId,
        repos: [repoLink(repoId, repo)],
      }
      const document = await readAndValidateProjectDocument(paths, link, publisher)
      if (document.projectId !== projectId || document.primaryRepoId !== repoId) {
        throw invalidProject(projectId, 'existing project.yml has a different identity')
      }
      return
    }
    await rm(integrationRoot, { recursive: true, force: true })
  }

  await createManagedRepoRoot(integrationRoot, projectId, repoId, repo)
  const projectDocument: ProjectDocument = {
    version: 2,
    projectId,
    primaryRepoId: repoId,
    repos: [repoDocument(repoLink(repoId, repo))],
  }
  await publishProjectDocument(
    paths,
    linkForRepo(projectId, repoId, repo),
    projectDocument,
    publisher,
  )
}

async function ensureManagedSecondaryRoot(
  paths: AssistantHomePaths,
  project: ProjectLink,
  repoId: string,
  repo: RepoInspection,
) {
  const integrationRoot = paths.managedIntegrationRoot(repo.repoPath)
  if (await pathExists(integrationRoot)) {
    const entries = await readdir(integrationRoot)
    if (entries.length > 0) {
      await validateExistingManagedRepoRoot(integrationRoot, project.projectId, repoId, repo)
      return
    }
    await rm(integrationRoot, { recursive: true, force: true })
  }
  await createManagedRepoRoot(integrationRoot, project.projectId, repoId, repo)
}

async function createManagedRepoRoot(
  integrationRoot: string,
  projectId: string,
  repoId: string,
  repo: RepoInspection,
) {
  await mkdir(dirname(integrationRoot), { recursive: true })
  const targetExists =
    (await runGit(repo.repoPath, ['show-ref', '--verify', '--quiet', HOPI_RELEASE_REF], true))
      .exitCode === 0
  const args = targetExists
    ? ['-c', 'core.autocrlf=false', 'worktree', 'add', integrationRoot, HOPI_RELEASE_BRANCH]
    : [
        '-c',
        'core.autocrlf=false',
        'worktree',
        'add',
        '-b',
        HOPI_RELEASE_BRANCH,
        integrationRoot,
        'HEAD',
      ]
  const result = await runGit(repo.repoPath, args, true)
  if (result.exitCode !== 0) {
    throw new AssistantHomeStoreError(
      'invalid_project',
      `Cannot create managed integration worktree for ${projectId}/${repoId}: ${result.stderr || result.stdout}`,
    )
  }
}

async function repairManagedRepoRoot(
  paths: AssistantHomePaths,
  project: ProjectLink,
  repoLink: ProjectRepoLink,
  repo: RepoInspection,
) {
  const previousIntegrationRoot = paths.managedIntegrationRoot(repoLink.repoPath)
  const integrationRoot = paths.managedIntegrationRoot(repo.repoPath)
  if (previousIntegrationRoot !== integrationRoot && (await pathExists(previousIntegrationRoot))) {
    if (!(await inspectRepo(previousIntegrationRoot).catch(() => null))) {
      await repairMovedManagedPointers(previousIntegrationRoot, repo)
      const repair = await runGit(
        repo.repoPath,
        ['worktree', 'repair', previousIntegrationRoot],
        true,
      )
      if (repair.exitCode !== 0) {
        throw invalidProject(
          project.projectId,
          `cannot repair moved managed worktree: ${repair.stderr || repair.stdout}`,
        )
      }
    }
    await relocateRegisteredWorktree({
      repoRoot: repo.repoPath,
      from: previousIntegrationRoot,
      to: integrationRoot,
      expectedBranch: HOPI_RELEASE_BRANCH,
    })
  }
  if (!(await pathExists(integrationRoot))) {
    if (repoLink.repoId !== project.primaryRepoId) {
      await createManagedRepoRoot(integrationRoot, project.projectId, repoLink.repoId, repo)
    } else {
      throw invalidProject(
        project.projectId,
        'managed integration root is missing; refusing to reconstruct potentially newer canonical documents from Git',
      )
    }
  } else {
    if (!(await inspectRepo(integrationRoot).catch(() => null))) {
      await repairMovedManagedPointers(integrationRoot, repo)
    }
    const repair = await runGit(repo.repoPath, ['worktree', 'repair', integrationRoot], true)
    if (repair.exitCode !== 0) {
      throw invalidProject(
        project.projectId,
        `cannot repair managed integration worktree: ${repair.stderr || repair.stdout}`,
      )
    }
  }
  await validateExistingManagedRepoRoot(integrationRoot, project.projectId, repoLink.repoId, repo)
  const [managedHead, targetHead] = await Promise.all([
    runGit(integrationRoot, ['rev-parse', 'HEAD']),
    runGit(repo.repoPath, ['rev-parse', HOPI_RELEASE_REF]),
  ])
  if (managedHead.stdout !== targetHead.stdout) {
    throw invalidProject(
      project.projectId,
      'rebound managed root does not materialize hopi/release',
    )
  }
}

async function repairMovedManagedPointers(integrationRoot: string, repo: RepoInspection) {
  const managedPointerPath = join(integrationRoot, '.git')
  const pointerFile = Bun.file(managedPointerPath)
  if (!(await pointerFile.exists())) return
  const pointer = (await pointerFile.text()).trim().match(/^gitdir:\s*(.+)$/)
  const previousAdminRoot = pointer?.[1]
  if (!previousAdminRoot) return
  const adminName = basename(previousAdminRoot)
  const adminRoot = join(repo.commonDir, 'worktrees', adminName)
  const [adminStats, head] = await Promise.all([
    stat(adminRoot).catch(() => null),
    Bun.file(join(adminRoot, 'HEAD'))
      .text()
      .catch(() => ''),
  ])
  if (!adminStats?.isDirectory() || head.trim() !== `ref: ${HOPI_RELEASE_REF}`) return

  await Promise.all([
    writePointerAtomically(managedPointerPath, `gitdir: ${adminRoot}\n`),
    writePointerAtomically(join(adminRoot, 'gitdir'), `${managedPointerPath}\n`),
  ])
}

async function writePointerAtomically(path: string, content: string) {
  const temporary = `${path}.hopi-tmp-${crypto.randomUUID()}`
  await Bun.write(temporary, content)
  await rename(temporary, path)
}

async function validateExistingManagedRepoRoot(
  integrationRoot: string,
  projectId: string,
  repoId: string,
  repo: RepoInspection,
) {
  const managedRepo = await inspectRepo(integrationRoot).catch(() => null)
  if (!managedRepo || managedRepo.commonDir !== repo.commonDir) {
    throw invalidProject(
      projectId,
      `existing managed path for ${repoId} is not the linked Repo worktree`,
    )
  }

  const branch = await runGit(integrationRoot, ['branch', '--show-current'])
  if (branch.stdout !== HOPI_RELEASE_BRANCH) {
    throw invalidProject(projectId, `managed worktree ${repoId} is not on ${HOPI_RELEASE_BRANCH}`)
  }
}

function presentProject(paths: AssistantHomePaths, link: ProjectLink): LinkedProject {
  const repos: LinkedProjectRepo[] = link.repos.map((repo) => ({
    ...repo,
    projectPath: normalizeProjectPath(repo.projectPath),
    deliveryBranch: requireDeliveryBranch(link.projectId, repo),
    primary: repo.repoId === link.primaryRepoId,
    integrationRoot: paths.managedIntegrationRoot(repo.repoPath),
  }))
  const primary = repos.find((repo) => repo.primary)
  if (!primary) throw invalidProject(link.projectId, 'primary Repo is missing from projects.yml')
  return {
    ...link,
    repos,
    repoPath: primary.repoPath,
    projectPath: primary.projectPath,
    integrationRoot: primary.integrationRoot,
  }
}

function sameCodingDefaults(
  left: ProjectCodingDefaults | undefined,
  right: ProjectCodingDefaults | undefined,
) {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function ensureProjectLinksDocument(path: string) {
  const existing = await readRawProjectLinks(path)
  if (existing) {
    const normalized = await normalizeProjectLinks(existing)
    assertUniqueProjectLinks(normalized.projects)
    if (existing.version !== 3) await writeYamlAtomically(path, normalized)
    return normalized
  }

  const links: ProjectLinksDocument = { version: 3, projects: [] }
  await writeYamlAtomically(path, links)
  return links
}

async function ensureAssistantPreferenceDocument(path: string) {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    await writeTextAtomically(path, DEFAULT_ASSISTANT_PREFERENCE)
    return
  }
  try {
    const source = await file.text()
    const normalized = normalizeAssistantPreference(source)
    if (normalized !== source) await writeTextAtomically(path, normalized)
  } catch (error) {
    throw new AssistantHomeStoreError(
      'invalid_home',
      `Preference document is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function readProjectLinks(path: string) {
  const raw = await readRawProjectLinks(path)
  if (!raw) {
    throw new AssistantHomeStoreError('invalid_home', `Missing project links document: ${path}`)
  }
  return normalizeProjectLinks(raw)
}

function assertUniqueProjectLinks(links: ProjectLink[]) {
  const projectIds = new Set<string>()
  const repoPaths = new Set<string>()
  for (const link of links) {
    if (projectIds.has(link.projectId)) {
      throw new AssistantHomeStoreError(
        'invalid_home',
        `Duplicate projectId in projects.yml: ${link.projectId}`,
      )
    }
    projectIds.add(link.projectId)
    const repoIds = new Set<string>()
    for (const repo of link.repos) {
      if (repoIds.has(repo.repoId)) {
        throw new AssistantHomeStoreError(
          'invalid_home',
          `Duplicate repoId in Project ${link.projectId}: ${repo.repoId}`,
        )
      }
      if (repoPaths.has(repo.repoPath)) {
        throw new AssistantHomeStoreError(
          'invalid_home',
          `Duplicate repoPath in projects.yml: ${repo.repoPath}`,
        )
      }
      repoIds.add(repo.repoId)
      repoPaths.add(repo.repoPath)
    }
    if (!repoIds.has(link.primaryRepoId)) {
      throw new AssistantHomeStoreError(
        'invalid_home',
        `Primary Repo is missing in Project ${link.projectId}: ${link.primaryRepoId}`,
      )
    }
  }
}

async function readRawProjectLinks(path: string) {
  return readOptionalYaml(
    path,
    z.union([
      projectLinksDocumentSchema,
      legacyMultiRepoProjectLinksDocumentSchema,
      legacyProjectLinksDocumentSchema,
    ]),
    'Project links',
  )
}

async function normalizeProjectLinks(
  raw:
    | z.infer<typeof projectLinksDocumentSchema>
    | z.infer<typeof legacyMultiRepoProjectLinksDocumentSchema>
    | z.infer<typeof legacyProjectLinksDocumentSchema>,
): Promise<ProjectLinksDocument> {
  if (raw.version === 3) return raw
  const projects =
    raw.version === 2
      ? raw.projects
      : raw.projects.map((project) => ({
          projectId: project.projectId,
          primaryRepoId: DEFAULT_PRIMARY_REPO_ID,
          repos: [{ repoId: DEFAULT_PRIMARY_REPO_ID, repoPath: project.repoPath }],
          ...(project.codingDefaults ? { codingDefaults: project.codingDefaults } : {}),
        }))
  return {
    version: 3,
    projects: await Promise.all(
      projects.map(async (project) => ({
        ...project,
        repos: await Promise.all(
          project.repos.map(async (repo) => ({
            ...repo,
            deliveryBranch: await readDeliveryBranch(repo.repoPath),
          })),
        ),
      })),
    ),
  }
}

async function migrateManagedWorktrees(
  paths: AssistantHomePaths,
  projects: readonly ProjectLink[],
) {
  for (const project of projects) {
    for (const repo of project.repos) {
      if (!(await pathExists(repo.repoPath))) continue
      const legacyRoot = paths.repoIntegrationRoot(
        project.projectId,
        repo.repoId,
        project.primaryRepoId,
      )
      const integrationRoot = paths.managedIntegrationRoot(repo.repoPath)
      if ((await pathExists(legacyRoot)) || (await pathExists(integrationRoot))) {
        await relocateRegisteredWorktree({
          repoRoot: repo.repoPath,
          from: legacyRoot,
          to: integrationRoot,
          expectedBranch: HOPI_RELEASE_BRANCH,
        })
      }
      await migrateTaskWorktrees(project.projectId, repo.repoPath)
    }
  }
}

async function migrateTaskWorktrees(projectId: string, repoPath: string) {
  const listing = await runGit(repoPath, ['worktree', 'list', '--porcelain'])
  const branchPrefix = `refs/heads/hopi/work/${projectId}/`
  for (const block of listing.stdout.split(/\n\s*\n/)) {
    const worktreeLine = block.split('\n').find((line) => line.startsWith('worktree '))
    const branchLine = block.split('\n').find((line) => line.startsWith('branch '))
    const worktreePath = worktreeLine?.slice('worktree '.length)
    const branchRef = branchLine?.slice('branch '.length)
    if (!worktreePath || !branchRef?.startsWith(branchPrefix)) continue
    const identity = branchRef.slice(branchPrefix.length).split('/')
    const [goalId, workId] = identity
    if (!goalId || !workId || identity.length !== 2) continue
    const target = managedTaskWorktreePath(repoPath, goalId, workId)
    if (resolve(worktreePath) === resolve(target)) continue
    await relocateRegisteredWorktree({
      repoRoot: repoPath,
      from: worktreePath,
      to: target,
      expectedBranch: branchRef.slice('refs/heads/'.length),
    })
  }
}

function requirePrimaryRepoLink(
  project: Pick<ProjectLink, 'projectId' | 'primaryRepoId' | 'repos'>,
) {
  const primary = project.repos.find((repo) => repo.repoId === project.primaryRepoId)
  if (!primary) throw invalidProject(project.projectId, 'primary Repo is missing from projects.yml')
  return primary
}

function requireDeliveryBranch(projectId: string, repo: ProjectRepoLink) {
  if (!repo.deliveryBranch) {
    throw new AssistantHomeStoreError(
      'invalid_home',
      `Project ${projectId} Repo ${repo.repoId} is missing deliveryBranch`,
    )
  }
  return repo.deliveryBranch
}

function linkForRepo(projectId: string, repoId: string, repo: RepoInspection): ProjectLink {
  return {
    projectId,
    primaryRepoId: repoId,
    repos: [repoLink(repoId, repo)],
  }
}

async function readDeliveryBranch(repoPath: string) {
  const branch = await runGit(repoPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true)
  if (branch.exitCode !== 0 || !branch.stdout) {
    throw new AssistantHomeStoreError(
      'repo_invalid',
      `Linked checkout must be on a branch so releases can be delivered safely: ${repoPath}`,
    )
  }
  const valid = await runGit(repoPath, ['check-ref-format', '--branch', branch.stdout], true)
  if (valid.exitCode !== 0) {
    throw new AssistantHomeStoreError(
      'repo_invalid',
      `Linked checkout has an invalid delivery branch ${branch.stdout}: ${repoPath}`,
    )
  }
  return branch.stdout
}

async function readAndValidateProjectDocument(
  paths: AssistantHomePaths,
  project: Pick<ProjectLink, 'projectId' | 'primaryRepoId' | 'repos'>,
  publisher?: PublicationCoordinator,
): Promise<ProjectDocument> {
  const primary = requirePrimaryRepoLink(project)
  const raw = await readOptionalYaml(
    paths.managedProjectDocumentPath(primary.repoPath),
    z.union([projectDocumentSchema, legacyProjectDocumentSchema]),
    `Project ${project.projectId}`,
  )
  if (!raw) throw invalidProject(project.projectId, 'project.yml is missing')
  const document: ProjectDocument =
    raw.version === 2
      ? raw
      : {
          version: 2,
          projectId: raw.projectId,
          primaryRepoId: project.primaryRepoId,
          repos: [{ repoId: project.primaryRepoId }],
        }
  assertProjectDocument(document)
  if (document.projectId !== project.projectId) {
    throw invalidProject(project.projectId, 'project.yml has the wrong projectId')
  }
  if (document.primaryRepoId !== project.primaryRepoId) {
    throw invalidProject(project.projectId, 'project.yml has the wrong primaryRepoId')
  }
  if (raw.version === 1 && publisher) {
    await publishProjectDocument(paths, project, document, publisher)
  }
  return document
}

function assertProjectDocument(document: ProjectDocument) {
  try {
    validateProjectDocument(document)
  } catch (error) {
    throw invalidProject(document.projectId, errorMessage(error))
  }
}

function assertProjectMembership(
  project: Pick<LinkedProject, 'projectId' | 'primaryRepoId' | 'repos'>,
  document: ProjectDocument,
) {
  const linked = [...project.repos]
    .map((repo) => `${repo.repoId}=${normalizeProjectPath(repo.projectPath)}`)
    .sort()
  const documented = document.repos
    .map((repo) => `${repo.repoId}=${normalizeProjectPath(repo.projectPath)}`)
    .sort()
  if (JSON.stringify(linked) !== JSON.stringify(documented)) {
    throw invalidProject(
      project.projectId,
      `projects.yml Repo scope disagrees with project.yml (${linked.join(', ')} vs ${documented.join(', ')})`,
    )
  }
}

async function publishProjectDocument(
  paths: AssistantHomePaths,
  project: Pick<ProjectLink, 'projectId' | 'primaryRepoId' | 'repos'>,
  document: ProjectDocument,
  publisher: PublicationCoordinator,
) {
  assertProjectDocument(document)
  const primary = requirePrimaryRepoLink(project)
  const integrationRoot = paths.managedIntegrationRoot(primary.repoPath)
  await publishYamlFile(
    publisher,
    { id: `project:${project.projectId}`, path: integrationRoot },
    paths.managedProjectDocumentPath(primary.repoPath),
    document,
    projectDocumentSchema,
    `Project ${project.projectId}`,
  )
}

async function validateManagedRepoProjection(projectId: string, repo: LinkedProjectRepo) {
  const integrationStats = await stat(repo.integrationRoot).catch(() => null)
  if (!integrationStats?.isDirectory()) {
    throw invalidProject(
      projectId,
      `missing managed integration root for ${repo.repoId}: ${repo.integrationRoot}`,
    )
  }
  const [sourceRepo, managedRepo] = await Promise.all([
    inspectRepo(repo.repoPath),
    inspectRepo(repo.integrationRoot),
  ])
  if (managedRepo.commonDir !== sourceRepo.commonDir) {
    throw invalidProject(projectId, `managed Repo ${repo.repoId} belongs to another Git Repo`)
  }
  const branch = await runGit(repo.integrationRoot, ['branch', '--show-current'])
  if (branch.stdout !== HOPI_RELEASE_BRANCH) {
    throw invalidProject(
      projectId,
      `managed Repo ${repo.repoId} is on ${branch.stdout || 'detached HEAD'}, expected ${HOPI_RELEASE_BRANCH}`,
    )
  }
  const [managedHead, targetHead] = await Promise.all([
    runGit(repo.integrationRoot, ['rev-parse', 'HEAD']),
    runGit(repo.repoPath, ['rev-parse', HOPI_RELEASE_REF]),
  ])
  if (managedHead.stdout !== targetHead.stdout) {
    throw invalidProject(projectId, `managed Repo ${repo.repoId} does not materialize hopi/release`)
  }
  return targetHead.stdout
}

function repoLinkOrder(
  primaryRepoId: string,
  left: Pick<ProjectRepoLink, 'repoId'>,
  right: Pick<ProjectRepoLink, 'repoId'>,
) {
  if (left.repoId === primaryRepoId) return right.repoId === primaryRepoId ? 0 : -1
  if (right.repoId === primaryRepoId) return 1
  return left.repoId.localeCompare(right.repoId)
}

function repoDocumentOrder(
  primaryRepoId: string,
  left: ProjectRepoDocument,
  right: ProjectRepoDocument,
) {
  return repoLinkOrder(primaryRepoId, left, right)
}

async function readOptionalYaml<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  label: string,
): Promise<T | null> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return null
  }

  let raw: unknown
  try {
    raw = parse(await file.text())
  } catch (error) {
    throw new AssistantHomeStoreError(
      label === 'Assistant home' || label === 'Project links' ? 'invalid_home' : 'invalid_project',
      `${label} YAML is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new AssistantHomeStoreError(
      label === 'Assistant home' || label === 'Project links' ? 'invalid_home' : 'invalid_project',
      `${label} document is invalid: ${issues}`,
    )
  }
  return result.data
}

async function writeYamlAtomically(path: string, value: unknown) {
  await writeTextAtomically(path, stringify(value, { indent: 2 }))
}

async function writeTextAtomically(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp.${crypto.randomUUID()}`
  try {
    await Bun.write(temporaryPath, content)
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

async function publishYamlFile<T>(
  publisher: PublicationCoordinator,
  root: { id: string; path: string },
  absolutePath: string,
  value: T,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  label: string,
) {
  const relativePath = relative(root.path, absolutePath).split('\\').join('/')
  const file = Bun.file(absolutePath)
  const existing = (await file.exists()) ? new Uint8Array(await file.arrayBuffer()) : null
  await publisher.publish({
    root,
    supportingWrites: [],
    gateWrite: {
      path: relativePath,
      expectedHash: existing ? await hashBytes(existing) : null,
      content: stringify(value, { indent: 2 }),
    },
    async validateCandidate(candidate) {
      const source = await candidate.readText(relativePath)
      const parsed = source === null ? null : schema.safeParse(parse(source))
      if (!parsed?.success) {
        throw new AssistantHomeStoreError('invalid_project', `${label} candidate is invalid`)
      }
    },
  })
}

async function runGit(cwd: string, args: string[], allowFailure = false) {
  const child = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const result = { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
  if (exitCode !== 0 && !allowFailure) {
    throw new AssistantHomeStoreError(
      'repo_invalid',
      `git ${args.join(' ')} failed in ${cwd}: ${result.stderr || result.stdout}`,
    )
  }
  return result
}

async function pathExists(path: string) {
  return (await stat(path).catch(() => null)) !== null
}

function assertStableId(value: string, label: string) {
  if (!STABLE_ID_PATTERN.test(value)) {
    throw new AssistantHomeStoreError('invalid_project', `Invalid ${label}: ${value}`)
  }
}

function invalidProject(projectId: string, reason: string) {
  return new AssistantHomeStoreError('invalid_project', `Invalid Project ${projectId}: ${reason}`)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
