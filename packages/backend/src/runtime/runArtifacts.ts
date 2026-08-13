import { copyFile, cp, mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { z } from 'zod'

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const PORTABLE_ARTIFACT_PATTERN = /^artifact:([A-Za-z0-9][A-Za-z0-9._-]*)\/(.+)$/

export interface PreservedRunArtifact {
  reference: string
  path: string
  source: string
  kind: 'file' | 'directory'
  sizeBytes: number
}

export interface PreserveRunArtifactsResult {
  references: readonly string[]
  preserved: readonly PreservedRunArtifact[]
  unavailable: readonly { reference: string; reason: string }[]
  replacements: ReadonlyMap<string, string>
  ignoredProposalPaths: readonly string[]
}

const runArtifactManifestSchema = z
  .object({
    runId: z.string().min(1),
    artifacts: z.array(
      z
        .object({
          reference: z.string().min(1),
          path: z.string().min(1),
          source: z.string().min(1),
          kind: z.enum(['file', 'directory']),
          sizeBytes: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    unavailable: z.array(
      z
        .object({
          reference: z.string().min(1),
          reason: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict()

export type RunArtifactManifest = z.infer<typeof runArtifactManifestSchema>

class RunArtifactError extends Error {}

export async function preserveRunArtifacts(input: {
  runId: string
  runRoot: string
  artifacts: readonly string[]
  sourceRoots?: readonly string[]
  portableRoots?: readonly string[]
  proposalRoots?: readonly string[]
  resultFile?: string
}): Promise<PreserveRunArtifactsResult> {
  assertStableId(input.runId)
  const runRoot = resolve(input.runRoot)
  const artifactRoot = join(runRoot, 'artifacts')
  const sourceRoots = [runRoot, ...(input.sourceRoots ?? []).map((path) => resolve(path))]
  const references: string[] = []
  const referenceSet = new Set<string>()
  const addReference = (reference: string) => {
    if (referenceSet.has(reference)) return
    referenceSet.add(reference)
    references.push(reference)
  }
  const preserved: PreservedRunArtifact[] = []
  const replacements = new Map<string, string>()
  const preservedSources = new Map<string, string>()
  const unavailable: Array<{ reference: string; reason: string }> = []
  const ignoredProposalPaths: string[] = []

  for (const [index, artifact] of input.artifacts.entries()) {
    const portable = parsePortableArtifactReference(artifact)
    if (portable) {
      addReference(artifact)
      continue
    }
    if (await isProposalPath(artifact, input.proposalRoots)) {
      ignoredProposalPaths.push(artifact)
      continue
    }
    if (await isPortableProjectArtifact(artifact, runRoot, input.portableRoots)) {
      addReference(artifact)
      continue
    }

    const source = await resolveArtifactSource(artifact, sourceRoots)
    if (!source) {
      unavailable.push({ reference: artifact, reason: 'Declared Run artifact is unavailable.' })
      if (isSafeRelativePath(artifact)) addReference(artifact)
      continue
    }
    const existing = preservedSources.get(source)
    if (existing) {
      addReference(existing)
      replacements.set(artifact, existing)
      continue
    }

    const sourceStat = await stat(source).catch(() => null)
    const kind = sourceStat?.isFile()
      ? ('file' as const)
      : sourceStat?.isDirectory()
        ? ('directory' as const)
        : null
    if (!sourceStat || !kind) {
      unavailable.push({
        reference: artifact,
        reason: sourceStat
          ? 'Declared Run artifact is not a file or directory.'
          : 'Declared Run artifact is unavailable.',
      })
      if (isSafeRelativePath(artifact)) addReference(artifact)
      continue
    }

    const name = `${String(index + 1).padStart(3, '0')}-${safeArtifactName(basename(source))}`
    const relativePath = `artifacts/${name}`
    const destination = join(artifactRoot, name)
    await mkdir(artifactRoot, { recursive: true })
    try {
      if (resolve(source) !== resolve(destination)) {
        const temporary = `${destination}.tmp.${crypto.randomUUID()}`
        try {
          if (kind === 'file') await copyFile(source, temporary)
          else await cp(source, temporary, { recursive: true })
          await rename(temporary, destination)
        } finally {
          await rm(temporary, { recursive: true, force: true })
        }
      }
    } catch (error) {
      unavailable.push({
        reference: artifact,
        reason: `Declared Run artifact could not be retained: ${errorMessage(error)}`,
      })
      if (isSafeRelativePath(artifact)) addReference(artifact)
      continue
    }
    const reference = `artifact:${input.runId}/${name}`
    preservedSources.set(source, reference)
    replacements.set(artifact, reference)
    addReference(reference)
    preserved.push({
      reference,
      path: relativePath,
      source: artifact,
      kind,
      sizeBytes: kind === 'file' ? sourceStat.size : await directorySize(source),
    })
  }

  if (preserved.length > 0 || unavailable.length > 0) {
    const manifest = runArtifactManifestSchema.parse({
      runId: input.runId,
      artifacts: preserved,
      unavailable,
    })
    await Bun.write(join(runRoot, 'artifacts.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  }
  if (input.resultFile) await rewriteResultArtifacts(input.resultFile, references)
  return { references, preserved, unavailable, replacements, ignoredProposalPaths }
}

export async function readRunArtifactManifest(runRoot: string) {
  const file = Bun.file(join(resolve(runRoot), 'artifacts.json'))
  if (!(await file.exists())) return null
  return runArtifactManifestSchema.parse(await file.json())
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
  if (!match) return null
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

async function resolveArtifactSource(artifact: string, sourceRoots: readonly string[]) {
  const candidates: string[] = []
  if (isAbsolute(artifact)) {
    candidates.push(resolve(artifact))
  } else {
    for (const root of sourceRoots) candidates.push(resolve(root, artifact))
  }

  for (const candidate of new Set(candidates)) {
    const candidateStat = await stat(candidate).catch(() => null)
    if (candidateStat) return candidate
  }
  return null
}

async function isPortableProjectArtifact(
  artifact: string,
  runRoot: string,
  portableRoots: readonly string[] | undefined,
) {
  if (!isSafeRelativePath(artifact)) return false
  if (isArtifactEntry(await stat(resolve(runRoot, artifact)).catch(() => null))) return false
  for (const portableRoot of portableRoots ?? []) {
    if (isArtifactEntry(await stat(resolve(portableRoot, artifact)).catch(() => null))) return true
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

function isArtifactEntry(metadata: Awaited<ReturnType<typeof stat>> | null) {
  return Boolean(metadata?.isFile() || metadata?.isDirectory())
}

async function directorySize(root: string) {
  let size = 0
  for await (const path of new Bun.Glob('**/*').scan({
    cwd: root,
    absolute: true,
    onlyFiles: true,
  })) {
    size += (await stat(path)).size
  }
  return size
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
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
    // RoleRunner already recorded invalid output; artifact retention must not replace that evidence.
  }
}

function assertStableId(runId: string) {
  if (!STABLE_ID_PATTERN.test(runId)) throw new RunArtifactError(`Invalid Run ID: ${runId}`)
}
