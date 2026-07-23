import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const PORTABLE_ARTIFACT_PATTERN = /^artifact:([A-Za-z0-9][A-Za-z0-9._-]*)\/(.+)$/
const LEGACY_ARTIFACT_PATTERN = /^artifact:([^/\s][^\s]*)$/

export interface PreservedRunArtifact {
  reference: string
  path: string
  source: string
  sizeBytes: number
}

export interface PreserveRunArtifactsResult {
  references: readonly string[]
  preserved: readonly PreservedRunArtifact[]
  replacements: ReadonlyMap<string, string>
  ignoredProposalPaths: readonly string[]
}

export class RunArtifactError extends Error {}

export async function preserveRunArtifacts(input: {
  runId: string
  runRoot: string
  artifacts: readonly string[]
  sourceRoots?: readonly string[]
  portableRoots?: readonly string[]
  proposalRoots?: readonly string[]
  legacyRunRoot?: string
  resultFile?: string
}): Promise<PreserveRunArtifactsResult> {
  assertStableId(input.runId)
  const runRoot = resolve(input.runRoot)
  const artifactRoot = join(runRoot, 'artifacts')
  const sourceRoots = [runRoot, ...(input.sourceRoots ?? []).map((path) => resolve(path))]
  const references: string[] = []
  const preserved: PreservedRunArtifact[] = []
  const replacements = new Map<string, string>()
  const preservedSources = new Map<string, string>()
  const ignoredProposalPaths: string[] = []

  for (const [index, artifact] of input.artifacts.entries()) {
    const portable = parsePortableArtifactReference(artifact)
    if (portable) {
      references.push(artifact)
      continue
    }
    if (await isProposalPath(artifact, input.proposalRoots)) {
      ignoredProposalPaths.push(artifact)
      continue
    }
    if (await isPortableProjectArtifact(artifact, runRoot, input.portableRoots)) {
      references.push(artifact)
      continue
    }

    const source = await resolveArtifactSource(artifact, sourceRoots, input.legacyRunRoot, runRoot)
    const existing = preservedSources.get(source)
    if (existing) {
      references.push(existing)
      replacements.set(artifact, existing)
      continue
    }

    const sourceStat = await stat(source).catch(() => null)
    if (!sourceStat?.isFile()) {
      throw new RunArtifactError(`Declared Run artifact is not a readable file: ${artifact}`)
    }

    const name = `${String(index + 1).padStart(3, '0')}-${safeArtifactName(basename(source))}`
    const relativePath = `artifacts/${name}`
    const destination = join(artifactRoot, name)
    await mkdir(artifactRoot, { recursive: true })
    if (resolve(source) !== resolve(destination)) {
      const temporary = `${destination}.tmp.${crypto.randomUUID()}`
      await copyFile(source, temporary)
      await rename(temporary, destination)
    }
    const reference = `artifact:${input.runId}/${name}`
    preservedSources.set(source, reference)
    replacements.set(artifact, reference)
    references.push(reference)
    preserved.push({
      reference,
      path: relativePath,
      source: artifact,
      sizeBytes: sourceStat.size,
    })
  }

  if (preserved.length > 0) {
    await Bun.write(
      join(runRoot, 'artifacts.json'),
      `${JSON.stringify({ version: 1, runId: input.runId, artifacts: preserved }, null, 2)}\n`,
    )
  }
  if (input.resultFile) await rewriteResultArtifacts(input.resultFile, references)
  return { references, preserved, replacements, ignoredProposalPaths }
}

export async function discoverRunArtifactPaths(root: string) {
  const absoluteRoot = resolve(root)
  const paths: string[] = []
  for await (const path of new Bun.Glob('**/*').scan({
    cwd: absoluteRoot,
    absolute: true,
    onlyFiles: true,
  })) {
    paths.push(path)
  }
  return paths.sort()
}

export async function cleanupRunScratch(runtimeScratchDir: string) {
  await rm(resolve(runtimeScratchDir), { recursive: true, force: true })
}

export function parsePortableArtifactReference(reference: string) {
  const match = PORTABLE_ARTIFACT_PATTERN.exec(reference)
  if (!match) {
    const legacy = LEGACY_ARTIFACT_PATTERN.exec(reference)
    return legacy?.[1] ? { runId: null, artifactPath: legacy[1] } : null
  }
  const runId = match[1]
  const artifactPath = match[2]
  if (
    !runId ||
    !artifactPath ||
    artifactPath.startsWith('/') ||
    artifactPath.includes('\\') ||
    artifactPath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    return null
  }
  return { runId, artifactPath }
}

async function resolveArtifactSource(
  artifact: string,
  sourceRoots: readonly string[],
  legacyRunRoot: string | undefined,
  runRoot: string,
) {
  const candidates: string[] = []
  if (isAbsolute(artifact)) {
    if (legacyRunRoot) {
      const legacyRelative = containedRelativePath(legacyRunRoot, artifact)
      if (legacyRelative !== null) candidates.push(join(runRoot, legacyRelative))
    }
    candidates.push(resolve(artifact))
  } else {
    for (const root of sourceRoots) candidates.push(resolve(root, artifact))
  }

  for (const candidate of new Set(candidates)) {
    const candidateStat = await stat(candidate).catch(() => null)
    if (candidateStat?.isFile()) return candidate
  }
  throw new RunArtifactError(`Declared Run artifact is missing: ${artifact}`)
}

async function isPortableProjectArtifact(
  artifact: string,
  runRoot: string,
  portableRoots: readonly string[] | undefined,
) {
  if (!isSafeRelativePath(artifact)) return false
  if ((await stat(resolve(runRoot, artifact)).catch(() => null))?.isFile()) return false
  for (const portableRoot of portableRoots ?? []) {
    if ((await stat(resolve(portableRoot, artifact)).catch(() => null))?.isFile()) return true
  }
  return false
}

async function isProposalPath(artifact: string, proposalRoots: readonly string[] | undefined) {
  for (const root of proposalRoots ?? []) {
    if (isAbsolute(artifact)) {
      if (
        containedRelativePath(root, artifact) !== null &&
        (await stat(resolve(artifact)).catch(() => null))?.isFile()
      ) {
        return true
      }
      continue
    }
    if (
      isSafeRelativePath(artifact) &&
      (await stat(resolve(root, artifact)).catch(() => null))?.isFile()
    ) {
      return true
    }
  }
  return false
}

function isSafeRelativePath(path: string) {
  if (!path || isAbsolute(path) || path.includes('\\')) return false
  const normalized = posix.normalize(path)
  return (
    normalized === path &&
    normalized !== '.' &&
    normalized !== '..' &&
    !normalized.startsWith('../')
  )
}

function containedRelativePath(root: string, path: string) {
  const value = relative(resolve(root), resolve(path))
  if (value === '' || value === '..' || value.startsWith(`..${sep}`)) {
    return null
  }
  return value
}

function safeArtifactName(value: string) {
  const safe = value
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(-120)
  return safe || 'artifact'
}

async function rewriteResultArtifacts(path: string, artifacts: readonly string[]) {
  const file = Bun.file(path)
  if (!(await file.exists())) return
  const source = await file.text()
  if (!source.trim()) return
  try {
    const value = JSON.parse(source)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    await Bun.write(path, `${JSON.stringify({ ...value, artifacts }, null, 2)}\n`)
  } catch {
    // RoleRunner has already validated new results; malformed legacy results remain diagnostic truth.
  }
}

function assertStableId(runId: string) {
  if (!STABLE_ID_PATTERN.test(runId)) throw new RunArtifactError(`Invalid Run ID: ${runId}`)
}
