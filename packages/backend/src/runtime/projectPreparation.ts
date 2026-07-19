import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const PROJECT_PREPARE_PATH = 'scripts/hopi/prepare'

export type ProjectPreparationKind =
  | 'ready'
  | 'absent'
  | 'not_executable'
  | 'failed'
  | 'source_changed'
  | 'skipped_dirty'

export interface ProjectPreparationResult {
  kind: ProjectPreparationKind
  adapterPath: string
  exitCode: number | null
  logs: string
  logPath: string
}

export interface ProjectPreparationRepoRoot {
  repoId: string
  path: string
}

export interface ProjectPreparer {
  prepare(input: {
    projectRoot: string
    runtimeDir: string
    timeoutMs?: number
    goalId?: string
    primaryRepoId?: string
    repoRoots?: readonly ProjectPreparationRepoRoot[]
  }): Promise<ProjectPreparationResult>
}

export function createProjectPreparer(): ProjectPreparer {
  return {
    async prepare(input) {
      const projectRoot = resolve(input.projectRoot)
      const runtimeDir = resolve(input.runtimeDir)
      const adapterPath = join(projectRoot, ...PROJECT_PREPARE_PATH.split('/'))
      const logPath = join(runtimeDir, 'prepare.log')
      const reposFile = join(runtimeDir, 'repos.json')
      await mkdir(runtimeDir, { recursive: true })
      const repoRoots = normalizeRepoRoots(
        input.repoRoots ?? [{ repoId: 'primary', path: projectRoot }],
      )
      const selectedPaths = new Set(repoRoots.map((repo) => repo.path))
      const observedRoots = [...new Set([projectRoot, ...selectedPaths])]
      await Bun.write(
        reposFile,
        `${JSON.stringify(
          {
            primaryRepoId: input.primaryRepoId ?? 'primary',
            repos: Object.fromEntries(repoRoots.map((repo) => [repo.repoId, repo.path])),
          },
          null,
          2,
        )}\n`,
      )

      const before = await sourceStatuses(observedRoots)
      const dirtySelected = [...before].filter(
        ([root, status]) => selectedPaths.has(root) && status,
      )
      if (dirtySelected.length > 0) {
        return finish({
          kind: 'skipped_dirty',
          adapterPath,
          exitCode: null,
          logs: `Project preparation was skipped because a task checkout already has uncheckpointed source:\n${renderStatuses(dirtySelected)}`,
          logPath,
        })
      }
      const adapter = Bun.file(adapterPath)
      if (!(await adapter.exists())) {
        return finish({
          kind: 'absent',
          adapterPath,
          exitCode: null,
          logs: `${PROJECT_PREPARE_PATH} is missing.`,
          logPath,
        })
      }
      const stats = await adapter.stat()
      if (!stats.isFile() || (stats.mode & 0o111) === 0) {
        return finish({
          kind: 'not_executable',
          adapterPath,
          exitCode: null,
          logs: `${PROJECT_PREPARE_PATH} is not executable.`,
          logPath,
        })
      }

      const lines: string[] = []
      let exitCode: number | null = null
      try {
        const environment: Record<string, string | undefined> = {
          ...process.env,
          HOPI_GOAL_ID: undefined,
        }
        if (input.goalId) environment.HOPI_GOAL_ID = input.goalId
        const child = Bun.spawn([adapterPath], {
          cwd: projectRoot,
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            ...environment,
            HOPI_PROJECT_ROOT: projectRoot,
            HOPI_REPOS_FILE: reposFile,
            HOPI_PREPARE_RUNTIME_DIR: runtimeDir,
          },
        })
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
          child.kill('SIGTERM')
          await child.exited
          lines.push(`stderr: ${PROJECT_PREPARE_PATH} timed out after ${timeoutMs}ms.`)
        } else {
          exitCode = completion.code
        }
        await streams
      } catch (error) {
        lines.push(`stderr: Unable to execute ${PROJECT_PREPARE_PATH}: ${errorMessage(error)}`)
      }

      const after = await sourceStatuses(observedRoots)
      if (JSON.stringify([...after]) !== JSON.stringify([...before])) {
        lines.push(
          `stderr: ${PROJECT_PREPARE_PATH} modified Project source:\n${renderStatuses([...after])}`,
        )
        return finish({
          kind: 'source_changed',
          adapterPath,
          exitCode,
          logs: lines.join('\n'),
          logPath,
        })
      }
      return finish({
        kind: exitCode === 0 ? 'ready' : 'failed',
        adapterPath,
        exitCode,
        logs: lines.join('\n'),
        logPath,
      })
    },
  }
}

function normalizeRepoRoots(repoRoots: readonly ProjectPreparationRepoRoot[]) {
  if (repoRoots.length === 0)
    throw new Error('Project preparation Repo workspace must not be empty')
  const normalized = repoRoots.map((repo) => ({ ...repo, path: resolve(repo.path) }))
  if (new Set(normalized.map((repo) => repo.repoId)).size !== normalized.length) {
    throw new Error('Project preparation Repo IDs must be unique')
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

async function finish(result: ProjectPreparationResult) {
  await Bun.write(result.logPath, result.logs ? `${result.logs}\n` : '')
  return result
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
  if (exitCode !== 0) throw new Error(stderr || 'Cannot inspect Project preparation source status')
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
