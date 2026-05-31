import simpleGit, { type SimpleGit } from 'simple-git';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Manages isolated Git worktrees for agent execution.
 * Ensures that agents operate on temporary branches without dirtying the main repo.
 */
export class WorktreeManager {
  private git: SimpleGit;
  private rootDir: string;
  private worktreeBaseDir: string;

  constructor(rootDir: string = process.cwd()) {
    this.rootDir = rootDir;
    this.git = simpleGit(this.rootDir);

    // Per the design, ephemeral state stays out of the repo in the global hopi dir.
    // However, for git worktrees, they technically need to be tied to a repo.
    // We will place them in .hopi/worktrees/ inside the repo, but gitignore them.
    this.worktreeBaseDir = join(this.rootDir, '.hopi', 'worktrees');

    if (!existsSync(this.worktreeBaseDir)) {
      mkdirSync(this.worktreeBaseDir, { recursive: true });
    }
  }

  /**
   * Generates a deterministic worktree path for a specific task.
   */
  getWorktreePath(taskRef: string): string {
    // Sanitize taskRef to be a safe directory name
    const sanitizedRef = taskRef.replace(/[^a-zA-Z0-9-_]/g, '-');
    return join(this.worktreeBaseDir, `task-${sanitizedRef}`);
  }

  /**
   * Generates a branch name specific to a task.
   */
  getBranchName(taskRef: string): string {
    const sanitizedRef = taskRef.replace(/[^a-zA-Z0-9-_]/g, '-');
    return `hopi/task-${sanitizedRef}`;
  }

  /**
   * Creates an isolated worktree for a task.
   * If the branch already exists, it checks it out.
   * If not, it creates a new branch off the base branch.
   */
  async provisionWorktree(taskRef: string, baseBranch: string = 'main'): Promise<string> {
    const worktreePath = this.getWorktreePath(taskRef);
    const branchName = this.getBranchName(taskRef);

    // If worktree already exists on disk, assume it's ready
    if (existsSync(worktreePath)) {
      console.log(`[Worktree] Using existing worktree for ${taskRef} at ${worktreePath}`);
      return worktreePath;
    }

    try {
      // Check if branch already exists in local repo
      // Ensure the directory is actually a git repository
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) {
        // For testing environments, just return a dummy worktree path
        console.warn(`[Worktree] Root directory ${this.rootDir} is not a git repository. Skipping git worktree creation for ${taskRef}.`);
        if (!existsSync(worktreePath)) {
            mkdirSync(worktreePath, { recursive: true });
        }
        return worktreePath;
      }

      const branches = await this.git.branchLocal();
      const branchExists = branches.all.includes(branchName);

      if (branchExists) {
        // Create worktree from existing branch (resuming work)
        console.log(`[Worktree] Provisioning from existing branch ${branchName}`);
        await this.git.raw(['worktree', 'add', worktreePath, branchName]);
      } else {
        // Create worktree with a new branch off baseBranch
        console.log(`[Worktree] Provisioning new branch ${branchName} off ${baseBranch}`);
        await this.git.raw(['worktree', 'add', '-b', branchName, worktreePath, baseBranch]);
      }

      // Add a strict .claudeignore to the worktree to prevent agent from tampering with .hopi/docs
      const worktreeGit = simpleGit(worktreePath);
      // Wait, .claudeignore needs to be created inside the worktree
      const fs = await import('node:fs/promises');
      await fs.writeFile(join(worktreePath, '.claudeignore'), '.hopi/docs/**\n.hopi/skills/**\n');

      return worktreePath;
    } catch (error) {
      throw new Error(`Failed to provision worktree for ${taskRef}: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * The Merger agent's job under the hood.
   * Merges the task's worktree branch back into the target branch.
   */
  async mergeAndCleanup(taskRef: string, targetBranch: string = 'main'): Promise<{ success: boolean; message: string }> {
    const worktreePath = this.getWorktreePath(taskRef);
    const branchName = this.getBranchName(taskRef);

    try {
      // 1. Ensure we are on target branch in the main repo
      await this.git.checkout(targetBranch);

      // 2. Attempt the merge
      console.log(`[Worktree] Attempting to merge ${branchName} into ${targetBranch}`);

      try {
        await this.git.merge([branchName, '--no-ff']);
      } catch (mergeError) {
        // Merge conflict occurred
        // Abort the merge to keep main repo clean, return false so attempt budget increments
        await this.git.merge(['--abort']);
        return {
          success: false,
          message: `Merge conflict detected. Requires manual intervention or Merger agent repair. ${mergeError instanceof Error ? mergeError.message : ''}`
        };
      }

      // 3. Cleanup: Remove the worktree
      await this.cleanupWorktree(taskRef);

      // 4. Cleanup: Delete the branch now that it's merged
      await this.git.branch(['-d', branchName]);

      return { success: true, message: `Successfully merged and cleaned up task ${taskRef}` };
    } catch (error) {
      return { success: false, message: `Unexpected error during merge: ${error instanceof Error ? error.message : error}` };
    }
  }

  /**
   * Removes a worktree from disk safely.
   */
  async cleanupWorktree(taskRef: string): Promise<void> {
    const worktreePath = this.getWorktreePath(taskRef);

    if (existsSync(worktreePath)) {
      console.log(`[Worktree] Removing worktree at ${worktreePath}`);
      try {
        // Use force just in case there are untracked files
        await this.git.raw(['worktree', 'remove', '-f', worktreePath]);
      } catch (error) {
        // Fallback manual wipe if git fails
        console.warn(`[Worktree] Git worktree remove failed, forcing manual directory deletion.`);
        rmSync(worktreePath, { recursive: true, force: true });
        await this.git.raw(['worktree', 'prune']);
      }
    }
  }
}
