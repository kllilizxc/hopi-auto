import { mkdir, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { LinkedProject } from '../domain/project'
import { inspectGitProjectDirectory } from '../runtime/projectDirectory'
import type { AssistantHomeStore, RebindProjectReposInput } from '../storage/assistantHomeStore'

export interface CommandPlan {
  command: 'project.rebind'
  summary: string
  effects: string[]
  warnings: string[]
  changedRepoIds: string[]
  input: RebindProjectReposInput
  before: LinkedProject
}

export interface CommandResult {
  operationId: string
  command: 'project.rebind'
  status: 'completed'
  project: LinkedProject
  recoveryPaths: string[]
  followUpWarnings: string[]
}

export interface CommandRunner {
  planProjectRebind(input: RebindProjectReposInput): Promise<CommandPlan>
  executeProjectRebind(
    input: RebindProjectReposInput,
  ): Promise<{ plan: CommandPlan; result: CommandResult }>
}

export function createCommandRunner(
  home: AssistantHomeStore,
  options: {
    runProjectMutation?: <T>(projectId: string, operation: () => Promise<T>) => Promise<T>
    onProjectRebound?: (plan: CommandPlan, project: LinkedProject) => Promise<void>
  } = {},
): CommandRunner {
  async function planProjectRebind(input: RebindProjectReposInput): Promise<CommandPlan> {
    const before = await home.readProject(input.projectId)
    const replacements = new Map(input.repos.map((repo) => [repo.repoId, repo]))
    if (replacements.size !== input.repos.length) {
      throw new Error('Rebound Repo IDs must be unique')
    }
    for (const repoId of replacements.keys()) {
      if (!before.repos.some((repo) => repo.repoId === repoId)) {
        throw new Error(`Project ${input.projectId} has no Repo ${repoId}`)
      }
    }

    const inspected = await Promise.all(
      before.repos.map(async (repo) => {
        const replacement = replacements.get(repo.repoId)
        const source =
          replacement ??
          ({
            repoId: repo.repoId,
            repoPath: repo.repoPath,
            projectPath: repo.projectPath,
          } satisfies RebindProjectReposInput['repos'][number])
        return {
          repoId: repo.repoId,
          inspection: await inspectGitProjectDirectory(source.repoPath, source.projectPath),
        }
      }),
    )
    const commonDirs = new Set<string>()
    for (const repo of inspected) {
      if (commonDirs.has(repo.inspection.commonDir)) {
        throw new Error('The selected paths contain the same Git Repo more than once')
      }
      commonDirs.add(repo.inspection.commonDir)
    }

    const normalizedInput: RebindProjectReposInput = {
      projectId: input.projectId,
      repos: inspected.map(({ repoId, inspection }) => ({
        repoId,
        repoPath: inspection.repoPath,
        projectPath: inspection.projectPath,
      })),
    }
    const changedRepoIds = before.repos.flatMap((repo) => {
      const next = normalizedInput.repos.find((candidate) => candidate.repoId === repo.repoId)
      return next && (next.repoPath !== repo.repoPath || next.projectPath !== repo.projectPath)
        ? [repo.repoId]
        : []
    })

    return {
      command: 'project.rebind',
      summary:
        changedRepoIds.length === 0
          ? `Project ${input.projectId} Repo bindings are already current.`
          : `Rebind ${changedRepoIds.length} Repo binding${changedRepoIds.length === 1 ? '' : 's'} in ${input.projectId}.`,
      effects:
        changedRepoIds.length === 0
          ? ['validate the complete Repo binding set']
          : [
              'validate the complete Repo binding set',
              'rebuild managed release projections when Git ownership changes',
              'publish project.yml before projects.yml',
              'reload the Project runtime after publication',
            ],
      warnings:
        changedRepoIds.length === 0
          ? []
          : [
              'Obsolete managed task worktrees are not migrated automatically and remain available as recovery evidence.',
            ],
      changedRepoIds,
      input: normalizedInput,
      before,
    }
  }

  return {
    planProjectRebind,

    async executeProjectRebind(input) {
      const plan = await planProjectRebind(input)
      const operationId = `OP-${crypto.randomUUID()}`
      const operationRoot = join(home.paths.operationsRoot, operationId)
      await mkdir(operationRoot, { recursive: true })
      await writeJson(join(operationRoot, 'request.json'), {
        operationId,
        command: plan.command,
        input,
      })
      await writeJson(join(operationRoot, 'plan.json'), { operationId, ...plan })
      await appendEvent(operationRoot, { phase: 'prepared', status: 'completed' })
      let project: LinkedProject
      try {
        if (plan.changedRepoIds.length === 0) project = plan.before
        else {
          const mutate = () => home.rebindRepos(plan.input)
          project = options.runProjectMutation
            ? await options.runProjectMutation(plan.input.projectId, mutate)
            : await mutate()
        }
      } catch (error) {
        const failure = {
          operationId,
          command: plan.command,
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        }
        await appendEvent(operationRoot, {
          phase: 'execute',
          status: 'failed',
          message: failure.message,
        })
        await writeJson(join(operationRoot, 'result.json'), failure)
        throw error
      }

      const followUpWarnings: string[] = []
      await recordFollowUp(
        () =>
          appendEvent(operationRoot, {
            phase: plan.changedRepoIds.length === 0 ? 'validated' : 'published',
            status: 'completed',
          }),
        'Rebind completed, but its publication phase could not be appended to the operation journal',
        followUpWarnings,
      )
      if (plan.changedRepoIds.length > 0) {
        await recordFollowUp(
          () => options.onProjectRebound?.(plan, project),
          'Rebind was published, but follow-up reconciliation setup failed',
          followUpWarnings,
          async (message) => {
            await appendEvent(operationRoot, {
              phase: 'follow_up',
              status: 'failed',
              message,
            })
          },
        )
      }
      const result: CommandResult = {
        operationId,
        command: plan.command,
        status: 'completed',
        project,
        recoveryPaths: plan.before.repos
          .filter((repo) => {
            const rebound = project.repos.find((candidate) => candidate.repoId === repo.repoId)
            return rebound && rebound.integrationRoot !== repo.integrationRoot
          })
          .map((repo) => dirname(repo.integrationRoot)),
        followUpWarnings,
      }
      await recordFollowUp(
        () => writeJson(join(operationRoot, 'result.json'), result),
        'Rebind completed, but its structured result could not be written to the operation journal',
        followUpWarnings,
      )
      return { plan, result }
    },
  }
}

async function recordFollowUp(
  operation: () => Promise<unknown> | unknown,
  failurePrefix: string,
  warnings: string[],
  onFailure?: (message: string) => Promise<void>,
) {
  try {
    await operation()
  } catch (error) {
    const message = `${failurePrefix}: ${error instanceof Error ? error.message : String(error)}`
    warnings.push(message)
    if (onFailure) {
      try {
        await onFailure(message)
      } catch {
        // The durable Project mutation has already completed; journal failure cannot roll it back.
      }
    }
  }
}

async function appendEvent(root: string, event: Record<string, unknown>) {
  const path = join(root, 'events.jsonl')
  const previous = await Bun.file(path)
    .text()
    .catch(() => '')
  await Bun.write(
    path,
    `${previous}${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
  )
}

async function writeJson(path: string, value: unknown) {
  const temporary = `${path}.tmp-${crypto.randomUUID()}`
  await Bun.write(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, path)
}
