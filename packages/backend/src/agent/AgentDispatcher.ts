import { execa } from 'execa';
import { join } from 'node:path';
import { existsSync, mkdirSync, createWriteStream, readFileSync } from 'node:fs';
import { stringify } from 'ndjson';
import { WorktreeManager } from '../worktree/WorktreeManager.js';
import type { TaskItem } from '../skills/kanban/yaml.js';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';

interface AgentOptions {
  goalKey: string;
  task: TaskItem;
  role: 'planner' | 'generator' | 'reviewer' | 'merger';
  rootDir?: string;
  testMode?: boolean; // If true, use mock agent
  testBehavior?: string; // Behavior to pass to mock agent
}

export class AgentDispatcher {
  private worktreeMgr: WorktreeManager;
  private rootDir: string;
  private globalHopiDir: string;

  constructor(rootDir: string = process.cwd()) {
    this.rootDir = rootDir;
    this.worktreeMgr = new WorktreeManager(this.rootDir);

    // We need a stable project identifier to isolate logs in ~/.hopi/projects/
    // A quick way is hashing the rootDir path
    const projectHash = Buffer.from(this.rootDir).toString('base64').substring(0, 12);
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
    this.globalHopiDir = join(homeDir, '.hopi', 'projects', projectHash);

    if (!existsSync(this.globalHopiDir)) {
      mkdirSync(this.globalHopiDir, { recursive: true });
    }
  }

  /**
   * Generates the strict system prompt overlay.
   */
  private buildContextPrompt(goalKey: string, task: TaskItem, role: string): string {
    let goalContext = 'Goal Context Missing';
    const goalMdPath = join(this.rootDir, '.hopi', 'docs', 'goals', goalKey, 'goal.md');
    const designMdPath = join(this.rootDir, '.hopi', 'docs', 'goals', goalKey, 'design.md');

    try {
      if (existsSync(goalMdPath)) goalContext = readFileSync(goalMdPath, 'utf-8');
      let designContext = '';
      if (existsSync(designMdPath)) designContext = readFileSync(designMdPath, 'utf-8');

      goalContext += '\n\nDesign Context:\n' + designContext;
    } catch (e) {
      // Ignore missing files gracefully
    }

    // Strict instructions aligned with canonical HOPI design
    const boundaries = `
CRITICAL DIRECTIVES:
1. You are running autonomously to complete a specific task. Do not stop to ask the user questions unless absolutely blocked.
2. DO NOT attempt to manually edit files in .hopi/docs/.
3. When you have satisfied the Acceptance Criteria, simply exit the process successfully (exit code 0).
`;

    return `Role: ${role.toUpperCase()}
Task: ${task.title}
Status: ${task.status}

Acceptance Criteria / Body:
${task.body}

${boundaries}

---
Goal Context:
${goalContext}
`;
  }

  /**
   * Spawns the agent as a child process and streams logs out-of-repo.
   */
  public async dispatch(options: AgentOptions): Promise<boolean> {
    const { goalKey, task, role } = options;
    const sessionId = randomUUID();

    console.log(`[Dispatcher] Spawning ${role} agent for task ${task.ref} (Session: ${sessionId})`);

    try {
      // 1. Setup global JSONL logging
      const sessionsDir = join(this.globalHopiDir, 'sessions');
      if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });

      const logPath = join(sessionsDir, `${sessionId}.jsonl`);
      const logStream = createWriteStream(logPath, { flags: 'a' });
      const serializeStream = stringify();
      serializeStream.pipe(logStream);

      // Write session start metadata
      serializeStream.write({ event: 'session_start', sessionId, taskRef: task.ref, role, timestamp: new Date().toISOString() });

      // 2. Provision Isolated Worktree
      const worktreePath = await this.worktreeMgr.provisionWorktree(task.ref);
      serializeStream.write({ event: 'worktree_ready', path: worktreePath, timestamp: new Date().toISOString() });

      // 3. Build Prompt Context
      const prompt = this.buildContextPrompt(goalKey, task, role);

      // 4. Spawn Claude Code (Using execa for safe subprocess management)
      serializeStream.write({ event: 'agent_spawning', timestamp: new Date().toISOString() });

      let child;

      if (options.testMode) {
        // console.log(`[Dispatcher] Spawning mock agent for ${task.ref} with behavior: ${options.testBehavior}`);
        const mockAgentPath = join(process.cwd(), 'src', 'test-utils', 'mock-agent.ts');
        child = execa('bun', ['run', mockAgentPath, '--behavior', options.testBehavior || 'success-fast', '--taskRef', task.ref], {
          cwd: worktreePath,
          reject: false,
        });
      } else {
        // write prompt to a temporary file
        const promptFile = join(worktreePath, '.hopi-prompt.txt');
        writeFileSync(promptFile, prompt);

        child = execa('opencode', ['run', '--prompt', prompt], {
          cwd: worktreePath,
          env: {
            ...process.env,
            // Force non-interactive mode to prevent blocking on UI prompts
            OPENCODE_INTERACTIVE: '0',
          },
          reject: false, // Don't throw on non-zero exit, we handle it
        });
      }

      // Stream stdout to JSONL
      child.stdout?.on('data', (chunk) => {
        serializeStream.write({ event: 'stdout', payload: chunk.toString(), timestamp: new Date().toISOString() });
      });

      // Stream stderr to JSONL
      child.stderr?.on('data', (chunk) => {
        serializeStream.write({ event: 'stderr', payload: chunk.toString(), timestamp: new Date().toISOString() });
      });

      // 5. Wait for agent to finish
      const result = await child;

      serializeStream.write({
        event: 'session_end',
        exitCode: result.exitCode,
        timestamp: new Date().toISOString()
      });
      serializeStream.end();

      // 6. Return success status
      return result.exitCode === 0;

    } catch (err) {
      console.error(`[Dispatcher] Fatal error dispatching task ${task.ref}:`, err);
      return false;
    }
  }

  /**
   * Special dispatch for the Merger role which doesn't spawn an LLM,
   * but uses git directly via WorktreeManager.
   */
  public async dispatchMerger(taskRef: string): Promise<{success: boolean, message: string}> {
    return await this.worktreeMgr.mergeAndCleanup(taskRef);
  }
}
