import { isWorkTerminal } from '../domain/canonicalDocuments'
import type { PublicationCoordinator } from '../publication/publisher'
import { recordProjectSystemEvent } from '../runtime/projectSystemEvent'
import type { AssistantHomeStore } from '../storage/assistantHomeStore'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import { createGoalPackageStore } from '../storage/goalPackageStore'
import { createCommandRunner } from './commandRunner'

export function createProjectCommandRunner(options: {
  home: AssistantHomeStore
  publisher: PublicationCoordinator
  workspace: AssistantWorkspaceStore
  runProjectMutation?: <T>(projectId: string, operation: () => Promise<T>) => Promise<T>
}) {
  return createCommandRunner(options.home, {
    runProjectMutation: options.runProjectMutation,
    onProjectRebound: async (plan, rebound) => {
      if (plan.changedRepoIds.length === 0) return
      const store = createGoalPackageStore(
        rebound.integrationRoot,
        rebound.projectId,
        options.publisher,
        rebound.projectPath,
      )
      const packages = await store.readReconciliationSnapshot()
      const affectedWorks = [...packages.values()].flatMap((goalPackage) =>
        [...goalPackage.works.values()]
          .filter((work) => !isWorkTerminal(work.attributes))
          .map((work) => work.attributes.id),
      )
      if (affectedWorks.length === 0) return
      await recordProjectSystemEvent(options.workspace, {
        projectId: plan.input.projectId,
        summary: 'Project Repo bindings changed while nonterminal Work exists.',
        details: [
          `Affected Work: ${affectedWorks.join(', ')}.`,
          'Obsolete managed worktrees remain in the Rebind operation journal as recovery evidence.',
        ],
      })
    },
  })
}
