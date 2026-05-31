import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { join } from 'node:path';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { startOrchestrator } from '../src/index.ts';
import { readYaml } from '../src/skills/kanban/yaml.ts';
import type { GoalScheduler } from '../src/scheduler/GoalScheduler.ts';

const TEST_DIR = join(process.cwd(), 'tests', 'fixtures', '.hopi', 'docs', 'goals', 'test-scheduler');
const TODO_PATH = join(TEST_DIR, 'todo.yml');

function setupBoard(items: any[]) {
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }
  const board = {
    version: 1,
    goal: { goalKey: 'test-scheduler', title: 'Test Goal' },
    items
  };
  writeFileSync(TODO_PATH, require('yaml').stringify(board));
}

function cleanup() {
  if (existsSync(join(process.cwd(), 'tests', 'fixtures'))) {
    rmSync(join(process.cwd(), 'tests', 'fixtures'), { recursive: true, force: true });
  }
}

describe('GoalScheduler and AgentDispatcher Integration', () => {
  let scheduler: GoalScheduler;

  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    if (scheduler) {
      scheduler.stop();
    }
    cleanup();
  });

  it('should transition a task from planned to in_review on fast success', async () => {
    setupBoard([
      { ref: 'T-1', title: 'Task 1', status: 'planned', body: 'Acceptance Criteria: Do it', dependencyTaskList: [], testBehavior: 'success-fast' }
    ]);

    // We start the orchestrator in testMode which uses mock-agent.ts
    // We also point the rootDir to our fixtures folder
    scheduler = startOrchestrator({ testMode: true, rootDir: join(process.cwd(), 'tests', 'fixtures') });
    scheduler.handleFileChange(TODO_PATH);

    // Wait for the dispatcher loop to finish
    await new Promise(r => setTimeout(r, 4000));

    const board = readYaml(TODO_PATH);
    const task = board.items.find(i => i.ref === 'T-1');
    expect(task).toBeDefined();
    // It should have moved from planned -> in_progress -> in_review because the mock agent exited 0
    expect(task?.status).toBe('in_review');
  }, 10000);

  it('should increment attempt count and stay planned if agent crashes', async () => {
    setupBoard([
      { ref: 'T-1', title: 'Task 1', status: 'planned', body: 'Acceptance Criteria: Do it', dependencyTaskList: [], testBehavior: 'crash' }
    ]);

    scheduler = startOrchestrator({ testMode: true, rootDir: join(process.cwd(), 'tests', 'fixtures') });
    scheduler.handleFileChange(TODO_PATH);

    // Ensure we trigger the initial reconcile
    await new Promise(r => setTimeout(r, 2000));

    const board = readYaml(TODO_PATH);
    const task = board.items.find(i => i.ref === 'T-1');
    // The generator crashes, so it should be sent back to planned to retry
    expect(task?.status).toBe('planned');
    // Note: Attempt tracking is currently in-memory in index.ts.
    // In a real DB we would assert the attempt count here.
  });

  it('should block task after 3 crashes', async () => {
    // First attempt
    setupBoard([
      { ref: 'T-1', title: 'Task 1', status: 'planned', body: 'Acceptance Criteria: Do it', dependencyTaskList: [], testBehavior: 'crash' }
    ]);

    scheduler = startOrchestrator({ testMode: true, rootDir: join(process.cwd(), 'tests', 'fixtures') });
    scheduler.handleFileChange(TODO_PATH); // loop 1

    await new Promise(r => setTimeout(r, 2000));
    scheduler.handleFileChange(TODO_PATH); // loop 2

    await new Promise(r => setTimeout(r, 2000));
    scheduler.handleFileChange(TODO_PATH); // loop 3

    await new Promise(r => setTimeout(r, 2000));

    const board = readYaml(TODO_PATH);
    const task = board.items.find(i => i.ref === 'T-1');

    // After 3 crashes, it should be blocked
    expect(task?.status).toBe('blocked');
  }, 10000); // increase test timeout
});