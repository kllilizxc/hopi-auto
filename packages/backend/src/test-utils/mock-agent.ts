/**
 * mock-agent.ts
 *
 * A fake agent executable used for integration testing the GoalScheduler.
 * It simulates an LLM without the cost, latency, or non-determinism.
 *
 * Usage: bun run src/test-utils/mock-agent.ts --behavior <behavior> [options]
 */

import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
let behavior = 'success-fast';
let taskRef = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--behavior') behavior = args[i + 1];
  if (args[i] === '--taskRef') taskRef = args[i + 1];
}

console.log(`[MockAgent] Starting with behavior: ${behavior}`);

async function run() {
  switch (behavior) {
    case 'success-fast':
      console.log('[MockAgent] Task completed immediately.');
      process.exit(0);

    case 'success-slow':
      console.log('[MockAgent] Sleeping for 2 seconds...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log('[MockAgent] Task completed slowly.');
      process.exit(0);

    case 'crash':
      console.error('[MockAgent] Agent encountered a fatal error!');
      process.exit(1);

    case 'infinite-loop':
      console.log('[MockAgent] I am stuck in an infinite loop...');
      // Never resolve
      await new Promise(() => {});
      break;

    case 'mutate-board':
      // Specifically used to test out-of-band state changes
      // In a real test, we would write to the specific todo.yml
      console.log('[MockAgent] Mutating board... (simulated)');
      process.exit(0);

    default:
      console.error(`[MockAgent] Unknown behavior: ${behavior}`);
      process.exit(1);
  }
}

run();