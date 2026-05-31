import { startOrchestrator } from '../src/index.ts';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const shadowProjectDir = join(process.cwd(), 'tests', 'shadow-project');
const todoPath = join(shadowProjectDir, '.hopi', 'docs', 'goals', 'math-feature', 'todo.yml');

console.log('Starting orchestrator in real LLM mode on shadow project...');
console.log(`Watching: ${shadowProjectDir}`);

const scheduler = startOrchestrator({
  rootDir: shadowProjectDir,
  testMode: false // Force real LLM usage
});

// Since chokidar might miss the pre-existing file, force a reconcile
setTimeout(() => {
  console.log('Forcing manual initial reconcile...');
  scheduler.handleFileChange(todoPath);
}, 1000);

// We need a way to kill the script when the task is done
const checkInterval = setInterval(() => {
  if (existsSync(todoPath)) {
    const content = readFileSync(todoPath, 'utf8');
    if (content.includes('status: "in_review"')) {
      console.log('Task successfully moved to in_review!');
      console.log('Exiting gracefully.');
      scheduler.stop();
      clearInterval(checkInterval);
      process.exit(0);
    }
  }
}, 3000);

// Timeout after 3 minutes just in case
setTimeout(() => {
  console.log('Timeout reached. Exiting.');
  scheduler.stop();
  clearInterval(checkInterval);
  process.exit(1);
}, 60000);