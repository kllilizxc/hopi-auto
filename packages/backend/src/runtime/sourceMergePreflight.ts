export type SourceMergePreflightResult =
  | { kind: 'ready' }
  | { kind: 'conflict'; paths: string[] }
  | { kind: 'failed'; detail: string }

export interface SourceMergeInspection {
  releaseHead: string
  taskHead: string
  mergeBase: string
  result: SourceMergePreflightResult
}

export async function inspectSourceMerge(input: {
  repoRoot: string
  taskRoot: string
  releaseRef: string
  indexPath: string
}): Promise<SourceMergeInspection> {
  const [releaseHead, taskHead] = await Promise.all([
    gitOutput(input.repoRoot, ['rev-parse', input.releaseRef]),
    gitOutput(input.taskRoot, ['rev-parse', 'HEAD']),
  ])
  const mergeBase = await gitOutput(input.repoRoot, ['merge-base', releaseHead, taskHead])
  return {
    releaseHead,
    taskHead,
    mergeBase,
    result: await stageSourceMerge({
      repoRoot: input.repoRoot,
      mergeBase,
      releaseHead,
      taskHead,
      indexPath: input.indexPath,
    }),
  }
}

export async function stageSourceMerge(input: {
  repoRoot: string
  mergeBase: string
  releaseHead: string
  taskHead: string
  indexPath: string
}): Promise<SourceMergePreflightResult> {
  const env = { ...process.env, GIT_INDEX_FILE: input.indexPath }
  const merge = await gitResult(
    input.repoRoot,
    ['read-tree', '-m', '--aggressive', input.mergeBase, input.releaseHead, input.taskHead],
    env,
  )
  if (merge.exitCode !== 0) {
    return { kind: 'failed', detail: merge.stderr.trim() || merge.stdout.trim() }
  }

  const unmerged = await gitResult(input.repoRoot, ['ls-files', '-u', '-z'], env)
  if (unmerged.exitCode !== 0) {
    return { kind: 'failed', detail: unmerged.stderr.trim() || unmerged.stdout.trim() }
  }
  const paths = [
    ...new Set(
      unmerged.stdout
        .split('\0')
        .filter(Boolean)
        .map((entry) => entry.split('\t', 2)[1])
        .filter((path): path is string => Boolean(path)),
    ),
  ].sort()
  return paths.length > 0 ? { kind: 'conflict', paths } : { kind: 'ready' }
}

async function gitResult(cwd: string, args: string[], env: Record<string, string>) {
  const child = Bun.spawn(['git', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}

async function gitOutput(cwd: string, args: string[]) {
  const result = await gitResult(cwd, args, process.env as Record<string, string>)
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr.trim()}`)
  }
  return result.stdout.trimEnd()
}
