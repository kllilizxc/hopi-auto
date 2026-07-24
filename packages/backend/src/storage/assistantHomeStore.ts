import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
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
  LEGACY_HOPI_RELEASE_BRANCH,
  LEGACY_HOPI_RELEASE_REF,
  type LinkedProject,
  type LinkedProjectRepo,
  type ProjectDocument,
  type ProjectLink,
  type ProjectLinksDocument,
  type ProjectRepoDocument,
  type ProjectRepoLink,
  projectReleaseBranch,
  projectReleaseRef,
} from '../domain/project'
import {
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
import {
  legacyManagedRepoWorktreePaths,
  managedRepoWorktreePaths,
  managedTaskWorktreePath,
} from '../runtime/managedWorktreePaths'
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

const legacyConfiguredProjectLinkSchema = z
  .object({
    projectId: z.string().regex(STABLE_ID_PATTERN),
    primaryRepoId: z.string().regex(STABLE_ID_PATTERN),
    repos: z
      .array(projectRepoLinkSchema.extend({ deliveryBranch: z.string().min(1) }).strict())
      .min(1),
  })
  .strict()

const legacyProjectLinkWithSettingsSchema = legacyConfiguredProjectLinkSchema
  .extend({
    codingDefaults: projectCodingDefaultsInputSchema
      .transform((value) => normalizeProjectCodingDefaults(value))
      .optional(),
  })
  .strict()

const legacyConfiguredProjectLinksDocumentSchema = z
  .object({
    version: z.literal(3),
    projects: z.array(legacyProjectLinkWithSettingsSchema),
  })
  .strict()

const projectLinkSchema = z
  .object({
    projectId: z.string().regex(STABLE_ID_PATTERN),
    primaryRepoId: z.string().regex(STABLE_ID_PATTERN),
    repos: z.array(projectRepoLinkSchema).min(1),
  })
  .strict()

const projectLinksDocumentSchema = z
  .object({
    version: z.literal(4),
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
  operationsRoot: string
  projectDir(projectId: string): string
  integrationRoot(projectId: string): string
  repoIntegrationRoot(projectId: string, repoId: string, primaryRepoId: string): string
  projectDocumentPath(projectId: string): string
  managedRepoRoot(projectId: string, repoPath: string): string
  managedIntegrationRoot(projectId: string, repoPath: string): string
  managedProjectDocumentPath(projectId: string, repoPath: string): string
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
    operationsRoot: join(hopiDir, 'operations'),
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
    managedRepoRoot(projectId, repoPath) {
      return managedRepoWorktreePaths(repoPath, projectId).root
    },
    managedIntegrationRoot(projectId, repoPath) {
      return managedRepoWorktreePaths(repoPath, projectId).integration
    },
    managedProjectDocumentPath(projectId, repoPath) {
      return join(this.managedIntegrationRoot(projectId, repoPath), '.hopi', 'project.yml')
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
          await ensureProjectLinksDocument(paths)
          await ensureAssistantPreferenceDocument(paths.preferenceDocumentPath)
          return existing
        }

        const home: AssistantHomeDocument = {
          version: 1,
          homeId: `H-${crypto.randomUUID()}`,
        }
        await writeYamlAtomically(paths.homeDocumentPath, home)
        await ensureProjectLinksDocument(paths)
        await ensureAssistantPreferenceDocument(paths.preferenceDocumentPath)
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
        if (byId) {
          if (byId && exactProjectLink(byId, primaryRepoId, inspected)) {
            return this.validateProject(projectId)
          }

          throw new AssistantHomeStoreError(
            'project_conflict',
            `Project ID is already linked to another Repo: ${projectId}`,
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
                    releaseCommit: (
                      await runGit(repo.repoPath, ['rev-parse', projectReleaseRef(projectId)])
                    ).stdout,
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
        const byRepo = await findLinkForRepo([link], repo)
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
              : `Git Repo is already linked in Project ${input.projectId} under another Repo ID`,
          )
        }

        await ensureManagedSecondaryRoot(paths, link, input.repoId, repo)
        const releaseCommit = (
          await runGit(repo.repoPath, ['rev-parse', projectReleaseRef(input.projectId)])
        ).stdout
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
          projectPath: repo.repoId === input.repoId ? input.projectPath : repo.projectPath,
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
        const currentDocument = await readAndValidateProjectDocument(paths, link, publisher)
        const inspected = await Promise.all(
          input.repos.map(async (repo) => ({
            ...repo,
            inspection: await inspectRepo(repo.repoPath, repo.projectPath),
          })),
        )
        assertUniqueRequestedRepos(input.projectId, link.primaryRepoId, inspected)
        const updatedLink: ProjectLink = {
          ...link,
          repos: inspected
            .map((repo) => repoLink(repo.repoId, repo.inspection))
            .sort((left, right) => repoLinkOrder(link.primaryRepoId, left, right)),
        }
        const created: MaterializedManagedRoot[] = []
        try {
          for (const requested of inspected) {
            const previous = link.repos.find((repo) => repo.repoId === requested.repoId)
            if (!previous)
              throw invalidProject(input.projectId, `Repo ${requested.repoId} is missing`)
            const previousIntegrationRoot = paths.managedIntegrationRoot(
              input.projectId,
              previous.repoPath,
            )
            const previousRootExists = await pathExists(previousIntegrationRoot)
            if (previousRootExists) {
              try {
                await repairManagedRepoRoot(paths, link, previous, requested.inspection)
                continue
              } catch {
                // A different Git common directory cannot adopt the registered worktree.
                // Rebind materializes a fresh projection below and leaves this root as recovery.
              }
            }

            const materialized = await materializeReboundManagedRoot(
              paths,
              input.projectId,
              requested.repoId,
              requested.inspection,
            )
            if (materialized.created) created.push(materialized)
            if (requested.repoId === link.primaryRepoId) {
              if (!previousRootExists) {
                throw invalidProject(
                  input.projectId,
                  'canonical Project root is unavailable; refusing to replace its primary Repo',
                )
              }
              await replaceCanonicalTree(previousIntegrationRoot, materialized.integrationRoot)
            }
          }

          const nextDocument: ProjectDocument = {
            ...currentDocument,
            repos: await Promise.all(
              updatedLink.repos.map(async (repo) =>
                repo.repoId === updatedLink.primaryRepoId
                  ? repoDocument(repo)
                  : {
                      ...repoDocument(repo),
                      releaseCommit: (
                        await runGit(repo.repoPath, [
                          'rev-parse',
                          projectReleaseRef(input.projectId),
                        ])
                      ).stdout,
                    },
              ),
            ),
          }
          assertProjectMembership(presentProject(paths, updatedLink), nextDocument)
          await publishProjectDocument(paths, updatedLink, nextDocument, publisher)
        } catch (error) {
          for (const item of created.toReversed()) {
            await removeMaterializedManagedRoot(input.projectId, item).catch(() => undefined)
          }
          throw error
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

type RepoInspection = GitProjectDirectoryInspection

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
    return await inspectGitProjectDirectory(inputPath, projectPath)
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
  const integrationRoot = paths.managedIntegrationRoot(projectId, repo.repoPath)
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
  const integrationRoot = paths.managedIntegrationRoot(project.projectId, repo.repoPath)
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
  const releaseBranch = projectReleaseBranch(projectId)
  const releaseRef = projectReleaseRef(projectId)
  const targetExists =
    (await runGit(repo.repoPath, ['show-ref', '--verify', '--quiet', releaseRef], true))
      .exitCode === 0
  const args = targetExists
    ? ['-c', 'core.autocrlf=false', 'worktree', 'add', integrationRoot, releaseBranch]
    : ['-c', 'core.autocrlf=false', 'worktree', 'add', '-b', releaseBranch, integrationRoot, 'HEAD']
  const result = await runGit(repo.repoPath, args, true)
  if (result.exitCode !== 0) {
    throw new AssistantHomeStoreError(
      'invalid_project',
      `Cannot create managed integration worktree for ${projectId}/${repoId}: ${result.stderr || result.stdout}`,
    )
  }
}

interface MaterializedManagedRoot {
  repo: RepoInspection
  integrationRoot: string
  releaseHead: string
  created: boolean
  previousReleaseHead: string | null
}

async function materializeReboundManagedRoot(
  paths: AssistantHomePaths,
  projectId: string,
  repoId: string,
  repo: RepoInspection,
): Promise<MaterializedManagedRoot> {
  const integrationRoot = paths.managedIntegrationRoot(projectId, repo.repoPath)
  if (await pathExists(integrationRoot)) {
    await validateExistingManagedRepoRoot(integrationRoot, projectId, repoId, repo)
    return {
      repo,
      integrationRoot,
      releaseHead: (await runGit(integrationRoot, ['rev-parse', 'HEAD'])).stdout,
      created: false,
      previousReleaseHead: null,
    }
  }

  await mkdir(dirname(integrationRoot), { recursive: true })
  const releaseBranch = projectReleaseBranch(projectId)
  const previousRelease = await runGit(
    repo.repoPath,
    ['rev-parse', '--verify', projectReleaseRef(projectId)],
    true,
  )
  const targetHead = (await runGit(repo.repoPath, ['rev-parse', 'HEAD'])).stdout
  const result = await runGit(
    repo.repoPath,
    [
      '-c',
      'core.autocrlf=false',
      'worktree',
      'add',
      '-B',
      releaseBranch,
      integrationRoot,
      targetHead,
    ],
    true,
  )
  if (result.exitCode !== 0) {
    throw invalidProject(
      projectId,
      `Cannot materialize rebound Repo ${repoId}: ${result.stderr || result.stdout}`,
    )
  }
  await validateExistingManagedRepoRoot(integrationRoot, projectId, repoId, repo)
  return {
    repo,
    integrationRoot,
    releaseHead: targetHead,
    created: true,
    previousReleaseHead: previousRelease.exitCode === 0 ? previousRelease.stdout : null,
  }
}

async function replaceCanonicalTree(sourceIntegrationRoot: string, targetIntegrationRoot: string) {
  const source = join(sourceIntegrationRoot, '.hopi')
  const target = join(targetIntegrationRoot, '.hopi')
  if (!(await pathExists(source))) {
    throw new Error(`Canonical Project documents are missing: ${source}`)
  }
  await rm(target, { recursive: true, force: true })
  await cp(source, target, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  })
}

async function removeMaterializedManagedRoot(
  projectId: string,
  materialized: MaterializedManagedRoot,
) {
  await runGit(
    materialized.repo.repoPath,
    ['worktree', 'remove', '--force', materialized.integrationRoot],
    true,
  )
  const current = await runGit(
    materialized.repo.repoPath,
    ['rev-parse', '--verify', projectReleaseRef(projectId)],
    true,
  )
  if (current.exitCode === 0 && current.stdout === materialized.releaseHead) {
    if (materialized.previousReleaseHead) {
      await runGit(materialized.repo.repoPath, [
        'update-ref',
        projectReleaseRef(projectId),
        materialized.previousReleaseHead,
        materialized.releaseHead,
      ])
    } else {
      await runGit(
        materialized.repo.repoPath,
        ['update-ref', '-d', projectReleaseRef(projectId), materialized.releaseHead],
        true,
      )
    }
  }
}

async function repairManagedRepoRoot(
  paths: AssistantHomePaths,
  project: ProjectLink,
  repoLink: ProjectRepoLink,
  repo: RepoInspection,
) {
  const previousIntegrationRoot = paths.managedIntegrationRoot(project.projectId, repoLink.repoPath)
  const integrationRoot = paths.managedIntegrationRoot(project.projectId, repo.repoPath)
  if (previousIntegrationRoot !== integrationRoot && (await pathExists(previousIntegrationRoot))) {
    if (!(await inspectRepo(previousIntegrationRoot).catch(() => null))) {
      await repairMovedManagedPointers(previousIntegrationRoot, project.projectId, repo)
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
      expectedBranch: projectReleaseBranch(project.projectId),
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
      await repairMovedManagedPointers(integrationRoot, project.projectId, repo)
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
    runGit(repo.repoPath, ['rev-parse', projectReleaseRef(project.projectId)]),
  ])
  if (managedHead.stdout !== targetHead.stdout) {
    throw invalidProject(
      project.projectId,
      `rebound managed root does not materialize ${projectReleaseBranch(project.projectId)}`,
    )
  }
}

async function repairMovedManagedPointers(
  integrationRoot: string,
  projectId: string,
  repo: RepoInspection,
) {
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
  if (!adminStats?.isDirectory() || head.trim() !== `ref: ${projectReleaseRef(projectId)}`) return

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

  const releaseBranch = projectReleaseBranch(projectId)
  const branch = await runGit(integrationRoot, ['branch', '--show-current'])
  if (branch.stdout !== releaseBranch) {
    throw invalidProject(projectId, `managed worktree ${repoId} is not on ${releaseBranch}`)
  }
}

function presentProject(paths: AssistantHomePaths, link: ProjectLink): LinkedProject {
  const repos: LinkedProjectRepo[] = link.repos.map((repo) => ({
    ...repo,
    projectPath: normalizeProjectPath(repo.projectPath),
    primary: repo.repoId === link.primaryRepoId,
    integrationRoot: paths.managedIntegrationRoot(link.projectId, repo.repoPath),
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

async function ensureProjectLinksDocument(paths: AssistantHomePaths) {
  const existing = await readRawProjectLinks(paths.projectLinksPath)
  if (existing) {
    const normalized = await normalizeProjectLinks(existing)
    assertUniqueProjectLinks(normalized.projects)
    if (existing.version !== 4) {
      await assertLegacyReposAreExclusive(normalized.projects)
      await migrateManagedWorktrees(paths, normalized.projects)
    }
    if (
      existing.version !== 4 ||
      existing.projects.some((project) => 'codingDefaults' in project)
    ) {
      await writeYamlAtomically(paths.projectLinksPath, normalized)
    }
    return normalized
  }

  const links: ProjectLinksDocument = { version: 4, projects: [] }
  await writeYamlAtomically(paths.projectLinksPath, links)
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
  for (const link of links) {
    if (projectIds.has(link.projectId)) {
      throw new AssistantHomeStoreError(
        'invalid_home',
        `Duplicate projectId in projects.yml: ${link.projectId}`,
      )
    }
    projectIds.add(link.projectId)
    const repoIds = new Set<string>()
    const repoPaths = new Set<string>()
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
      legacyConfiguredProjectLinksDocumentSchema,
      legacyMultiRepoProjectLinksDocumentSchema,
      legacyProjectLinksDocumentSchema,
    ]),
    'Project links',
  )
}

async function normalizeProjectLinks(
  raw:
    | z.infer<typeof projectLinksDocumentSchema>
    | z.infer<typeof legacyConfiguredProjectLinksDocumentSchema>
    | z.infer<typeof legacyMultiRepoProjectLinksDocumentSchema>
    | z.infer<typeof legacyProjectLinksDocumentSchema>,
): Promise<ProjectLinksDocument> {
  if (raw.version === 4 || raw.version === 3) {
    return {
      version: 4,
      projects: raw.projects.map((project) => ({
        projectId: project.projectId,
        primaryRepoId: project.primaryRepoId,
        repos: project.repos.map((repo) => ({
          repoId: repo.repoId,
          repoPath: repo.repoPath,
          ...(repo.projectPath ? { projectPath: repo.projectPath } : {}),
        })),
      })),
    }
  }
  const projects =
    raw.version === 2
      ? raw.projects
      : raw.projects.map((project) => ({
          projectId: project.projectId,
          primaryRepoId: DEFAULT_PRIMARY_REPO_ID,
          repos: [{ repoId: DEFAULT_PRIMARY_REPO_ID, repoPath: project.repoPath }],
        }))
  return {
    version: 4,
    projects,
  }
}

async function migrateManagedWorktrees(
  paths: AssistantHomePaths,
  projects: readonly ProjectLink[],
) {
  for (const project of projects) {
    for (const repo of project.repos) {
      if (!(await pathExists(repo.repoPath))) continue
      const homeLegacyRoot = paths.repoIntegrationRoot(
        project.projectId,
        repo.repoId,
        project.primaryRepoId,
      )
      const repoLegacyRoot = legacyManagedRepoWorktreePaths(repo.repoPath).integration
      const integrationRoot = paths.managedIntegrationRoot(project.projectId, repo.repoPath)
      const releaseBranch = projectReleaseBranch(project.projectId)
      const releaseRef = projectReleaseRef(project.projectId)
      const legacyTarget = await runGit(
        repo.repoPath,
        ['rev-parse', '--verify', LEGACY_HOPI_RELEASE_REF],
        true,
      )
      const target = await runGit(repo.repoPath, ['rev-parse', '--verify', releaseRef], true)
      if (
        target.exitCode === 0 &&
        legacyTarget.exitCode === 0 &&
        target.stdout !== legacyTarget.stdout
      ) {
        throw invalidProject(
          project.projectId,
          `${releaseBranch} disagrees with ${LEGACY_HOPI_RELEASE_BRANCH}; migration cannot choose a release`,
        )
      }
      if (target.exitCode !== 0) {
        if (legacyTarget.exitCode !== 0) {
          throw invalidProject(
            project.projectId,
            `legacy Repo ${repo.repoId} is missing ${LEGACY_HOPI_RELEASE_BRANCH}`,
          )
        }
        await runGit(repo.repoPath, ['update-ref', releaseRef, legacyTarget.stdout])
      }
      const from = (await pathExists(repoLegacyRoot)) ? repoLegacyRoot : homeLegacyRoot
      if (!(await pathExists(integrationRoot)) && (await pathExists(from))) {
        await relocateRegisteredWorktree({
          repoRoot: repo.repoPath,
          from,
          to: integrationRoot,
          expectedBranch: LEGACY_HOPI_RELEASE_BRANCH,
        })
      }
      if (!(await pathExists(integrationRoot))) {
        const inspection = await inspectRepo(repo.repoPath, repo.projectPath)
        await createManagedRepoRoot(integrationRoot, project.projectId, repo.repoId, inspection)
      }
      const branch = await runGit(integrationRoot, ['branch', '--show-current'])
      if (branch.stdout === LEGACY_HOPI_RELEASE_BRANCH) {
        await runGit(integrationRoot, ['switch', releaseBranch])
      } else if (branch.stdout !== releaseBranch) {
        throw invalidProject(
          project.projectId,
          `legacy managed Repo ${repo.repoId} is on ${branch.stdout || 'detached HEAD'}`,
        )
      }
      await migrateTaskWorktrees(project.projectId, repo.repoPath)
      await validateExistingManagedRepoRoot(
        integrationRoot,
        project.projectId,
        repo.repoId,
        await inspectRepo(repo.repoPath, repo.projectPath),
      )
      if (legacyTarget.exitCode === 0) {
        await runGit(
          repo.repoPath,
          ['update-ref', '-d', LEGACY_HOPI_RELEASE_REF, legacyTarget.stdout],
          true,
        )
      }
    }
  }
}

async function assertLegacyReposAreExclusive(projects: readonly ProjectLink[]) {
  const owners = new Map<string, string>()
  for (const project of projects) {
    for (const repo of project.repos) {
      if (!(await pathExists(repo.repoPath))) continue
      const commonDir = (await inspectRepo(repo.repoPath, repo.projectPath)).commonDir
      const owner = owners.get(commonDir)
      if (owner && owner !== project.projectId) {
        throw new AssistantHomeStoreError(
          'invalid_home',
          `Legacy shared Repo cannot be assigned safely between Projects ${owner} and ${project.projectId}`,
        )
      }
      owners.set(commonDir, project.projectId)
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
    const target = managedTaskWorktreePath(repoPath, projectId, goalId, workId)
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

function linkForRepo(projectId: string, repoId: string, repo: RepoInspection): ProjectLink {
  return {
    projectId,
    primaryRepoId: repoId,
    repos: [repoLink(repoId, repo)],
  }
}

async function readAndValidateProjectDocument(
  paths: AssistantHomePaths,
  project: Pick<ProjectLink, 'projectId' | 'primaryRepoId' | 'repos'>,
  publisher?: PublicationCoordinator,
): Promise<ProjectDocument> {
  const primary = requirePrimaryRepoLink(project)
  const raw = await readOptionalYaml(
    paths.managedProjectDocumentPath(project.projectId, primary.repoPath),
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
  const integrationRoot = paths.managedIntegrationRoot(project.projectId, primary.repoPath)
  await publishYamlFile(
    publisher,
    { id: `project:${project.projectId}`, path: integrationRoot },
    paths.managedProjectDocumentPath(project.projectId, primary.repoPath),
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
  const releaseBranch = projectReleaseBranch(projectId)
  const releaseRef = projectReleaseRef(projectId)
  const branch = await runGit(repo.integrationRoot, ['branch', '--show-current'])
  if (branch.stdout !== releaseBranch) {
    throw invalidProject(
      projectId,
      `managed Repo ${repo.repoId} is on ${branch.stdout || 'detached HEAD'}, expected ${releaseBranch}`,
    )
  }
  const [managedHead, targetHead] = await Promise.all([
    runGit(repo.integrationRoot, ['rev-parse', 'HEAD']),
    runGit(repo.repoPath, ['rev-parse', releaseRef]),
  ])
  if (managedHead.stdout !== targetHead.stdout) {
    throw invalidProject(
      projectId,
      `managed Repo ${repo.repoId} does not materialize ${releaseBranch}`,
    )
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
