import { mkdir, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
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
  primaryProjectRepo,
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
import { PublicationCoordinator, hashBytes } from '../publication/publisher'
import { withFileLock } from './lock'

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

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
  })
  .strict()

const projectLinkSchema = z
  .object({
    projectId: z.string().regex(STABLE_ID_PATTERN),
    primaryRepoId: z.string().regex(STABLE_ID_PATTERN),
    repos: z.array(projectRepoLinkSchema).min(1),
    codingDefaults: projectCodingDefaultsInputSchema
      .transform((value) => normalizeProjectCodingDefaults(value))
      .optional(),
  })
  .strict()

const projectLinksDocumentSchema = z
  .object({
    version: z.literal(2),
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
  mutationLockPath: string
  projectDir(projectId: string): string
  integrationRoot(projectId: string): string
  repoIntegrationRoot(projectId: string, repoId: string, primaryRepoId: string): string
  projectDocumentPath(projectId: string): string
}

export interface LinkProjectInput {
  projectId?: string
  repoPath: string
  repoId?: string
}

export interface LinkRepoInput {
  projectId: string
  repoId: string
  repoPath: string
}

export interface RebindProjectInput {
  projectId: string
  repoPath: string
}

export interface RebindRepoInput extends RebindProjectInput {
  repoId: string
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
          await ensureProjectLinksDocument(paths.projectLinksPath)
          return existing
        }

        const home: AssistantHomeDocument = {
          version: 1,
          homeId: `H-${crypto.randomUUID()}`,
        }
        await writeYamlAtomically(paths.homeDocumentPath, home)
        await ensureProjectLinksDocument(paths.projectLinksPath)
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
        const projectId = input.projectId ?? `P-${crypto.randomUUID()}`
        const repoId = input.repoId ?? DEFAULT_PRIMARY_REPO_ID
        assertStableId(projectId, 'projectId')
        assertStableId(repoId, 'repoId')
        const repo = await inspectRepo(input.repoPath)
        const links = await readProjectLinks(paths.projectLinksPath)
        assertUniqueProjectLinks(links.projects)

        const byId = links.projects.find((entry) => entry.projectId === projectId)
        const byRepo = await findLinkForRepo(links.projects, repo)
        if (byId || byRepo) {
          const existingPrimary = byId ? primaryProjectRepo(byId) : undefined
          if (
            existingPrimary?.repoId === repoId &&
            existingPrimary.repoPath === repo.repoPath &&
            byRepo?.projectId === projectId
          ) {
            return this.validateProject(projectId)
          }

          throw new AssistantHomeStoreError(
            'project_conflict',
            byId
              ? `Project ID is already linked to another Repo: ${projectId}`
              : `Repo is already linked as Project: ${byRepo?.projectId}`,
          )
        }

        await ensureManagedPrimaryRoot(paths, projectId, repoId, repo, publisher)
        const link: ProjectLink = {
          projectId,
          primaryRepoId: repoId,
          repos: [{ repoId, repoPath: repo.repoPath }],
        }
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
        const repo = await inspectRepo(input.repoPath)
        const existing = link.repos.find((candidate) => candidate.repoId === input.repoId)
        const byRepo = await findLinkForRepo(links.projects, repo)
        if (existing || byRepo) {
          if (
            existing?.repoPath === repo.repoPath &&
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
            : [...projectDocument.repos, { repoId: input.repoId, releaseCommit }].sort(
                (left, right) => repoDocumentOrder(link.primaryRepoId, left, right),
              ),
        }
        await publishProjectDocument(paths, input.projectId, nextProjectDocument, publisher)

        const updatedLink: ProjectLink = {
          ...link,
          repos: [...link.repos, { repoId: input.repoId, repoPath: repo.repoPath }].sort(
            (left, right) => repoLinkOrder(link.primaryRepoId, left, right),
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
        const repoLink = link.repos.find((candidate) => candidate.repoId === input.repoId)
        if (!repoLink) {
          throw new AssistantHomeStoreError(
            'project_not_found',
            `Repo is not linked in Project ${input.projectId}: ${input.repoId}`,
          )
        }
        const repo = await inspectRepo(input.repoPath)
        await assertRepoAvailableForRebind(links.projects, input.projectId, input.repoId, repo)
        if (repoLink.repoPath === repo.repoPath) return this.validateProject(input.projectId)

        await repairManagedRepoRoot(paths, link, repoLink, repo, publisher)
        const updatedLink: ProjectLink = {
          ...link,
          repos: link.repos.map((candidate) =>
            candidate.repoId === input.repoId
              ? { ...candidate, repoPath: repo.repoPath }
              : candidate,
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

interface RepoInspection {
  repoPath: string
  commonDir: string
}

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

async function assertRepoAvailableForRebind(
  links: ProjectLink[],
  projectId: string,
  repoId: string,
  repo: RepoInspection,
) {
  for (const link of links) {
    for (const candidate of link.repos) {
      if (link.projectId === projectId && candidate.repoId === repoId) continue
      if (candidate.repoPath === repo.repoPath) {
        throw new AssistantHomeStoreError(
          'project_conflict',
          `Repo is already linked as ${link.projectId}/${candidate.repoId}`,
        )
      }
      const linkedRepo = await inspectRepo(candidate.repoPath).catch((error) => {
        throw new AssistantHomeStoreError(
          'invalid_home',
          `Cannot validate linked Repo ${candidate.repoId} for ${link.projectId}: ${errorMessage(error)}`,
        )
      })
      if (linkedRepo.commonDir === repo.commonDir) {
        throw new AssistantHomeStoreError(
          'project_conflict',
          `Repo is already linked as ${link.projectId}/${candidate.repoId}`,
        )
      }
    }
  }
}

async function inspectRepo(inputPath: string): Promise<RepoInspection> {
  const requestedPath = resolve(inputPath)
  const requestedStats = await stat(requestedPath).catch(() => null)
  if (!requestedStats?.isDirectory()) {
    throw new AssistantHomeStoreError(
      'repo_invalid',
      `Repo path is not a directory: ${requestedPath}`,
    )
  }

  const rootResult = await runGit(requestedPath, ['rev-parse', '--show-toplevel'], true)
  if (rootResult.exitCode !== 0 || !rootResult.stdout) {
    throw new AssistantHomeStoreError(
      'repo_invalid',
      `Path is not inside a Git worktree: ${requestedPath}`,
    )
  }

  const repoPath = await realpath(rootResult.stdout)
  const commonResult = await runGit(repoPath, ['rev-parse', '--git-common-dir'])
  return {
    repoPath,
    commonDir: await realpath(resolve(repoPath, commonResult.stdout)),
  }
}

async function ensureManagedPrimaryRoot(
  paths: AssistantHomePaths,
  projectId: string,
  repoId: string,
  repo: RepoInspection,
  publisher: PublicationCoordinator,
) {
  const integrationRoot = paths.integrationRoot(projectId)
  if (await pathExists(integrationRoot)) {
    const entries = await readdir(integrationRoot)
    if (entries.length > 0) {
      await validateExistingManagedRepoRoot(integrationRoot, projectId, repoId, repo)
      const link: ProjectLink = {
        projectId,
        primaryRepoId: repoId,
        repos: [{ repoId, repoPath: repo.repoPath }],
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
    repos: [{ repoId }],
  }
  await publishProjectDocument(paths, projectId, projectDocument, publisher)
}

async function ensureManagedSecondaryRoot(
  paths: AssistantHomePaths,
  project: ProjectLink,
  repoId: string,
  repo: RepoInspection,
) {
  const integrationRoot = paths.repoIntegrationRoot(
    project.projectId,
    repoId,
    project.primaryRepoId,
  )
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
    ? ['worktree', 'add', integrationRoot, HOPI_RELEASE_BRANCH]
    : ['worktree', 'add', '-b', HOPI_RELEASE_BRANCH, integrationRoot, 'HEAD']
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
  publisher: PublicationCoordinator,
) {
  const integrationRoot = paths.repoIntegrationRoot(
    project.projectId,
    repoLink.repoId,
    project.primaryRepoId,
  )
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
  const projectDocument = await readAndValidateProjectDocument(paths, project, publisher)
  if (repoLink.repoId !== project.primaryRepoId) {
    const documented = projectDocument.repos.find(
      (candidate) => candidate.repoId === repoLink.repoId,
    )?.releaseCommit
    if (documented !== targetHead.stdout) {
      throw invalidProject(
        project.projectId,
        `rebound Repo ${repoLink.repoId} release disagrees with project.yml`,
      )
    }
  }
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
    primary: repo.repoId === link.primaryRepoId,
    integrationRoot: paths.repoIntegrationRoot(link.projectId, repo.repoId, link.primaryRepoId),
  }))
  const primary = repos.find((repo) => repo.primary)
  if (!primary) throw invalidProject(link.projectId, 'primary Repo is missing from projects.yml')
  return {
    ...link,
    repos,
    repoPath: primary.repoPath,
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
    const normalized = normalizeProjectLinks(existing)
    assertUniqueProjectLinks(normalized.projects)
    if (existing.version === 1) await writeYamlAtomically(path, normalized)
    return normalized
  }

  const links: ProjectLinksDocument = { version: 2, projects: [] }
  await writeYamlAtomically(path, links)
  return links
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
    z.union([projectLinksDocumentSchema, legacyProjectLinksDocumentSchema]),
    'Project links',
  )
}

function normalizeProjectLinks(
  raw:
    | z.infer<typeof projectLinksDocumentSchema>
    | z.infer<typeof legacyProjectLinksDocumentSchema>,
): ProjectLinksDocument {
  if (raw.version === 2) return raw
  return {
    version: 2,
    projects: raw.projects.map((project) => ({
      projectId: project.projectId,
      primaryRepoId: DEFAULT_PRIMARY_REPO_ID,
      repos: [{ repoId: DEFAULT_PRIMARY_REPO_ID, repoPath: project.repoPath }],
      ...(project.codingDefaults ? { codingDefaults: project.codingDefaults } : {}),
    })),
  }
}

async function readAndValidateProjectDocument(
  paths: AssistantHomePaths,
  project: Pick<ProjectLink, 'projectId' | 'primaryRepoId' | 'repos'>,
  publisher?: PublicationCoordinator,
): Promise<ProjectDocument> {
  const raw = await readOptionalYaml(
    paths.projectDocumentPath(project.projectId),
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
    await publishProjectDocument(paths, project.projectId, document, publisher)
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
  const linked = [...project.repos].map((repo) => repo.repoId).sort()
  const documented = document.repos.map((repo) => repo.repoId).sort()
  if (JSON.stringify(linked) !== JSON.stringify(documented)) {
    throw invalidProject(
      project.projectId,
      `projects.yml Repo membership disagrees with project.yml (${linked.join(', ')} vs ${documented.join(', ')})`,
    )
  }
}

async function publishProjectDocument(
  paths: AssistantHomePaths,
  projectId: string,
  document: ProjectDocument,
  publisher: PublicationCoordinator,
) {
  assertProjectDocument(document)
  await publishYamlFile(
    publisher,
    { id: `project:${projectId}`, path: paths.integrationRoot(projectId) },
    paths.projectDocumentPath(projectId),
    document,
    projectDocumentSchema,
    `Project ${projectId}`,
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
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp.${crypto.randomUUID()}`
  try {
    await Bun.write(temporaryPath, stringify(value, { indent: 2 }))
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
