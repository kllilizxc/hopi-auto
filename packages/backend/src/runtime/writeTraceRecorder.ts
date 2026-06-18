import { createHash } from 'node:crypto'
import { readdir, readlink } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
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
  snapshot(cwd: string, options?: SnapshotOptions): Promise<WorkspaceSnapshot>
  recordProcessExecution(
    options: RecordProcessExecutionOptions,
  ): Promise<GoalWriteTraceEntry | null>
}

interface SnapshotOptions {
  followHopiSymlink?: boolean
}

export function createWriteTraceRecorder(
  rootDir = process.cwd(),
  store: WriteTraceStore = createWriteTraceStore(rootDir),
): WriteTraceRecorder {
  return {
    async snapshot(cwd, options = {}) {
      const snapshot = new Map<string, SnapshotEntry>()
      await collectSnapshotEntries(cwd, cwd, snapshot, '', {
        followHopiSymlink: options.followHopiSymlink ?? true,
      })
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
  pathPrefix = '',
  options: SnapshotOptions = {},
) {
  const entries = await readdir(currentDir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.name === '.git') {
      continue
    }

    const absolutePath = join(currentDir, entry.name)
    const relativePath = normalizeRelativePath(
      pathPrefix.length > 0 ? joinSnapshotPath(pathPrefix, entry.name) : relative(rootDir, absolutePath),
    )

    if (entry.isDirectory()) {
      await collectSnapshotEntries(rootDir, absolutePath, snapshot, relativePath, options)
      continue
    }

    if (entry.isSymbolicLink()) {
      if (entry.name === '.hopi' && options.followHopiSymlink) {
        await collectHopiSymlinkEntries(rootDir, absolutePath, snapshot, '.hopi')
        continue
      }

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

async function collectHopiSymlinkEntries(
  rootDir: string,
  linkPath: string,
  snapshot: WorkspaceSnapshot,
  prefix: string,
) {
  const targetPath = resolve(dirname(linkPath), await readlink(linkPath))
  const docsDir = join(targetPath, 'docs')
  await collectOptionalPath(rootDir, docsDir, snapshot, joinSnapshotPath(prefix, 'docs'))
  await collectOptionalFile(rootDir, join(targetPath, 'preference.md'), snapshot, joinSnapshotPath(prefix, 'preference.md'))
}

async function collectOptionalPath(
  rootDir: string,
  absolutePath: string,
  snapshot: WorkspaceSnapshot,
  prefix: string,
) {
  try {
    await readdir(absolutePath)
  } catch {
    return
  }
  await collectSnapshotEntries(rootDir, absolutePath, snapshot, prefix)
}

async function collectOptionalFile(
  _rootDir: string,
  absolutePath: string,
  snapshot: WorkspaceSnapshot,
  path: string,
) {
  const file = Bun.file(absolutePath)
  if (!(await file.exists())) {
    return
  }
  const bytes = await file.bytes()
  snapshot.set(normalizeRelativePath(path), {
    path: normalizeRelativePath(path),
    size: bytes.byteLength,
    hash: hashBytes(bytes),
  })
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

function joinSnapshotPath(prefix: string, entryName: string) {
  return prefix.length > 0 ? `${prefix}/${entryName}` : entryName
}
