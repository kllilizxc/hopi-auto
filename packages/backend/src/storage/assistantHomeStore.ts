import { mkdir, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import {
  type AssistantHomeDocument,
  HOPI_RELEASE_BRANCH,
  HOPI_RELEASE_REF,
  type LinkedProject,
  type ProjectDocument,
  type ProjectLink,
  type ProjectLinksDocument,
} from '../domain/project'
import {
  type ProjectCodingDefaults,
  normalizeProjectCodingDefaults,
  projectCodingDefaultsInputSchema,
} from '../domain/projectCodingDefaults'
import { PublicationCoordinator, hashBytes } from '../publication/publisher'
import { withFileLock } from './lock'

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const assistantHomeDocumentSchema = z
  .object({
    version: z.literal(1),
    homeId: z.string().regex(STABLE_ID_PATTERN),
  })
  .strict()

const projectLinkSchema = z
  .object({
    projectId: z.string().regex(STABLE_ID_PATTERN),
    repoPath: z.string().min(1),
    codingDefaults: projectCodingDefaultsInputSchema
      .transform((value) => normalizeProjectCodingDefaults(value))
      .optional(),
  })
  .strict()

const projectLinksDocumentSchema = z
  .object({
    version: z.literal(1),
    projects: z.array(projectLinkSchema),
  })
  .strict()

const projectDocumentSchema = z
  .object({
    version: z.literal(1),
    projectId: z.string().regex(STABLE_ID_PATTERN),
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
  projectDocumentPath(projectId: string): string
}

export interface LinkProjectInput {
  projectId?: string
  repoPath: string
}

export interface RebindProjectInput {
  projectId: string
  repoPath: string
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
  rebindProject(input: RebindProjectInput): Promise<LinkedProject>
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
        assertStableId(projectId, 'projectId')
        const repo = await inspectRepo(input.repoPath)
        const links = await readProjectLinks(paths.projectLinksPath)
        assertUniqueProjectLinks(links.projects)

        const byId = links.projects.find((entry) => entry.projectId === projectId)
        const byRepo = await findLinkForRepo(links.projects, repo)
        if (byId || byRepo) {
          if (byId?.repoPath === repo.repoPath && byRepo?.projectId === projectId) {
            return this.validateProject(projectId)
          }

          throw new AssistantHomeStoreError(
            'project_conflict',
            byId
              ? `Project ID is already linked to another Repo: ${projectId}`
              : `Repo is already linked as Project: ${byRepo?.projectId}`,
          )
        }

        await ensureManagedIntegrationRoot(paths, projectId, repo, publisher)
        const link: ProjectLink = { projectId, repoPath: repo.repoPath }
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
    async rebindProject(input) {
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
        const repo = await inspectRepo(input.repoPath)
        await assertRepoAvailableForRebind(links.projects, input.projectId, repo)
        if (link.repoPath === repo.repoPath) return this.validateProject(input.projectId)

        await repairManagedIntegrationRoot(paths, input.projectId, repo, publisher)
        link.repoPath = repo.repoPath
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
          : { projectId: link.projectId, repoPath: link.repoPath }
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
      const repo = await inspectRepo(project.repoPath)
      const integrationRoot = paths.integrationRoot(projectId)
      const integrationStats = await stat(integrationRoot).catch(() => null)
      if (!integrationStats?.isDirectory()) {
        throw invalidProject(projectId, `missing managed integration root: ${integrationRoot}`)
      }

      const managedRepo = await inspectRepo(integrationRoot)
      if (managedRepo.commonDir !== repo.commonDir) {
        throw invalidProject(projectId, 'managed integration root belongs to another Git Repo')
      }

      const branch = await runGit(integrationRoot, ['branch', '--show-current'])
      if (branch.stdout !== HOPI_RELEASE_BRANCH) {
        throw invalidProject(
          projectId,
          `managed integration root is on ${branch.stdout || 'detached HEAD'}, expected ${HOPI_RELEASE_BRANCH}`,
        )
      }

      const [managedHead, targetHead] = await Promise.all([
        runGit(integrationRoot, ['rev-parse', 'HEAD']),
        runGit(repo.repoPath, ['rev-parse', HOPI_RELEASE_REF]),
      ])
      if (managedHead.stdout !== targetHead.stdout) {
        throw invalidProject(
          projectId,
          'managed integration root does not materialize hopi/release',
        )
      }

      const projectDocument = await readOptionalYaml(
        paths.projectDocumentPath(projectId),
        projectDocumentSchema,
        `Project ${projectId}`,
      )
      if (!projectDocument || projectDocument.projectId !== projectId) {
        throw invalidProject(projectId, 'project.yml is missing or has the wrong projectId')
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
    if (link.repoPath === repo.repoPath) {
      return link
    }

    const linkedRepo = await inspectRepo(link.repoPath).catch((error) => {
      throw new AssistantHomeStoreError(
        'invalid_home',
        `Cannot validate linked Repo for ${link.projectId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    })
    if (linkedRepo.commonDir === repo.commonDir) {
      return link
    }
  }
  return undefined
}

async function assertRepoAvailableForRebind(
  links: ProjectLink[],
  projectId: string,
  repo: RepoInspection,
) {
  for (const link of links) {
    if (link.projectId === projectId) continue
    if (link.repoPath === repo.repoPath) {
      throw new AssistantHomeStoreError(
        'project_conflict',
        `Repo is already linked as Project: ${link.projectId}`,
      )
    }
    const linkedRepo = await inspectRepo(link.repoPath).catch((error) => {
      throw new AssistantHomeStoreError(
        'invalid_home',
        `Cannot validate linked Repo for ${link.projectId}: ${errorMessage(error)}`,
      )
    })
    if (linkedRepo.commonDir === repo.commonDir) {
      throw new AssistantHomeStoreError(
        'project_conflict',
        `Repo is already linked as Project: ${link.projectId}`,
      )
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

async function ensureManagedIntegrationRoot(
  paths: AssistantHomePaths,
  projectId: string,
  repo: RepoInspection,
  publisher: PublicationCoordinator,
) {
  const integrationRoot = paths.integrationRoot(projectId)
  if (await pathExists(integrationRoot)) {
    const entries = await readdir(integrationRoot)
    if (entries.length > 0) {
      await validateExistingManagedRoot(paths, projectId, repo, publisher)
      return
    }
    await rm(integrationRoot, { recursive: true, force: true })
  }

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
      `Cannot create managed integration worktree for ${projectId}: ${result.stderr || result.stdout}`,
    )
  }

  const projectDocument: ProjectDocument = { version: 1, projectId }
  await publishYamlFile(
    publisher,
    { id: `project:${projectId}`, path: integrationRoot },
    paths.projectDocumentPath(projectId),
    projectDocument,
    projectDocumentSchema,
    `Project ${projectId}`,
  )
}

async function repairManagedIntegrationRoot(
  paths: AssistantHomePaths,
  projectId: string,
  repo: RepoInspection,
  publisher: PublicationCoordinator,
) {
  const integrationRoot = paths.integrationRoot(projectId)
  if (!(await pathExists(integrationRoot))) {
    throw invalidProject(
      projectId,
      'managed integration root is missing; refusing to reconstruct potentially newer canonical documents from Git',
    )
  }
  const repair = await runGit(repo.repoPath, ['worktree', 'repair', integrationRoot], true)
  if (repair.exitCode !== 0) {
    throw invalidProject(
      projectId,
      `cannot repair managed integration worktree: ${repair.stderr || repair.stdout}`,
    )
  }
  await validateExistingManagedRoot(paths, projectId, repo, publisher)
  const [managedHead, targetHead] = await Promise.all([
    runGit(integrationRoot, ['rev-parse', 'HEAD']),
    runGit(repo.repoPath, ['rev-parse', HOPI_RELEASE_REF]),
  ])
  if (managedHead.stdout !== targetHead.stdout) {
    throw invalidProject(projectId, 'rebound managed root does not materialize hopi/release')
  }
}

async function validateExistingManagedRoot(
  paths: AssistantHomePaths,
  projectId: string,
  repo: RepoInspection,
  publisher: PublicationCoordinator,
) {
  const integrationRoot = paths.integrationRoot(projectId)
  const managedRepo = await inspectRepo(integrationRoot).catch(() => null)
  if (!managedRepo || managedRepo.commonDir !== repo.commonDir) {
    throw invalidProject(projectId, 'existing managed path is not the linked Repo worktree')
  }

  const branch = await runGit(integrationRoot, ['branch', '--show-current'])
  if (branch.stdout !== HOPI_RELEASE_BRANCH) {
    throw invalidProject(projectId, `existing managed worktree is not on ${HOPI_RELEASE_BRANCH}`)
  }

  const projectDocument = await readOptionalYaml(
    paths.projectDocumentPath(projectId),
    projectDocumentSchema,
    `Project ${projectId}`,
  )
  if (!projectDocument) {
    const document: ProjectDocument = { version: 1, projectId }
    await publishYamlFile(
      publisher,
      { id: `project:${projectId}`, path: integrationRoot },
      paths.projectDocumentPath(projectId),
      document,
      projectDocumentSchema,
      `Project ${projectId}`,
    )
    return
  }
  if (projectDocument.projectId !== projectId) {
    throw invalidProject(projectId, 'existing project.yml has a different projectId')
  }
}

function presentProject(paths: AssistantHomePaths, link: ProjectLink): LinkedProject {
  return {
    ...link,
    integrationRoot: paths.integrationRoot(link.projectId),
  }
}

function sameCodingDefaults(
  left: ProjectCodingDefaults | undefined,
  right: ProjectCodingDefaults | undefined,
) {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function ensureProjectLinksDocument(path: string) {
  const existing = await readOptionalYaml(path, projectLinksDocumentSchema, 'Project links')
  if (existing) {
    assertUniqueProjectLinks(existing.projects)
    return existing
  }

  const links: ProjectLinksDocument = { version: 1, projects: [] }
  await writeYamlAtomically(path, links)
  return links
}

async function readProjectLinks(path: string) {
  const links = await readOptionalYaml(path, projectLinksDocumentSchema, 'Project links')
  if (!links) {
    throw new AssistantHomeStoreError('invalid_home', `Missing project links document: ${path}`)
  }
  return links
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
    if (repoPaths.has(link.repoPath)) {
      throw new AssistantHomeStoreError(
        'invalid_home',
        `Duplicate repoPath in projects.yml: ${link.repoPath}`,
      )
    }
    projectIds.add(link.projectId)
    repoPaths.add(link.repoPath)
  }
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
