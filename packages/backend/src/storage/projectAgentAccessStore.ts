import { mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { projectAgentAccessPath } from './assistantRuntimePaths'

const projectAgentAccessStateSchema = z
  .object({
    version: z.literal(1),
    projects: z.record(z.string(), z.boolean()),
  })
  .strict()

type ProjectAgentAccessState = z.infer<typeof projectAgentAccessStateSchema>

const EMPTY_STATE: ProjectAgentAccessState = { version: 1, projects: {} }

export interface ProjectAgentAccessPreference {
  fullAccess: boolean
  configured: boolean
}

export function createProjectAgentAccessStore(homeRoot: string) {
  const path = projectAgentAccessPath(homeRoot)
  let writes = Promise.resolve()

  async function read(projectId: string): Promise<ProjectAgentAccessPreference> {
    await writes
    const state = await readState(path)
    return {
      fullAccess: state.projects[projectId] ?? false,
      configured: Object.hasOwn(state.projects, projectId),
    }
  }

  async function write(projectId: string, fullAccess: boolean) {
    const operation = writes.then(async () => {
      const state = await readState(path)
      await writeState(path, {
        ...state,
        projects: { ...state.projects, [projectId]: fullAccess },
      })
    })
    writes = operation.catch(() => undefined)
    await operation
    return { projectId, fullAccess, configured: true as const }
  }

  return { read, write }
}

async function readState(path: string): Promise<ProjectAgentAccessState> {
  const file = Bun.file(path)
  if (!(await file.exists())) return EMPTY_STATE
  return projectAgentAccessStateSchema.parse(await file.json())
}

async function writeState(path: string, state: ProjectAgentAccessState) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  await Bun.write(
    temporary,
    `${JSON.stringify(projectAgentAccessStateSchema.parse(state), null, 2)}\n`,
  )
  await rename(temporary, path)
}
