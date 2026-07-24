import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { createProjectCommandRunner } from '../commands/projectCommandRunner'
import { acquireCoordinatorInstanceLock } from '../publication/instanceLock'
import { PublicationCoordinator } from '../publication/publisher'
import { defaultAssistantHomeRoot } from '../runtime/assistantHomeMigration'
import { createWorkspaceAttentionController } from '../runtime/workspaceAttentionController'
import { createAssistantHomeStore } from '../storage/assistantHomeStore'
import { createAssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    home: { type: 'string' },
    project: { type: 'string' },
    repo: { type: 'string' },
    path: { type: 'string' },
    'project-path': { type: 'string' },
    plan: { type: 'boolean', default: false },
  },
})

if (positionals.join(' ') !== 'project rebind') {
  fail(
    'Usage: hopi project rebind --project <id> --repo <id> --path <directory> [--project-path <relative>] [--plan] [--home <directory>]',
  )
}

const projectId = required(values.project, '--project')
const repoId = required(values.repo, '--repo')
const repoPath = required(values.path, '--path')
const homeRoot = values.home ?? process.env.HOPI_HOME?.trim() ?? defaultAssistantHomeRoot()
const publisher = new PublicationCoordinator()
const home = createAssistantHomeStore(homeRoot, publisher)
await home.initialize()
const workspace = createAssistantWorkspaceStore(homeRoot, publisher)
const commands = createProjectCommandRunner({
  home,
  publisher,
  attentions: createWorkspaceAttentionController(workspace),
})
const input = {
  projectId,
  repos: [
    {
      repoId,
      repoPath,
      ...(values['project-path'] ? { projectPath: values['project-path'] } : {}),
    },
  ],
}

if (values.plan) {
  console.log(JSON.stringify(await commands.planProjectRebind(input), null, 2))
  process.exit(0)
}

const lock = await acquireCoordinatorInstanceLock(
  join(homeRoot, '.hopi', 'runtime', 'coordinator.lock'),
)
try {
  console.log(JSON.stringify(await commands.executeProjectRebind(input), null, 2))
} finally {
  await lock.release()
}

function required(value: string | undefined, option: string) {
  if (!value?.trim()) fail(`Missing required option ${option}`)
  return value.trim()
}

function fail(message: string): never {
  console.error(message)
  process.exit(2)
}
