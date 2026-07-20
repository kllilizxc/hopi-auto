import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createProcessGroupTerminator } from './processGroup'

export const PROJECT_PREPARE_PATH = 'scripts/hopi/prepare'

export type ProjectPreparationKind =
  | 'ready'
  | 'absent'
  | 'not_executable'
  | 'failed'
  | 'source_changed'
  | 'skipped_dirty'

export interface RepoPreparationResult {
  repoId: string
  repoRoot: string
  kind: ProjectPreparationKind
  adapterPath: string
  exitCode: number | null
  logs: string
  logPath: string
}

export interface ProjectPreparationResult {
  kind: ProjectPreparationKind
  adapterPath: string
  exitCode: number | null
  logs: string
  logPath: string
  repos: readonly RepoPreparationResult[]
}

export interface ProjectPreparationRepoRoot {
  repoId: string
  path: string
}

export interface ProjectPreparer {
  prepare(input: {
    projectRoot: string
    runtimeDir: string
    cacheDir: string
    timeoutMs?: number
    goalId?: string
    primaryRepoId?: string
    repoRoots?: readonly ProjectPreparationRepoRoot[]
  }): Promise<ProjectPreparationResult>
}

export function createProjectPreparer(): ProjectPreparer {
  return {
    async prepare(input) {
      const runtimeDir = resolve(input.runtimeDir)
      const cacheDir = resolve(input.cacheDir)
      const logPath = join(runtimeDir, 'prepare.log')
      const reposFile = join(runtimeDir, 'repos.json')
      await Promise.all([
        mkdir(runtimeDir, { recursive: true }),
        mkdir(cacheDir, { recursive: true }),
      ])
      const repoRoots = normalizeRepoRoots(
        input.repoRoots ?? [
          { repoId: input.primaryRepoId ?? 'primary', path: resolve(input.projectRoot) },
        ],
      )
      await Bun.write(
        reposFile,
        `${JSON.stringify(
          {
            primaryRepoId: input.primaryRepoId ?? repoRoots[0]?.repoId ?? 'primary',
            repoOrder: repoRoots.map((repo) => repo.repoId),
            repos: Object.fromEntries(repoRoots.map((repo) => [repo.repoId, repo.path])),
          },
          null,
          2,
        )}\n`,
      )

      const observedRoots = repoRoots.map((repo) => repo.path)
      const initialStatuses = await sourceStatuses(observedRoots)
      const dirtyRoots = [...initialStatuses].filter(([, status]) => status)
      if (dirtyRoots.length > 0) {
        const logs = `Repo preparation was skipped because a task checkout already has uncheckpointed source:\n${renderStatuses(dirtyRoots)}`
        const repos = await Promise.all(
          repoRoots.map((repo, index) =>
            finishRepo(
              repo,
              repoRuntimeDir(runtimeDir, repo.repoId, index),
              'skipped_dirty',
              null,
              logs,
            ),
          ),
        )
        return finishProject(repos, logPath)
      }

      const repos: RepoPreparationResult[] = []
      for (const [index, repo] of repoRoots.entries()) {
        const result = await prepareRepo({
          repo,
          repoRoots,
          reposFile,
          runtimeDir: repoRuntimeDir(runtimeDir, repo.repoId, index),
          cacheDir,
          timeoutMs: input.timeoutMs,
          goalId: input.goalId,
        })
        repos.push(result)
      }
      return finishProject(repos, logPath)
    },
  }
}

async function prepareRepo(input: {
  repo: ProjectPreparationRepoRoot
  repoRoots: readonly ProjectPreparationRepoRoot[]
  reposFile: string
  runtimeDir: string
  cacheDir: string
  timeoutMs?: number
  goalId?: string
}) {
  const adapterPath = join(input.repo.path, ...PROJECT_PREPARE_PATH.split('/'))
  await mkdir(input.runtimeDir, { recursive: true })
  const adapter = Bun.file(adapterPath)
  if (!(await adapter.exists())) {
    return finishRepo(
      input.repo,
      input.runtimeDir,
      'absent',
      null,
      `${PROJECT_PREPARE_PATH} is missing.`,
    )
  }
  const stats = await adapter.stat()
  if (!stats.isFile() || (stats.mode & 0o111) === 0) {
    return finishRepo(
      input.repo,
      input.runtimeDir,
      'not_executable',
      null,
      `${PROJECT_PREPARE_PATH} is not executable.`,
    )
  }

  const before = await sourceStatuses(input.repoRoots.map((repo) => repo.path))
  const lines: string[] = []
  let exitCode: number | null = null
  try {
    const environment: Record<string, string | undefined> = {
      ...process.env,
      HOPI_GOAL_ID: undefined,
    }
    if (input.goalId) environment.HOPI_GOAL_ID = input.goalId
    const child = Bun.spawn([adapterPath], {
      cwd: input.repo.path,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...environment,
        HOPI_PROJECT_ROOT: input.repo.path,
        HOPI_REPO_ID: input.repo.repoId,
        HOPI_REPO_ROOT: input.repo.path,
        HOPI_REPOS_FILE: input.reposFile,
        HOPI_PREPARE_RUNTIME_DIR: input.runtimeDir,
        HOPI_CACHE_DIR: input.cacheDir,
      },
      detached: true,
    })
    const terminate = createProcessGroupTerminator(child.pid)
    const streams = Promise.all([
      consume(child.stdout, (line) => lines.push(`stdout: ${line}`)),
      consume(child.stderr, (line) => lines.push(`stderr: ${line}`)),
    ])
    const timeoutMs = input.timeoutMs ?? 300_000
    let timeout: ReturnType<typeof setTimeout> | undefined
    const completion = await Promise.race([
      child.exited.then((code) => ({ kind: 'exit' as const, code })),
      new Promise<{ kind: 'timeout' }>((resolveTimeout) => {
        timeout = setTimeout(() => resolveTimeout({ kind: 'timeout' }), timeoutMs)
      }),
    ]).finally(() => clearTimeout(timeout))
    if (completion.kind === 'timeout') {
      await terminate()
      await child.exited
      lines.push(`stderr: ${PROJECT_PREPARE_PATH} timed out after ${timeoutMs}ms.`)
    } else {
      exitCode = completion.code
      await terminate()
    }
    await streams
  } catch (error) {
    lines.push(`stderr: Unable to execute ${PROJECT_PREPARE_PATH}: ${errorMessage(error)}`)
  }

  const after = await sourceStatuses(input.repoRoots.map((repo) => repo.path))
  if (JSON.stringify([...after]) !== JSON.stringify([...before])) {
    lines.push(
      `stderr: ${PROJECT_PREPARE_PATH} modified Repo source:\n${renderStatuses([...after])}`,
    )
    return finishRepo(input.repo, input.runtimeDir, 'source_changed', exitCode, lines.join('\n'))
  }
  return finishRepo(
    input.repo,
    input.runtimeDir,
    exitCode === 0 ? 'ready' : 'failed',
    exitCode,
    lines.join('\n'),
  )
}

function normalizeRepoRoots(repoRoots: readonly ProjectPreparationRepoRoot[]) {
  if (repoRoots.length === 0) throw new Error('Repo preparation workspace must not be empty')
  const normalized = repoRoots.map((repo) => ({ ...repo, path: resolve(repo.path) }))
  if (new Set(normalized.map((repo) => repo.repoId)).size !== normalized.length) {
    throw new Error('Repo preparation IDs must be unique')
  }
  return normalized
}

async function sourceStatuses(roots: readonly string[]) {
  return new Map(
    await Promise.all(roots.map(async (root) => [root, await sourceStatus(root)] as const)),
  )
}

function renderStatuses(entries: readonly (readonly [string, string])[]) {
  return entries.map(([root, status]) => `${root}:\n${status || '(clean)'}`).join('\n')
}

async function finishRepo(
  repo: ProjectPreparationRepoRoot,
  runtimeDir: string,
  kind: ProjectPreparationKind,
  exitCode: number | null,
  logs: string,
): Promise<RepoPreparationResult> {
  const logPath = join(runtimeDir, 'prepare.log')
  await mkdir(runtimeDir, { recursive: true })
  await Bun.write(logPath, logs ? `${logs}\n` : '')
  return {
    repoId: repo.repoId,
    repoRoot: repo.path,
    kind,
    adapterPath: join(repo.path, ...PROJECT_PREPARE_PATH.split('/')),
    exitCode,
    logs,
    logPath,
  }
}

async function finishProject(
  repos: readonly RepoPreparationResult[],
  logPath: string,
): Promise<ProjectPreparationResult> {
  if (repos.length === 0) throw new Error('Repo preparation produced no result')
  const failed = repos.find((repo) => repo.kind !== 'ready')
  const representative = failed ?? repos[0]
  if (!representative) throw new Error('Repo preparation produced no representative result')
  const logs = repos
    .map(
      (repo) =>
        `## Repo ${repo.repoId}\n\nStatus: ${repo.kind}\nAdapter: ${repo.adapterPath}\nLog: ${repo.logPath}\n\n${repo.logs}`,
    )
    .join('\n\n')
  await Bun.write(logPath, logs ? `${logs}\n` : '')
  return {
    kind: representative.kind,
    adapterPath: representative.adapterPath,
    exitCode: representative.exitCode,
    logs,
    logPath,
    repos,
  }
}

function repoRuntimeDir(runtimeDir: string, repoId: string, index: number) {
  return join(
    runtimeDir,
    'repos',
    `${String(index).padStart(3, '0')}-${encodeURIComponent(repoId)}`,
  )
}

async function sourceStatus(cwd: string) {
  const child = Bun.spawn(
    ['git', 'status', '--porcelain=v1', '--untracked-files=all', '--', '.', ':(exclude).hopi/**'],
    { cwd, stdout: 'pipe', stderr: 'pipe' },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || 'Cannot inspect Repo preparation source status')
  return stdout.trim()
}

async function consume(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffered += decoder.decode(value, { stream: true })
    const lines = buffered.split(/\r?\n/)
    buffered = lines.pop() ?? ''
    for (const line of lines) onLine(line)
  }
  buffered += decoder.decode()
  if (buffered) onLine(buffered)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
