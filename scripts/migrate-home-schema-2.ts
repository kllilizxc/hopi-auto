import { cp, mkdir, readdir, rename } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { parse, stringify } from 'yaml'
import { parseWorkDocument } from '../packages/backend/src/domain/canonicalDocuments'
import { ASSISTANT_HOME_SCHEMA_EPOCH } from '../packages/backend/src/domain/project'
import { managedRepoWorktreePaths } from '../packages/backend/src/runtime/managedWorktreePaths'

const SOURCE_EPOCH = 1
const TARGET_EPOCH = 2

interface ProjectLink {
  projectId: string
  primaryRepoId: string
  repos: Array<{ repoId: string; repoPath: string }>
}

interface WorkMigration {
  path: string
  source: string
  target: string
  projectId: string
}

interface AttemptMigration {
  path: string
  runId: string
  application: unknown
  source: string
  target: string
}

const options = parseArguments(process.argv.slice(2))
const homeRoot = resolve(options.home)
const hopiRoot = join(homeRoot, '.hopi')
const homePath = join(hopiRoot, 'home.yml')
const projectsPath = join(hopiRoot, 'projects.yml')
const homeDocument = requiredObject(parse(await Bun.file(homePath).text()), 'home.yml')
const sourceEpoch = homeDocument.schemaEpoch

if (sourceEpoch === TARGET_EPOCH) {
  console.log(JSON.stringify({ status: 'already_current', homeRoot, schemaEpoch: TARGET_EPOCH }))
  process.exit(0)
}
if (sourceEpoch !== SOURCE_EPOCH) {
  throw new Error(`Expected schema epoch ${SOURCE_EPOCH}, received ${String(sourceEpoch)}`)
}
if (ASSISTANT_HOME_SCHEMA_EPOCH !== TARGET_EPOCH) {
  throw new Error(
    `Migration target ${TARGET_EPOCH} does not match code epoch ${ASSISTANT_HOME_SCHEMA_EPOCH}`,
  )
}

const projectLinks = readProjectLinks(parse(await Bun.file(projectsPath).text()))
const workMigrations: WorkMigration[] = []
const projectGoalRoots = new Map<string, string>()

for (const project of projectLinks) {
  const primary = project.repos.find((repo) => repo.repoId === project.primaryRepoId)
  if (!primary) throw new Error(`Project ${project.projectId} has no primary Repo binding`)
  const integrationRoot = managedRepoWorktreePaths(primary.repoPath, project.projectId).integration
  const goalsRoot = join(integrationRoot, '.hopi', 'docs', 'goals')
  const workPaths = (await listMarkdownFiles(goalsRoot)).filter((path) =>
    relative(goalsRoot, path).split('/').includes('work'),
  )
  for (const path of workPaths) {
    const source = await Bun.file(path).text()
    const target = addRequiredWorkCollections(source)
    if (target === source) {
      parseWorkDocument(source)
      continue
    }
    parseWorkDocument(target)
    workMigrations.push({ path, source, target, projectId: project.projectId })
    projectGoalRoots.set(project.projectId, goalsRoot)
  }
}

const attemptMigrations: AttemptMigration[] = []
const runsRoot = join(hopiRoot, 'runtime', 'runs')
for (const entry of await readDirectory(runsRoot)) {
  if (!entry.isDirectory()) continue
  const path = join(runsRoot, entry.name, 'attempt.json')
  const file = Bun.file(path)
  if (!(await file.exists())) continue
  const source = await file.text()
  const attempt = requiredObject(JSON.parse(source), path)
  if (attempt.result !== 'attention') continue
  attempt.result = 'fail'
  const runId = typeof attempt.runId === 'string' ? attempt.runId : entry.name
  attemptMigrations.push({
    path,
    runId,
    application: attempt.application,
    source,
    target: `${JSON.stringify(attempt, null, 2)}\n`,
  })
}

const plan = {
  status: options.apply ? 'ready_to_apply' : 'dry_run',
  homeRoot,
  sourceEpoch: SOURCE_EPOCH,
  targetEpoch: TARGET_EPOCH,
  works: workMigrations.length,
  projects: Object.fromEntries(
    [...projectGoalRoots.keys()].map((projectId) => [
      projectId,
      workMigrations.filter((migration) => migration.projectId === projectId).length,
    ]),
  ),
  attempts: attemptMigrations.length,
}

if (!options.apply) {
  console.log(JSON.stringify(plan, null, 2))
  process.exit(0)
}

const backupRoot = join(homeRoot, 'backups', `schema-epoch-2-${fileTimestamp(new Date())}`)
await mkdir(backupRoot, { recursive: true })
await mkdir(join(backupRoot, 'assistant-home'), { recursive: true })
await cp(homePath, join(backupRoot, 'assistant-home', 'home.yml'), {
  recursive: false,
  force: false,
})
await cp(projectsPath, join(backupRoot, 'assistant-home', 'projects.yml'), {
  recursive: false,
  force: false,
})

for (const [projectId, goalsRoot] of projectGoalRoots) {
  await mkdir(join(backupRoot, 'project-goals'), { recursive: true })
  await cp(goalsRoot, join(backupRoot, 'project-goals', projectId), {
    recursive: true,
    force: false,
  })
}
for (const migration of attemptMigrations) {
  const target = join(backupRoot, 'attempts', migration.runId, 'attempt.json')
  await mkdir(resolve(target, '..'), { recursive: true })
  await Bun.write(target, migration.source)
}
await Bun.write(
  join(backupRoot, 'manifest.json'),
  `${JSON.stringify(
    {
      ...plan,
      status: 'backup_complete',
      createdAt: new Date().toISOString(),
      workFiles: workMigrations.map(({ projectId, path }) => ({ projectId, path })),
      attemptIds: attemptMigrations.map(({ runId }) => runId),
    },
    null,
    2,
  )}\n`,
)

for (const migration of workMigrations) {
  await writeAtomically(migration.path, migration.target)
}
for (const migration of attemptMigrations) {
  await writeAtomically(migration.path, migration.target)
}

for (const migration of workMigrations) {
  parseWorkDocument(await Bun.file(migration.path).text())
}
for (const migration of attemptMigrations) {
  const attempt = requiredObject(await Bun.file(migration.path).json(), migration.path)
  if (attempt.result !== 'fail' || attempt.application !== migration.application) {
    throw new Error(`Attempt migration did not preserve Attention semantics: ${migration.path}`)
  }
}

const targetHome = { ...homeDocument, schemaEpoch: TARGET_EPOCH }
await writeAtomically(homePath, stringify(targetHome))

console.log(
  JSON.stringify(
    {
      ...plan,
      status: 'migrated',
      backupRoot,
    },
    null,
    2,
  ),
)

function parseArguments(args: string[]) {
  let home = ''
  let apply = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--apply') {
      apply = true
      continue
    }
    if (argument === '--home') {
      home = args[index + 1] ?? ''
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  if (!home) throw new Error('Usage: --home <assistant-home> [--apply]')
  return { home, apply }
}

function readProjectLinks(value: unknown): ProjectLink[] {
  const document = requiredObject(value, 'projects.yml')
  if (!Array.isArray(document.projects)) throw new Error('projects.yml has no projects array')
  return document.projects.map((value, index) => {
    const project = requiredObject(value, `projects[${index}]`)
    if (
      typeof project.projectId !== 'string' ||
      typeof project.primaryRepoId !== 'string' ||
      !Array.isArray(project.repos)
    ) {
      throw new Error(`Invalid Project link at projects[${index}]`)
    }
    return {
      projectId: project.projectId,
      primaryRepoId: project.primaryRepoId,
      repos: project.repos.map((value, repoIndex) => {
        const repo = requiredObject(value, `projects[${index}].repos[${repoIndex}]`)
        if (typeof repo.repoId !== 'string' || typeof repo.repoPath !== 'string') {
          throw new Error(`Invalid Repo link at projects[${index}].repos[${repoIndex}]`)
        }
        return { repoId: repo.repoId, repoPath: repo.repoPath }
      }),
    }
  })
}

function addRequiredWorkCollections(source: string) {
  const normalized = source.replaceAll('\r\n', '\n')
  if (!normalized.startsWith('---\n')) throw new Error('Work document has no YAML front matter')
  const delimiterIndex = normalized.indexOf('\n---\n', 4)
  if (delimiterIndex < 0) throw new Error('Work document has unterminated YAML front matter')
  const attributes = requiredObject(parse(normalized.slice(4, delimiterIndex)), 'Work front matter')
  const additions = []
  if (!Object.hasOwn(attributes, 'contextRefs')) additions.push('contextRefs: []')
  if (!Object.hasOwn(attributes, 'ownerMessages')) additions.push('ownerMessages: []')
  if (additions.length === 0) return source
  return `${normalized.slice(0, delimiterIndex)}\n${additions.join('\n')}${normalized.slice(delimiterIndex)}`
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readDirectory(root)) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...(await listMarkdownFiles(path)))
    else if (entry.isFile() && path.endsWith('.md')) files.push(path)
  }
  return files
}

async function readDirectory(path: string) {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
}

function requiredObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

async function writeAtomically(path: string, content: string) {
  const temporaryPath = `${path}.tmp.${crypto.randomUUID()}`
  await Bun.write(temporaryPath, content)
  await rename(temporaryPath, path)
}

function fileTimestamp(value: Date) {
  return value.toISOString().replaceAll(/[-:.]/g, '')
}
