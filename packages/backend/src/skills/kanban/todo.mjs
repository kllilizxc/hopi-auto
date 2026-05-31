import { readYaml, stringifyYaml, STATUSES } from './yaml.ts';
import lockfile from 'proper-lockfile';
import { renameSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { randomUUID } from 'node:crypto';

// Usage: node todo.mjs <action> --goal <goalKey> [options]
const args = process.argv.slice(2);

function parseArgs() {
  const action = args[0];
  const params = {};
  for (let i = 1; i < args.length; i += 2) {
    if (args[i].startsWith('--')) {
      params[args[i].slice(2)] = args[i + 1];
    }
  }
  return { action, params };
}

/**
 * Perform a safe, atomic mutation of todo.yml and events.jsonl
 */
async function atomicMutate(goalKey, mutateFn, eventContext, rootDir) {
  // In our new architecture, state is in the repo, e.g., .hopi/docs/goals/<goalKey>/
  const baseDir = rootDir || join(process.cwd(), '..', '..');
  const docsDir = join(baseDir, '.hopi', 'docs', 'goals', goalKey);
  const todoPath = join(docsDir, 'todo.yml');
  const eventsPath = join(docsDir, 'events.jsonl');

  if (!existsSync(docsDir)) {
    mkdirSync(docsDir, { recursive: true });
  }

  // If todo doesn't exist, create a skeleton so lockfile works
  if (!existsSync(todoPath)) {
    writeFileSync(todoPath, stringifyYaml({
      version: 1,
      goal: { goalKey, title: `Goal: ${goalKey}` },
      items: []
    }));
  }

  // 1. Acquire Lock with exponential backoff (prevent Reconciler/Assistant race conditions)
  let release;
  try {
    release = await lockfile.lock(todoPath, {
      retries: {
        retries: 5,
        factor: 2,
        minTimeout: 100,
        maxTimeout: 2000,
      }
    });
  } catch (err) {
    console.error(`[ERROR] Failed to acquire lock on ${todoPath}. Another agent or process is mutating the board. Try again later.`);
    process.exit(1);
  }

  try {
    // 2. Read and parse canonical state
    const board = readYaml(todoPath);
    const originalItemsCount = board.items.length;

    // 3. Mutate (in memory)
    mutateFn(board);

    // 4. Atomic Write
    const newYamlContent = stringifyYaml(board);
    const tmpPath = `${todoPath}.tmp.${Date.now()}`;
    writeFileSync(tmpPath, newYamlContent);
    renameSync(tmpPath, todoPath);

    // 5. Append Trace Event
    const event = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      writer: process.env.HOPI_WRITER_ID || 'assistant', // Could be 'reconciler' or 'assistant'
      action: eventContext.action,
      entity: eventContext.entity,
      reason: eventContext.reason || 'Workflow mutation',
    };
    writeFileSync(eventsPath, JSON.stringify(event) + '\n', { flag: 'a' });

    console.log(JSON.stringify({ success: true, message: `Successfully executed ${eventContext.action} on ${eventContext.entity}` }));

  } catch (err) {
    console.error(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  } finally {
    // 6. Release Lock
    await release();
  }
}

async function main() {
  const { action, params } = parseArgs();

  if (!action || !params.goal) {
    console.error('Usage: node todo.mjs <action> --goal <goalKey> [options]');
    process.exit(1);
  }

  switch (action) {
    case 'list': {
      // List is read-only, no lock needed
      const baseDir = params.rootDir || join(process.cwd(), '..', '..');
      const todoPath = join(baseDir, '.hopi', 'docs', 'goals', params.goal, 'todo.yml');
      if (existsSync(todoPath)) {
        const board = readYaml(todoPath);
        console.log(JSON.stringify({ success: true, items: board.items }));
      } else {
        console.log(JSON.stringify({ success: true, items: [] }));
      }
      break;
    }

    case 'add': {
      if (!params.ref || !params.title || !params.status) {
        console.error('Missing required args: --ref, --title, --status');
        process.exit(1);
      }
      await atomicMutate(params.goal, (board) => {
        board.items.push({
          ref: params.ref,
          title: params.title,
          status: params.status,
          body: params.body || 'Acceptance Criteria: TBD', // Default fallback
          dependencyTaskList: []
        });
      }, { action: 'task_added', entity: params.ref }, params.rootDir);
      break;
    }

    case 'move': {
      if (!params.ref || !params.status) {
        console.error('Missing required args: --ref, --status');
        process.exit(1);
      }
      if (!STATUSES.includes(params.status)) {
        console.error(`Invalid status. Must be one of: ${STATUSES.join(', ')}`);
        process.exit(1);
      }
      await atomicMutate(params.goal, (board) => {
        const task = board.items.find(i => i.ref === params.ref);
        if (!task) throw new Error(`Task ${params.ref} not found`);
        task.status = params.status;
      }, { action: 'task_moved', entity: params.ref, reason: params.reason }, params.rootDir);
      break;
    }

    case 'update': {
      if (!params.ref) {
        console.error('Missing required args: --ref');
        process.exit(1);
      }
      await atomicMutate(params.goal, (board) => {
        const task = board.items.find(i => i.ref === params.ref);
        if (!task) throw new Error(`Task ${params.ref} not found`);
        if (params.title) task.title = params.title;
        if (params.body) task.body = params.body;
      }, { action: 'task_updated', entity: params.ref }, params.rootDir);
      break;
    }

    default:
      console.error(`Unknown action: ${action}`);
      process.exit(1);
  }
}

main();
