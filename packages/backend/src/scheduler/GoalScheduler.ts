import chokidar from 'chokidar';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { validateBoard, type TodoBoard, type TaskItem } from '../skills/kanban/yaml.js';

// Configuration interface for the scheduler
export interface SchedulerOptions {
  rootDir?: string;
  reconcileIntervalMs?: number;
}

export class GoalScheduler extends EventEmitter {
  private rootDir: string;
  private reconcileIntervalMs: number;
  private watcher: chokidar.FSWatcher | null = null;
  private reconcileTimer: Timer | null = null;

  // In-memory cache of the board to detect diffs
  private boardCache: Map<string, TodoBoard> = new Map();

  constructor(options: SchedulerOptions = {}) {
    super();
    this.rootDir = options.rootDir || process.cwd();
    this.reconcileIntervalMs = options.reconcileIntervalMs || 5000; // Tick every 5s as fallback
  }

  /**
   * Starts the watcher and the reconcile loop.
   */
  public start() {
    const goalsPattern = join(this.rootDir, '.hopi', 'docs', 'goals', '**', 'todo.yml');
    // console.log(`[Scheduler] Starting watcher on ${goalsPattern}`);

    // Pre-populate cache synchronously to avoid missing files before watcher is ready
    try {
      // In a real app we'd glob, but for tests we can just trigger it if we know the path
      // Actually we'll let tests call handleFileChange directly or reconcileAll after globbing
      const fastGlob = new Bun.Glob('.hopi/docs/goals/**/todo.yml');
      for (const file of fastGlob.scanSync(this.rootDir)) {
        this.handleFileChange(join(this.rootDir, file));
      }
    } catch (e) { }

    this.watcher = chokidar.watch(goalsPattern, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 100, // Faster stability threshold for tests
        pollInterval: 50
      }
    });

    this.watcher
      .on('add', (path) => this.handleFileChange(path))
      .on('change', (path) => this.handleFileChange(path))
      .on('unlink', (path) => {
        // Board deleted
        this.boardCache.delete(path);
      });

    // Deterministic fallback loop (in case watcher misses an event)
    this.reconcileTimer = setInterval(() => {
      this.reconcileAll();
    }, this.reconcileIntervalMs);
  }

  /**
   * Stops the scheduler cleanly.
   */
  public stop() {
    // console.log('[Scheduler] Stopping...');
    if (this.watcher) {
      this.watcher.close();
    }
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
    }
    this.removeAllListeners();
    this.boardCache.clear();
  }

  /**
   * Reads and parses a board safely, trapping validation errors.
   */
  private readSafe(path: string): TodoBoard | null {
    try {
      if (!existsSync(path)) return null;
      const content = readFileSync(path, 'utf-8');
      const raw = parse(content);
      return validateBoard(raw); // From Phase 1
    } catch (err) {
      // Per design: Do NOT replace the last valid board with corrupt data.
      // Leave runtime sessions untouched and require user to fix.
      console.error(`[Scheduler] Board Parse Error on ${path}. Suspending automation for this goal. Error:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Fired when a todo.yml file changes on disk.
   */
  public handleFileChange(path: string) {
    const board = this.readSafe(path);
    if (!board) return; // Invalid, ignore

    this.boardCache.set(path, board);

    // Emit SSE event placeholder for Web UI to refetch
    this.emit('board_changed', { goalKey: board.goal.goalKey, path });

    // Trigger immediate reconcile for this specific board
    this.reconcileBoard(board);
  }

  /**
   * Runs the reconcile loop on all known boards.
   */
  public reconcileAll() {
    for (const board of this.boardCache.values()) {
      this.reconcileBoard(board);
    }
  }

  /**
   * The core deterministic control plane logic.
   */
  private reconcileBoard(board: TodoBoard) {
    const goalKey = board.goal.goalKey;

    // Check Goal-level blockers (from goal.md or index.md, though simplified here)
    // If goal is blocked, we freeze new dispatches but let existing ones drain.

    for (const task of board.items) {
      this.evaluateTaskEligibility(goalKey, board, task);
    }
  }

  /**
   * Determines if a task can be transitioned and emits actions.
   */
  private evaluateTaskEligibility(goalKey: string, board: TodoBoard, task: TaskItem) {
    // 1. If blocked, do not touch.
    if (task.status === 'blocked') {
      return;
    }

    // 2. Candidate tasks remain dormant until Planner moves them.
    if (task.status === 'candidate') {
      return;
    }

    // 3. Resolve Dependencies.
    const isUnblocked = this.areDependenciesMet(board, task.dependencyTaskList);

    // 4. Dispatch based on current status
    if (task.status === 'planned' && isUnblocked) {
      // Small delay to allow file locks to release if this was triggered immediately after an update
      setTimeout(() => this.emit('dispatch_generator', { goalKey, task }), 50);
    }
    else if (task.status === 'in_progress') {
      // Generator is currently running. We just wait for it to finish.
      // If it crashed/failed, the Agent Wrapper will handle the attempt budget and move it.
    }
    else if (task.status === 'in_review') {
      setTimeout(() => this.emit('dispatch_reviewer', { goalKey, task }), 50);
    }
    else if (task.status === 'merging') {
      setTimeout(() => this.emit('dispatch_merger', { goalKey, task }), 50);
    }
  }

  private areDependenciesMet(board: TodoBoard, deps: string[]): boolean {
    if (!deps || deps.length === 0) return true;

    for (const depRef of deps) {
      const upstream = board.items.find(i => i.ref === depRef);
      if (!upstream) {
        // Technically validation prevents this, but be safe
        return false;
      }
      if (upstream.status !== 'done') {
        return false; // Upstream not done, so we are blocked
      }
    }
    return true;
  }
}
