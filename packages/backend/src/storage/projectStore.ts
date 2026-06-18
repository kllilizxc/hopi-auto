import { mkdir, rename, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { withFileLock } from './lock'

const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9-_]*$/

export interface ProjectRecord {
  projectKey: string
  name: string
  rootDir: string
  createdAt: string
  lastOpenedGoalKey?: string
}

interface ProjectRegistry {
  version: 1
  projects: ProjectRecord[]
}

export interface ProjectStore {
  listProjects(): Promise<ProjectRecord[]>
  readProject(projectKey: string): Promise<ProjectRecord>
  createProject(input: {
    projectKey?: string
    name?: string
    rootDir: string
  }): Promise<ProjectRecord>
  recordLastOpenedGoal(projectKey: string, goalKey: string): Promise<ProjectRecord>
}

export class ProjectStoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const projectRecordSchema = z.object({
  projectKey: z.string().regex(PROJECT_KEY_PATTERN),
  name: z.string().min(1),
  rootDir: z.string().min(1),
  createdAt: z.string().datetime(),
  lastOpenedGoalKey: z.string().min(1).optional(),
})

const projectRegistrySchema = z.object({
  version: z.literal(1).default(1),
  projects: z.array(projectRecordSchema).default([]),
})

export function createProjectStore(rootDir = process.cwd()): ProjectStore {
  const registryPath = join(rootDir, '.hopi', 'projects.json')
  const lockPath = `${registryPath}.lock`

  return {
    async listProjects() {
      const registry = await readRegistry(registryPath)
      return registry.projects.toSorted((left, right) => {
        return Date.parse(right.createdAt) - Date.parse(left.createdAt)
      })
    },
    async readProject(projectKey) {
      const registry = await readRegistry(registryPath)
      const project = registry.projects.find((entry) => entry.projectKey === projectKey)
      if (!project) {
        throw new ProjectStoreError(404, `Project not found: ${projectKey}`)
      }
      return project
    },
    async createProject(input) {
      const normalizedRootDir = resolve(rootDir, input.rootDir)
      const resolvedName = input.name?.trim() || basename(normalizedRootDir) || normalizedRootDir
      const projectKey = normalizeProjectKey(input.projectKey ?? resolvedName)

      let rootStats
      try {
        rootStats = await stat(normalizedRootDir)
      } catch {
        throw new ProjectStoreError(400, `Project path does not exist: ${normalizedRootDir}`)
      }

      if (!rootStats.isDirectory()) {
        throw new ProjectStoreError(400, `Project path is not a directory: ${normalizedRootDir}`)
      }

      return withFileLock(lockPath, async () => {
        const registry = await readRegistry(registryPath)
        if (registry.projects.some((entry) => entry.projectKey === projectKey)) {
          throw new ProjectStoreError(409, `Project already exists: ${projectKey}`)
        }
        if (registry.projects.some((entry) => entry.rootDir === normalizedRootDir)) {
          throw new ProjectStoreError(
            409,
            `Project path is already linked: ${normalizedRootDir}`,
          )
        }

        const record: ProjectRecord = {
          projectKey,
          name: resolvedName,
          rootDir: normalizedRootDir,
          createdAt: new Date().toISOString(),
        }
        registry.projects.push(record)
        await writeRegistry(registryPath, registry)
        return record
      })
    },
    async recordLastOpenedGoal(projectKey, goalKey) {
      return withFileLock(lockPath, async () => {
        const registry = await readRegistry(registryPath)
        const project = registry.projects.find((entry) => entry.projectKey === projectKey)
        if (!project) {
          throw new ProjectStoreError(404, `Project not found: ${projectKey}`)
        }

        project.lastOpenedGoalKey = goalKey
        await writeRegistry(registryPath, registry)
        return project
      })
    },
  }
}

function normalizeProjectKey(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!normalized || !PROJECT_KEY_PATTERN.test(normalized)) {
    throw new ProjectStoreError(400, 'Invalid project key')
  }

  return normalized
}

async function readRegistry(registryPath: string): Promise<ProjectRegistry> {
  const file = Bun.file(registryPath)
  if (!(await file.exists())) {
    return {
      version: 1,
      projects: [],
    }
  }

  const raw = await file.text()
  if (raw.trim() === '') {
    return {
      version: 1,
      projects: [],
    }
  }

  const parsed = projectRegistrySchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new ProjectStoreError(500, `Invalid projects registry: ${issues}`)
  }

  return parsed.data
}

async function writeRegistry(registryPath: string, registry: ProjectRegistry) {
  await mkdir(dirname(registryPath), { recursive: true })
  const tmpPath = `${registryPath}.tmp.${crypto.randomUUID()}`
  await Bun.write(tmpPath, `${JSON.stringify(registry, null, 2)}\n`)
  await rename(tmpPath, registryPath)
}
