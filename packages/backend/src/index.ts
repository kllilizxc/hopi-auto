import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { GoalScheduler } from './scheduler/GoalScheduler.ts';
import { AgentDispatcher } from './agent/AgentDispatcher.ts';
import type { TaskItem } from './skills/kanban/yaml.ts';

const MAX_ATTEMPTS = 3;

/**
 * In-memory attempt tracker (in the real system, this is stored in the DB runtime overlay)
 */
const attemptTracker = new Map<string, number>();

function getAttempts(taskRef: string): number {
  return attemptTracker.get(taskRef) || 0;
}

function incrementAttempts(taskRef: string): number {
  const current = getAttempts(taskRef);
  attemptTracker.set(taskRef, current + 1);
  return current + 1;
}

function resetAttempts(taskRef: string) {
  attemptTracker.set(taskRef, 0);
}

/**
 * Helper to safely call the project-local todo.mjs script to mutate kanban state.
 * This ensures the Reconciler follows the exact same constraints as the Assistant.
 */
function updateKanbanStatus(goalKey: string, taskRef: string, status: string, reason?: string, testMode?: boolean, testRootDir?: string) {
  const scriptPath = join(process.cwd(), 'src', 'skills', 'kanban', 'todo.mjs');

  // In test mode, we must tell todo.mjs to use the test rootDir for its operations
  let cmd = `node ${scriptPath} move --goal ${goalKey} --ref ${taskRef} --status ${status}`;
  if (reason) {
    cmd += ` --reason "${reason.replace(/"/g, '\\"')}"`;
  }
  if (testRootDir) {
    // We pass an undocumented --rootDir flag to todo.mjs for testing (both in testMode and shadow mode)
    cmd += ` --rootDir "${testRootDir}"`;
  }

  try {
    // console.log(`[Lifecycle] Mutating kanban: ${taskRef} -> ${status}`);
    execSync(cmd);
    // console.log(`Result: ${result}`);
  } catch (error) {
    console.error(`[Lifecycle] Failed to update kanban for ${taskRef}:`, error);
  }
}

/**
 * Initializes the full HOPI multi-agent orchestrator.
 */
export function startOrchestrator(options?: { testMode?: boolean, rootDir?: string }) {
  const scheduler = new GoalScheduler({ rootDir: options?.rootDir });
  const dispatcher = new AgentDispatcher(options?.rootDir);

  // Start watching the boards
  scheduler.start();

  // --- 1. GENERATOR / PLANNER PIPELINE ---
  scheduler.on('dispatch_generator', async ({ goalKey, task }: { goalKey: string, task: TaskItem }) => {
    // If it's a planner task, use the planner role, otherwise generator
    const role = task.title.toLowerCase().includes('plan') ? 'planner' : 'generator';

    // Mark as in_progress so scheduler doesn't dispatch again
    updateKanbanStatus(goalKey, task.ref, 'in_progress', undefined, options?.testMode, options?.rootDir);

    const success = await dispatcher.dispatch({ goalKey, task, role, testMode: options?.testMode, testBehavior: (task as any).testBehavior });

    if (success) {
      // Done writing code, move to review
      updateKanbanStatus(goalKey, task.ref, 'in_review', undefined, options?.testMode, options?.rootDir);
    } else {
      // Generator crashed or exited non-zero
      const attempts = incrementAttempts(task.ref);
      if (attempts >= MAX_ATTEMPTS) {
        updateKanbanStatus(goalKey, task.ref, 'blocked', 'intervention_needed: Generator crashed repeatedly', options?.testMode, options?.rootDir);
      } else {
        updateKanbanStatus(goalKey, task.ref, 'planned', 'retry: Generator crashed', options?.testMode, options?.rootDir);
      }
    }
  });

  // --- 2. REVIEWER PIPELINE ---
  scheduler.on('dispatch_reviewer', async ({ goalKey, task }: { goalKey: string, task: TaskItem }) => {
    // We don't mark 'in_progress' for reviewers to keep kanban clean, but we could add a transient lock
    const success = await dispatcher.dispatch({ goalKey, task, role: 'reviewer', testMode: options?.testMode, testBehavior: (task as any).testBehavior });

    if (success) {
      // Reviewer accepted!
      resetAttempts(task.ref); // Clear budget for the merge phase
      updateKanbanStatus(goalKey, task.ref, 'merging', undefined, options?.testMode, options?.rootDir);
    } else {
      // Reviewer rejected the code
      const attempts = incrementAttempts(task.ref);
      if (attempts >= MAX_ATTEMPTS) {
        updateKanbanStatus(goalKey, task.ref, 'blocked', 'intervention_needed: Rejected by reviewer 3 times', options?.testMode, options?.rootDir);
      } else {
        // Send back to planned so Generator picks it up again
        updateKanbanStatus(goalKey, task.ref, 'planned', 'retry: Reviewer rejected', options?.testMode, options?.rootDir);
      }
    }
  });

  // --- 3. MERGER PIPELINE ---
  scheduler.on('dispatch_merger', async ({ goalKey, task }: { goalKey: string, task: TaskItem }) => {
    // Merger is specialized: it doesn't spawn an LLM, it just merges the Git worktree.
    const result = await dispatcher.dispatchMerger(task.ref);

    if (result.success) {
      // Fully autonomous completion!
      resetAttempts(task.ref);
      updateKanbanStatus(goalKey, task.ref, 'done', 'Auto-merged successfully', options?.testMode, options?.rootDir);
    } else {
      // Merge conflict
      const attempts = incrementAttempts(task.ref);
      if (attempts >= MAX_ATTEMPTS) {
        updateKanbanStatus(goalKey, task.ref, 'blocked', 'merge_conflict: Unresolvable conflicts', options?.testMode, options?.rootDir);
      } else {
        // Try again (maybe target branch updated) or wait for intervention
        updateKanbanStatus(goalKey, task.ref, 'blocked', 'merge_conflict', options?.testMode, options?.rootDir);
      }
    }
  });

  // Start watching the boards - ALREADY STARTED ABOVE
  // scheduler.start();
  return scheduler;
}
