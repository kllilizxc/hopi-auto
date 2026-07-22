export type SourceMergePreflightResult =
  | { kind: 'ready' }
  | { kind: 'conflict'; paths: string[] }
  | { kind: 'failed'; detail: string }

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
