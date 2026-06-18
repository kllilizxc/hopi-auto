import { chmod, mkdir, readFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentOutcome } from '../agent/AgentRunner'
import type { TaskKind } from '../domain/board'
import { createProjectPaths } from '../storage/paths'
import { createWorktreeManager, worktreeBranchName } from './worktreeManager'

export const PROJECT_MERGE_SCRIPT_RELATIVE_PATH = 'scripts/hopi/merge-task.sh'
const MERGE_SCRIPT_ATTEMPT_FILE = 'merge-script-attempt.json'
const FALLBACK_MERGE_SCRIPT_FILE = 'merge-task.fallback.sh'

export interface CompleteMergeOptions {
  goalKey: string
  taskRef: string
  taskKind: TaskKind
  runId: string
  stepId?: string
}

export interface MergeScriptResult {
  kind: 'merged' | 'needs_merger' | 'merge_conflict'
  reason: string
  artifactRef?: string
  artifactLabel?: string
}

export interface MergeScriptAttemptRecord {
  attemptedAt: string
  scriptPath: string
  command: string[]
  stdout: string
  stderr: string
  exitCode: number
  result?: MergeScriptResult
  parseError?: string
}

export interface GitMergeExecutor {
  runMergeScript?(options: CompleteMergeOptions): Promise<MergeScriptAttemptRecord>
  finalizeMergedRun?(options: CompleteMergeOptions): Promise<void>
  completeMerge(options: CompleteMergeOptions): Promise<AgentOutcome>
}

export function createGitMergeExecutor(rootDir = process.cwd()): GitMergeExecutor {
  const worktrees = createWorktreeManager(rootDir)
  const paths = createProjectPaths(rootDir)

  return {
    async runMergeScript(options) {
      if (options.taskKind === 'planning') {
        const attempt: MergeScriptAttemptRecord = {
          attemptedAt: new Date().toISOString(),
          scriptPath: join(rootDir, PROJECT_MERGE_SCRIPT_RELATIVE_PATH),
          command: [],
          stdout: '',
          stderr: '',
          exitCode: 0,
          result: {
            kind: 'merged',
            reason: 'Planning merge is a durable Goal-doc no-op.',
          },
        }
        if (options.stepId) {
          await writeMergeScriptAttemptRecord(rootDir, options, attempt)
        }
        return attempt
      }

      const branch = worktreeBranchName(options.goalKey, options.taskRef, options.runId)
      const worktreePath = paths.worktreePath(options.goalKey, options.taskRef, options.runId)
      const scriptPath = await resolveMergeScriptPath(rootDir, {
        goalKey: options.goalKey,
        taskRef: options.taskRef,
        runId: options.runId,
        stepId: options.stepId,
      })
      const command = [
        'bash',
        scriptPath,
        options.goalKey,
        options.taskRef,
        options.taskKind,
        options.runId,
        branch,
        worktreePath,
      ]
      const child = Bun.spawn(command, {
        cwd: rootDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          HOPI_GOAL_KEY: options.goalKey,
          HOPI_TASK_REF: options.taskRef,
          HOPI_TASK_KIND: options.taskKind,
          HOPI_RUN_ID: options.runId,
          HOPI_WORKTREE_BRANCH: branch,
          HOPI_WORKTREE_PATH: worktreePath,
          HOPI_PROJECT_ROOT: rootDir,
          HOPI_MERGE_SCRIPT_PATH: scriptPath,
        },
      })
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      const attemptedAt = new Date().toISOString()
      const parsed = parseMergeScriptResult(stdout)
      const attempt: MergeScriptAttemptRecord = {
        attemptedAt,
        scriptPath,
        command,
        stdout,
        stderr,
        exitCode,
        ...(parsed.result ? { result: parsed.result } : {}),
        ...(parsed.parseError ? { parseError: parsed.parseError } : {}),
      }
      if (options.stepId) {
        await writeMergeScriptAttemptRecord(rootDir, options, attempt)
      }
      return attempt
    },
    async finalizeMergedRun(options) {
      await worktrees.cleanup(options)
    },
    async completeMerge(options) {
      const attempt = await this.runMergeScript!(options)
      if (!attempt.result) {
        throw new Error(
          `merge script failed: ${firstNonEmpty(
            attempt.parseError,
            attempt.stderr.trim(),
            attempt.stdout.trim(),
            `exit ${attempt.exitCode}`,
          )}`,
        )
      }

      if (attempt.result.kind === 'merged') {
        await this.finalizeMergedRun!(options)
        return { kind: 'success' }
      }

      if (attempt.result.kind === 'merge_conflict') {
        return {
          kind: 'merge_conflict',
          artifactRef:
            attempt.result.artifactRef ??
            `branch:${worktreeBranchName(options.goalKey, options.taskRef, options.runId)}`,
        }
      }

      if (attempt.result.artifactRef) {
        return {
          kind: 'merge_conflict',
          artifactRef: attempt.result.artifactRef,
        }
      }

      return {
        kind: 'fail',
        reason: attempt.result.reason,
      }
    },
  }
}

export function mergeScriptAttemptPath(
  rootDir: string,
  options: { goalKey: string; runId: string; stepId: string },
) {
  const paths = createProjectPaths(rootDir)
  return join(paths.runtimeStepDir(options.goalKey, options.runId, options.stepId), MERGE_SCRIPT_ATTEMPT_FILE)
}

async function writeMergeScriptAttemptRecord(
  rootDir: string,
  options: { goalKey: string; runId: string; stepId?: string },
  attempt: MergeScriptAttemptRecord,
) {
  if (!options.stepId) {
    return
  }
  const path = mergeScriptAttemptPath(rootDir, {
    goalKey: options.goalKey,
    runId: options.runId,
    stepId: options.stepId,
  })
  await mkdir(dirname(path), { recursive: true })
  const tmpPath = `${path}.tmp.${crypto.randomUUID()}`
  await Bun.write(tmpPath, `${JSON.stringify(attempt, null, 2)}\n`)
  await rename(tmpPath, path)
}

export async function resolveMergeScriptPath(
  rootDir: string,
  options: { goalKey: string; taskRef: string; runId: string; stepId?: string },
) {
  const paths = createProjectPaths(rootDir)
  const worktreeScriptPath = join(
    paths.worktreePath(options.goalKey, options.taskRef, options.runId),
    PROJECT_MERGE_SCRIPT_RELATIVE_PATH,
  )
  if (await Bun.file(worktreeScriptPath).exists()) {
    await chmod(worktreeScriptPath, 0o755).catch(() => undefined)
    return worktreeScriptPath
  }

  const rootScriptPath = join(rootDir, PROJECT_MERGE_SCRIPT_RELATIVE_PATH)
  if (await Bun.file(rootScriptPath).exists()) {
    await chmod(rootScriptPath, 0o755).catch(() => undefined)
    return rootScriptPath
  }

  const fallbackPath = options.stepId
    ? join(paths.runtimeStepDir(options.goalKey, options.runId, options.stepId), FALLBACK_MERGE_SCRIPT_FILE)
    : join(paths.runtimeGoalDir(options.goalKey), 'merge-scripts', `${options.taskRef}-${options.runId}.sh`)
  await mkdir(dirname(fallbackPath), { recursive: true })
  await Bun.write(fallbackPath, defaultMergeScriptTemplate())
  await chmod(fallbackPath, 0o755)
  return fallbackPath
}

function parseMergeScriptResult(stdout: string) {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const lastLine = lines.at(-1)
  if (!lastLine) {
    return { parseError: 'merge script did not emit any stdout' } as const
  }

  try {
    const raw = JSON.parse(lastLine) as Partial<MergeScriptResult>
    if (
      raw.kind !== 'merged' &&
      raw.kind !== 'needs_merger' &&
      raw.kind !== 'merge_conflict'
    ) {
      return { parseError: `invalid merge script result kind: ${String(raw.kind)}` } as const
    }
    if (typeof raw.reason !== 'string' || raw.reason.trim().length === 0) {
      return { parseError: 'merge script result is missing a non-empty reason' } as const
    }
    return {
      result: {
        kind: raw.kind,
        reason: raw.reason,
        ...(raw.artifactRef ? { artifactRef: raw.artifactRef } : {}),
        ...(raw.artifactLabel ? { artifactLabel: raw.artifactLabel } : {}),
      } satisfies MergeScriptResult,
    } as const
  } catch (error) {
    return {
      parseError: `invalid merge script JSON: ${error instanceof Error ? error.message : String(error)}`,
    } as const
  }
}

function defaultMergeScriptTemplate() {
  return `#!/usr/bin/env bash
set -euo pipefail

goal_key="\${1:?goal key required}"
task_ref="\${2:?task ref required}"
task_kind="\${3:?task kind required}"
run_id="\${4:?run id required}"
branch="\${5:?branch required}"
worktree_path="\${6:?worktree path required}"

script_rel="scripts/hopi/merge-task.sh"
ignore_dirty_prefixes=(
  ".hopi/"
  "scripts/"
  "$script_rel"
  "scripts/hopi/"
)

git_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$git_root"

emit_json() {
  bun -e '
    const [kind, reason, artifactRef, artifactLabel] = process.argv.slice(1)
    const payload = { kind, reason }
    if (artifactRef) payload.artifactRef = artifactRef
    if (artifactLabel) payload.artifactLabel = artifactLabel
    process.stdout.write(JSON.stringify(payload) + "\\n")
  ' -- "$1" "$2" "\${3:-}" "\${4:-}"
}

mapfile -t dirty_files < <(git status --porcelain | sed -E 's/^.. //' | sed '/^$/d')
filtered_dirty=()
for dirty in "\${dirty_files[@]:-}"; do
  skip=0
  for prefix in "\${ignore_dirty_prefixes[@]}"; do
    if [[ "$dirty" == "$prefix"* ]]; then
      skip=1
      break
    fi
  done
  if [[ "$skip" -eq 0 ]]; then
    filtered_dirty+=("$dirty")
  fi
done

if [[ "\${#filtered_dirty[@]}" -gt 0 ]]; then
  first_dirty="\${filtered_dirty[0]}"
  emit_json "merge_conflict" "Root workspace has local changes blocking merge: \${filtered_dirty[*]}" "$first_dirty" "root-workspace-dirty"
  exit 0
fi

if ! git show-ref --verify --quiet "refs/heads/$branch"; then
  emit_json "needs_merger" "Missing merge branch: $branch"
  exit 0
fi

merge_stdout=""
merge_stderr=""
set +e
merge_stdout="$(git merge --no-ff --no-edit "$branch" 2> >(cat >&2))"
merge_exit=$?
set -e

if [[ "$merge_exit" -eq 0 ]]; then
  emit_json "merged" "Merged branch $branch into the root workspace."
  exit 0
fi

unmerged_files="$(git diff --name-only --diff-filter=U || true)"
if [[ -n "$unmerged_files" ]]; then
  git merge --abort >/dev/null 2>&1 || true
  escaped_unmerged="$(printf '%s' "$unmerged_files" | tr '\n' ',' | sed 's/,$//')"
  emit_json "needs_merger" "git merge reported unmerged files: $escaped_unmerged" "branch:$branch" "merge-conflict"
  exit 0
fi

git merge --abort >/dev/null 2>&1 || true
emit_json "needs_merger" "git merge failed without unmerged files for branch $branch."
`
}

export async function readProjectMergeScript(path: string) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

function firstNonEmpty(...values: Array<string | undefined>) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }

  return ''
}
