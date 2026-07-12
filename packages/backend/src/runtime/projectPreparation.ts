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

export interface ProjectPreparer {
  prepare(input: {
    projectRoot: string
    runtimeDir: string
    timeoutMs?: number
  }): Promise<ProjectPreparationResult>
}

export function createProjectPreparer(): ProjectPreparer {
  return {
    async prepare(input) {
      const projectRoot = resolve(input.projectRoot)
      const runtimeDir = resolve(input.runtimeDir)
      const adapterPath = join(projectRoot, ...PROJECT_PREPARE_PATH.split('/'))
      const logPath = join(runtimeDir, 'prepare.log')
      await mkdir(runtimeDir, { recursive: true })

      const before = await sourceStatus(projectRoot)
      if (before) {
        return finish({
          kind: 'skipped_dirty',
          adapterPath,
          exitCode: null,
          logs: `Project preparation was skipped because the checkout already has uncheckpointed source:\n${before}`,
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
        const child = Bun.spawn([adapterPath], {
          cwd: projectRoot,
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            ...process.env,
            HOPI_PROJECT_ROOT: projectRoot,
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

      const after = await sourceStatus(projectRoot)
      if (after !== before) {
        lines.push(`stderr: ${PROJECT_PREPARE_PATH} modified Project source:\n${after}`)
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
