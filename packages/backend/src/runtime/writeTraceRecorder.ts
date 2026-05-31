import { createHash } from 'node:crypto'
import { readdir, readlink } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { AgentRole } from '../agent/AgentRunner'
import type { GoalWriteTraceEntry, WriteTraceChange } from './writeTrace'
import { type WriteTraceStore, createWriteTraceStore } from './writeTraceStore'

interface SnapshotEntry {
  path: string
  size: number
  hash: string
}

export type WorkspaceSnapshot = Map<string, SnapshotEntry>

export interface RecordProcessExecutionOptions {
  goalKey: string
  runId: string
  stepId: string
  taskRef: string
  role: AgentRole
  cwd: string
  command: string[]
  exitCode: number
  before: WorkspaceSnapshot
  after: WorkspaceSnapshot
}

export interface WriteTraceRecorder {
  snapshot(cwd: string): Promise<WorkspaceSnapshot>
  recordProcessExecution(
    options: RecordProcessExecutionOptions,
  ): Promise<GoalWriteTraceEntry | null>
}

export function createWriteTraceRecorder(
  rootDir = process.cwd(),
  store: WriteTraceStore = createWriteTraceStore(rootDir),
): WriteTraceRecorder {
  return {
    async snapshot(cwd) {
      const snapshot = new Map<string, SnapshotEntry>()
      await collectSnapshotEntries(cwd, cwd, snapshot)
      return snapshot
    },
    async recordProcessExecution(options) {
      const changes = diffSnapshots(options.before, options.after)
      if (changes.length === 0) {
        return null
      }

      return store.appendEntry(options.goalKey, {
        runId: options.runId,
        stepId: options.stepId,
        taskRef: options.taskRef,
        role: options.role,
        agent: 'process_runner',
        cwd: options.cwd,
        toolName: 'process',
        callId: options.stepId,
        targetPaths: changes.map((change) => change.path),
        changes,
        argumentSummary: summarizeCommand(options.command),
        resultSummary: summarizeExit(options.exitCode, changes.length),
      })
    },
  }
}

async function collectSnapshotEntries(
  rootDir: string,
  currentDir: string,
  snapshot: WorkspaceSnapshot,
) {
  const entries = await readdir(currentDir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.name === '.git') {
      continue
    }

    const absolutePath = join(currentDir, entry.name)
    const relativePath = normalizeRelativePath(relative(rootDir, absolutePath))

    if (entry.isDirectory()) {
      await collectSnapshotEntries(rootDir, absolutePath, snapshot)
      continue
    }

    if (entry.isSymbolicLink()) {
      const target = await readlink(absolutePath)
      snapshot.set(relativePath, {
        path: relativePath,
        size: target.length,
        hash: hashText(target),
      })
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const file = Bun.file(absolutePath)
    const bytes = await file.bytes()
    snapshot.set(relativePath, {
      path: relativePath,
      size: bytes.byteLength,
      hash: hashBytes(bytes),
    })
  }
}

function diffSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot): WriteTraceChange[] {
  const paths = new Set([...before.keys(), ...after.keys()])
  const changes: WriteTraceChange[] = []

  for (const path of [...paths].sort()) {
    const previous = before.get(path)
    const next = after.get(path)

    if (!previous && next) {
      changes.push({ path, kind: 'added' })
      continue
    }

    if (previous && !next) {
      changes.push({ path, kind: 'deleted' })
      continue
    }

    if (previous && next && (previous.size !== next.size || previous.hash !== next.hash)) {
      changes.push({ path, kind: 'modified' })
    }
  }

  return changes
}

function summarizeCommand(command: string[]) {
  return command.join(' ').slice(0, 500)
}

function summarizeExit(exitCode: number, changeCount: number) {
  const fileLabel = changeCount === 1 ? 'changed file' : 'changed files'
  return `exit ${exitCode} (${changeCount} ${fileLabel})`
}

function hashBytes(bytes: Uint8Array) {
  return createHash('sha1').update(bytes).digest('hex')
}

function hashText(value: string) {
  return createHash('sha1').update(value).digest('hex')
}

function normalizeRelativePath(path: string) {
  return path.split(sep).join('/')
}
