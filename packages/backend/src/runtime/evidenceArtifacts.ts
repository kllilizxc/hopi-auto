import { realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { resolveProjectPath } from '../domain/projectPath'
import { parsePortableArtifactReference } from './runArtifacts'
import { runStoragePath } from './runPaths'

export interface EvidenceArtifactProject {
  projectRoot: string
  sourceRoot?: string
  repos?: readonly {
    integrationRoot: string
    projectPath: string
  }[]
}

export interface ResolvedEvidenceArtifact {
  path: string
  fileName: string
  kind: 'file' | 'directory'
}

export class EvidenceArtifactResolutionError extends Error {
  constructor(
    readonly code: 'missing' | 'ambiguous' | 'invalid',
    message: string,
  ) {
    super(message)
  }
}

export function evidenceArtifactUrl(input: {
  projectId: string
  goalId: string
  evidenceId: string
  artifactIndex: number
}) {
  return [
    '/api/projects',
    encodeURIComponent(input.projectId),
    'goals',
    encodeURIComponent(input.goalId),
    'evidence',
    encodeURIComponent(input.evidenceId),
    'artifacts',
    String(input.artifactIndex),
  ].join('/')
}

export async function resolveEvidenceArtifact(input: {
  homeRoot: string
  project: EvidenceArtifactProject
  reference: string
}): Promise<ResolvedEvidenceArtifact> {
  const portable = parsePortableArtifactReference(input.reference)
  if (portable?.runId) {
    const path = join(
      runStoragePath(input.homeRoot, portable.runId),
      'artifacts',
      ...portable.artifactPath.split('/'),
    )
    const kind = await artifactEntryKind(path)
    if (!kind) {
      throw new EvidenceArtifactResolutionError(
        'missing',
        `Evidence artifact is missing: ${input.reference}`,
      )
    }
    return { path, fileName: basename(path), kind }
  }
  if (portable || !isSafeProjectRelativePath(input.reference)) {
    throw new EvidenceArtifactResolutionError(
      'invalid',
      `Evidence artifact reference is not portable: ${input.reference}`,
    )
  }

  const candidates = await uniqueExistingProjectEntries(input.project, input.reference)
  if (candidates.length === 0) {
    throw new EvidenceArtifactResolutionError(
      'missing',
      `Project artifact is missing: ${input.reference}`,
    )
  }
  if (candidates.length > 1) {
    throw new EvidenceArtifactResolutionError(
      'ambiguous',
      `Project artifact resolves in multiple Repos: ${input.reference}`,
    )
  }
  const path = candidates[0]
  if (!path) throw new EvidenceArtifactResolutionError('missing', input.reference)
  const kind = await artifactEntryKind(path)
  if (!kind) throw new EvidenceArtifactResolutionError('missing', input.reference)
  return { path, fileName: basename(path), kind }
}

export function inlineArtifactMediaType(fileName: string) {
  const extension = fileName.toLowerCase().split('.').at(-1)
  switch (extension) {
    case 'apng':
      return 'image/apng'
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    case 'pdf':
      return 'application/pdf'
    case 'json':
      return 'application/json; charset=utf-8'
    case 'csv':
      return 'text/csv; charset=utf-8'
    case 'mp4':
      return 'video/mp4'
    case 'webm':
      return 'video/webm'
    case 'mp3':
      return 'audio/mpeg'
    case 'wav':
      return 'audio/wav'
    default:
      // Markdown, HTML, logs, and unknown source files open as inert text.
      return 'text/plain; charset=utf-8'
  }
}

async function uniqueExistingProjectEntries(
  project: EvidenceArtifactProject,
  artifactPath: string,
) {
  const roots = project.repos?.length
    ? project.repos.map((repo) => resolveProjectPath(repo.integrationRoot, repo.projectPath))
    : [project.sourceRoot ?? project.projectRoot]
  const candidates = await Promise.all(
    roots.map((root) => containedExistingEntry(root, artifactPath)),
  )
  return [...new Set(candidates.filter((path): path is string => path !== null))]
}

async function containedExistingEntry(root: string, artifactPath: string) {
  const absoluteRoot = resolve(root)
  const candidate = resolve(absoluteRoot, artifactPath)
  const lexicalRelative = relative(absoluteRoot, candidate)
  if (
    !lexicalRelative ||
    lexicalRelative === '..' ||
    lexicalRelative.startsWith(`..${sep}`) ||
    isAbsolute(lexicalRelative)
  ) {
    return null
  }
  if (!(await artifactEntryKind(candidate))) return null
  const [realRoot, realCandidate] = await Promise.all([realpath(absoluteRoot), realpath(candidate)])
  const realRelative = relative(realRoot, realCandidate)
  if (
    !realRelative ||
    realRelative === '..' ||
    realRelative.startsWith(`..${sep}`) ||
    isAbsolute(realRelative)
  ) {
    return null
  }
  return realCandidate
}

function isSafeProjectRelativePath(path: string) {
  if (!path || isAbsolute(path) || path.includes('\\')) return false
  const normalized = posix.normalize(path)
  return (
    normalized === path &&
    normalized !== '.' &&
    normalized !== '..' &&
    !normalized.startsWith('../')
  )
}

async function artifactEntryKind(path: string): Promise<'file' | 'directory' | null> {
  const metadata = await stat(path).catch(() => null)
  if (metadata?.isFile()) return 'file'
  if (metadata?.isDirectory()) return 'directory'
  return null
}
