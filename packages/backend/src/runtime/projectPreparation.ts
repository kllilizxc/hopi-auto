import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createProcessGroupTerminator } from './processGroup'

export const PROJECT_PREPARE_PATH = 'scripts/hopi/prepare'

export type ProjectPreparationKind =
  | 'ready'
  | 'absent'
  | 'not_executable'
  | 'failed'
  | 'source_changed'
  | 'skipped_dirty'
  | 'release_mismatch'

export interface ProjectPreparationResult {
  kind: ProjectPreparationKind
  adapterPath: string
  exitCode: number | null
  startedAt: string
  endedAt: string
  durationMs: number
  logs: string
  logPath: string
  reposFile: string
}

export interface ProjectPreparationRepoRoot {
  repoId: string
  path: string
}

export type ProjectPreparationProjection = 'candidate' | 'release'

export interface ProjectPreparer {
  prepare(input: {
    projectRoot: string
    runtimeDir: string
    cacheDir: string
    timeoutMs?: number
    primaryRepoId?: string
    repoRoots?: readonly ProjectPreparationRepoRoot[]
    releaseHeads?: Readonly<Record<string, string>>
    projection?: ProjectPreparationProjection
  }): Promise<ProjectPreparationResult>
}

export function createProjectPreparer(): ProjectPreparer {
  return {
    async prepare(input) {
      const startedAt = new Date()
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
      const releaseHeads = input.releaseHeads
        ? Object.fromEntries(
            repoRoots.map((repo) => {
              const releaseHead = input.releaseHeads?.[repo.repoId]
              if (!releaseHead) {
                throw new Error(`Missing release head for Repo ${repo.repoId}`)
              }
              return [repo.repoId, releaseHead]
            }),
          )
        : undefined
      await Bun.write(
        reposFile,
        `${JSON.stringify(
          {
            projection: input.projection ?? 'release',
            primaryRepoId: input.primaryRepoId ?? repoRoots[0]?.repoId ?? 'primary',
            repoOrder: repoRoots.map((repo) => repo.repoId),
            repos: Object.fromEntries(repoRoots.map((repo) => [repo.repoId, repo.path])),
            ...(releaseHeads ? { releaseHeads } : {}),
          },
          null,
          2,
        )}\n`,
      )

      const observedRoots = repoRoots.map((repo) => repo.path)
      if (releaseHeads && (input.projection ?? 'release') === 'release') {
        const mismatches = (
          await Promise.all(
            repoRoots.map(async (repo) => {
              const actual = await gitHead(repo.path)
              const expected = releaseHeads[repo.repoId]
              return actual === expected
                ? null
                : `${repo.repoId}: expected ${expected}, got ${actual}`
            }),
          )
        ).filter((mismatch): mismatch is string => mismatch !== null)
        if (mismatches.length > 0) {
          return finishPreparation(
            {
              kind: 'release_mismatch',
              adapterPath: join(resolve(input.projectRoot), ...PROJECT_PREPARE_PATH.split('/')),
              exitCode: null,
              logs: `Managed release roots do not match the declared Project release heads:\n${mismatches.join('\n')}`,
              logPath,
              reposFile,
            },
            logPath,
            startedAt,
          )
        }
      }
      const initialStatuses = await sourceStatuses(observedRoots)
      const dirtyRoots = [...initialStatuses].filter(([, status]) => status)
      if (dirtyRoots.length > 0) {
        return finishPreparation(
          {
            kind: 'skipped_dirty',
            adapterPath: join(resolve(input.projectRoot), ...PROJECT_PREPARE_PATH.split('/')),
            exitCode: null,
            logs: `Project preparation was skipped because the managed release has uncheckpointed source:\n${renderStatuses(dirtyRoots)}`,
            logPath,
            reposFile,
          },
          logPath,
          startedAt,
        )
      }

      return prepareProject({
        projectRoot: resolve(input.projectRoot),
        repoRoots,
        reposFile,
        runtimeDir,
        cacheDir,
        timeoutMs: input.timeoutMs,
        startedAt,
      })
    },
  }
}

async function prepareProject(input: {
  projectRoot: string
  repoRoots: readonly ProjectPreparationRepoRoot[]
  reposFile: string
  runtimeDir: string
  cacheDir: string
  timeoutMs?: number
  startedAt: Date
}) {
  const adapterPath = join(input.projectRoot, ...PROJECT_PREPARE_PATH.split('/'))
  const logPath = join(input.runtimeDir, 'prepare.log')
  await mkdir(input.runtimeDir, { recursive: true })
  const adapter = Bun.file(adapterPath)
  if (!(await adapter.exists())) {
    return finishPreparation(
      {
        kind: 'absent',
        adapterPath,
        exitCode: null,
        logs: `${PROJECT_PREPARE_PATH} is missing.`,
        logPath,
        reposFile: input.reposFile,
      },
      logPath,
      input.startedAt,
    )
  }
  const stats = await adapter.stat()
  if (!stats.isFile() || (stats.mode & 0o111) === 0) {
    return finishPreparation(
      {
        kind: 'not_executable',
        adapterPath,
        exitCode: null,
        logs: `${PROJECT_PREPARE_PATH} is not executable.`,
        logPath,
        reposFile: input.reposFile,
      },
      logPath,
      input.startedAt,
    )
  }

  const before = await sourceStatuses(input.repoRoots.map((repo) => repo.path))
  const lines: string[] = []
  let exitCode: number | null = null
  try {
    const child = Bun.spawn([adapterPath], {
      cwd: input.projectRoot,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        HOPI_GOAL_ID: undefined,
        HOPI_PROJECT_ROOT: input.projectRoot,
        HOPI_REPOS_FILE: input.reposFile,
        HOPI_PREPARE_RUNTIME_DIR: input.runtimeDir,
        HOPI_CACHE_DIR: input.cacheDir,
      },
      detached: true,
    })
    const terminate = createProcessGroupTerminator(child.pid, { trackDescendants: true })
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
      `stderr: ${PROJECT_PREPARE_PATH} modified Project source:\n${renderStatuses([...after])}`,
    )
    return finishPreparation(
      {
        kind: 'source_changed',
        adapterPath,
        exitCode,
        logs: lines.join('\n'),
        logPath,
        reposFile: input.reposFile,
      },
      logPath,
      input.startedAt,
    )
  }
  return finishPreparation(
    {
      kind: exitCode === 0 ? 'ready' : 'failed',
      adapterPath,
      exitCode,
      logs: lines.join('\n'),
      logPath,
      reposFile: input.reposFile,
    },
    logPath,
    input.startedAt,
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

async function finishPreparation(
  result: Omit<ProjectPreparationResult, 'startedAt' | 'endedAt' | 'durationMs'>,
  logPath: string,
  startedAt: Date,
): Promise<ProjectPreparationResult> {
  const endedAt = new Date()
  const completed = {
    ...result,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
  }
  await mkdir(dirname(logPath), { recursive: true })
  await Bun.write(logPath, completed.logs ? `${completed.logs}\n` : '')
  return completed
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

async function gitHead(cwd: string) {
  const child = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || 'Cannot inspect managed release HEAD')
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
