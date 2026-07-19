import { lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, posix, relative, resolve, sep } from 'node:path'
import type {
  PublicationBundle,
  PublicationCandidate,
  PublicationFaultHooks,
  PublicationResult,
  PublicationRoot,
  PublicationSnapshot,
  PublicationSnapshotSelection,
  PublicationWrite,
  VersionedPublicationSnapshot,
} from './types'

export class PublicationError extends Error {
  constructor(
    readonly code: 'conflict' | 'invalid_bundle' | 'invalid_path' | 'postcondition_failed',
    message: string,
  ) {
    super(message)
  }
}

export class PublicationCoordinator {
  private queueTail: Promise<void> = Promise.resolve()
  private readonly generations = new Map<string, number>()

  publish(
    bundle: PublicationBundle,
    faultHooks: PublicationFaultHooks = {},
  ): Promise<PublicationResult> {
    return this.withPublicationMutex(async () => {
      try {
        const result = await publishSerialized(bundle, faultHooks)
        if (result.kind === 'published') this.advanceGeneration(bundle.root)
        return result
      } catch (error) {
        // Supporting writes may already be visible even when the final gate failed.
        this.advanceGeneration(bundle.root)
        throw error
      }
    })
  }

  publishDurableReceipt(
    bundle: PublicationBundle,
    faultHooks: PublicationFaultHooks = {},
  ): Promise<PublicationResult> {
    return this.withPublicationMutex(async () => {
      try {
        const result = await publishSerialized(bundle, faultHooks)
        await syncBundleFilesAndParents(bundle)
        if (result.kind === 'published') this.advanceGeneration(bundle.root)
        return result
      } catch (error) {
        this.advanceGeneration(bundle.root)
        throw error
      }
    })
  }

  generation(root: PublicationRoot): Promise<number> {
    return this.withPublicationMutex(() => Promise.resolve(this.currentGeneration(root)))
  }

  invalidate(root: PublicationRoot): Promise<number> {
    return this.withPublicationMutex(() => Promise.resolve(this.advanceGeneration(root)))
  }

  snapshot(root: PublicationRoot, paths: string[]): Promise<PublicationSnapshot> {
    return this.withPublicationMutex(() => snapshotPathsSerialized(root, paths))
  }

  snapshotTree(root: PublicationRoot, prefix = ''): Promise<PublicationSnapshot> {
    return this.withPublicationMutex(() => snapshotTreeSerialized(root, prefix))
  }

  snapshotTreeAtGeneration(
    root: PublicationRoot,
    prefix = '',
  ): Promise<VersionedPublicationSnapshot> {
    return this.withPublicationMutex(async () => ({
      ...(await snapshotTreeSerialized(root, prefix)),
      generation: this.currentGeneration(root),
    }))
  }

  snapshotSelection(
    root: PublicationRoot,
    selection: PublicationSnapshotSelection,
  ): Promise<PublicationSnapshot> {
    return this.withPublicationMutex(() => snapshotSelectionSerialized(root, selection))
  }

  runExclusive<T>(operation: (session: PublicationExclusiveSession) => Promise<T>): Promise<T> {
    return this.withPublicationMutex(async () => {
      const roots = new Map<string, PublicationRoot>()
      const observe = (root: PublicationRoot) => {
        roots.set(publicationRootKey(root), root)
      }
      try {
        return await operation({
          snapshot: (root, paths) => {
            observe(root)
            return snapshotPathsSerialized(root, paths)
          },
          snapshotTree: (root, prefix) => {
            observe(root)
            return snapshotTreeSerialized(root, prefix)
          },
          snapshotSelection: (root, selection) => {
            observe(root)
            return snapshotSelectionSerialized(root, selection)
          },
        })
      } finally {
        // C1 owns writes inside this critical section, so every observed root becomes stale.
        for (const root of roots.values()) this.advanceGeneration(root)
      }
    })
  }

  private currentGeneration(root: PublicationRoot) {
    return this.generations.get(publicationRootKey(root)) ?? 0
  }

  private advanceGeneration(root: PublicationRoot) {
    const key = publicationRootKey(root)
    const next = (this.generations.get(key) ?? 0) + 1
    this.generations.set(key, next)
    return next
  }

  private async withPublicationMutex<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queueTail
    let release: () => void = () => undefined
    const current = new Promise<void>((resolveCurrent) => {
      release = resolveCurrent
    })
    this.queueTail = previous.catch(() => undefined).then(() => current)
    await previous.catch(() => undefined)

    try {
      return await operation()
    } finally {
      release()
    }
  }
}

function publicationRootKey(root: PublicationRoot) {
  return `${root.id}\0${resolve(root.path)}`
}

async function syncBundleFilesAndParents(bundle: PublicationBundle) {
  const root = await validateRoot(bundle.root)
  const writes = [...bundle.supportingWrites, ...(bundle.gateWrite ? [bundle.gateWrite] : [])]
  const directories = new Set<string>()
  for (const write of writes) {
    const path = normalizeRelativePath(write.path)
    const target = await assertSafeTarget(root.path, path)
    const handle = await open(target, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    directories.add(dirname(target))
  }
  for (const directory of [...directories].sort()) {
    const handle = await open(directory, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
}

export interface PublicationExclusiveSession {
  snapshot(root: PublicationRoot, paths: string[]): Promise<PublicationSnapshot>
  snapshotTree(root: PublicationRoot, prefix?: string): Promise<PublicationSnapshot>
  snapshotSelection(
    root: PublicationRoot,
    selection: PublicationSnapshotSelection,
  ): Promise<PublicationSnapshot>
}

async function snapshotPathsSerialized(root: PublicationRoot, paths: string[]) {
  const canonicalRoot = await validateRoot(root)
  const normalizedPaths = [...new Set(paths.map(normalizeRelativePath))].sort()
  return snapshotNormalizedPaths(canonicalRoot, normalizedPaths)
}

async function snapshotTreeSerialized(root: PublicationRoot, prefix = '') {
  const canonicalRoot = await validateRoot(root)
  const normalizedPrefix = prefix ? normalizeRelativePath(prefix) : ''
  const paths = [...(await listRootFiles(canonicalRoot.path, normalizedPrefix))].sort()
  return snapshotNormalizedPaths(canonicalRoot, paths)
}

async function snapshotSelectionSerialized(
  root: PublicationRoot,
  selection: PublicationSnapshotSelection,
) {
  const canonicalRoot = await validateRoot(root)
  const paths = new Set((selection.paths ?? []).map((path) => normalizeRelativePath(path)))
  const prefixes = (selection.prefixes ?? []).map((prefix) =>
    prefix ? normalizeRelativePath(prefix) : '',
  )
  for (const prefix of prefixes) {
    for (const path of await listRootFiles(canonicalRoot.path, prefix)) paths.add(path)
  }
  return snapshotNormalizedPaths(canonicalRoot, [...paths].sort())
}

async function snapshotNormalizedPaths(root: PublicationRoot, paths: string[]) {
  const files = await Promise.all(
    paths.map(async (path) => {
      const content = await readFileBytes(root.path, path)
      return {
        path,
        hash: content ? await hashBytes(content) : null,
        content: content ? content.slice() : null,
      }
    }),
  )
  return { root, files }
}

interface PreparedWrite {
  path: string
  expectedHash: string | null
  content: Uint8Array
  desiredHash: string
}

async function publishSerialized(
  bundle: PublicationBundle,
  faultHooks: PublicationFaultHooks,
): Promise<PublicationResult> {
  const root = await validateRoot(bundle.root)
  const preparedSupporting = await prepareWrites(bundle.supportingWrites)
  const preparedGate = bundle.gateWrite ? await prepareWrite(bundle.gateWrite) : undefined
  const allWrites = [...preparedSupporting, ...(preparedGate ? [preparedGate] : [])]
  validateBundle(allWrites)

  const currentHashes = new Map<string, string | null>()
  for (const write of allWrites) {
    const content = await readFileBytes(root.path, write.path)
    const currentHash = content ? await hashBytes(content) : null
    currentHashes.set(write.path, currentHash)
    if (currentHash !== write.expectedHash && currentHash !== write.desiredHash) {
      throw new PublicationError(
        'conflict',
        `Expected ${formatHash(write.expectedHash)} at ${write.path}, found ${formatHash(currentHash)}`,
      )
    }
  }

  const allCurrent = allWrites.every((write) => currentHashes.get(write.path) === write.desiredHash)
  const candidate = createCandidate(root, allWrites)
  const current = createCandidate(root, [])
  if (allCurrent) {
    await bundle.validateCandidate(candidate, current)
    return publicationResult('already_current', allWrites)
  }

  if (preparedGate && currentHashes.get(preparedGate.path) === preparedGate.desiredHash) {
    throw new PublicationError(
      'conflict',
      `Gate ${preparedGate.path} is already current while supporting writes are not`,
    )
  }

  await bundle.validateCandidate(candidate, current)

  const orderedSupporting = preparedSupporting.toSorted((left, right) =>
    left.path.localeCompare(right.path),
  )
  for (const [index, write] of orderedSupporting.entries()) {
    if (currentHashes.get(write.path) !== write.desiredHash) {
      await replaceFileAtomically(root.path, write)
    }
    await faultHooks.afterSupportingWrite?.(write.path, index)
  }

  if (preparedGate) {
    const gateContent = await readFileBytes(root.path, preparedGate.path)
    const gateHash = gateContent ? await hashBytes(gateContent) : null
    if (gateHash !== preparedGate.expectedHash) {
      throw new PublicationError(
        'conflict',
        `Gate changed before publication: ${preparedGate.path}`,
      )
    }

    await bundle.validateCandidate(createCandidate(root, [preparedGate]), createCandidate(root, []))
    await faultHooks.beforeGateWrite?.(preparedGate.path)
    await replaceFileAtomically(root.path, preparedGate)
    await faultHooks.afterGateWrite?.(preparedGate.path)
  }

  for (const write of allWrites) {
    const content = await readFileBytes(root.path, write.path)
    const finalHash = content ? await hashBytes(content) : null
    if (finalHash !== write.desiredHash) {
      throw new PublicationError(
        'postcondition_failed',
        `Publication postcondition failed for ${write.path}`,
      )
    }
  }

  return publicationResult('published', allWrites)
}

function validateBundle(allWrites: PreparedWrite[]) {
  if (allWrites.length === 0) {
    throw new PublicationError('invalid_bundle', 'A publication must contain at least one write')
  }

  const paths = new Set<string>()
  for (const write of allWrites) {
    if (paths.has(write.path)) {
      throw new PublicationError('invalid_bundle', `Duplicate publication path: ${write.path}`)
    }
    paths.add(write.path)
  }
}

async function prepareWrites(writes: PublicationWrite[]) {
  return Promise.all(writes.map(prepareWrite))
}

async function prepareWrite(write: PublicationWrite): Promise<PreparedWrite> {
  const content = toBytes(write.content)
  return {
    path: normalizeRelativePath(write.path),
    expectedHash: validateExpectedHash(write.expectedHash),
    content,
    desiredHash: await hashBytes(content),
  }
}

function createCandidate(root: PublicationRoot, writes: PreparedWrite[]): PublicationCandidate {
  const overlay = new Map(writes.map((write) => [write.path, write.content] as const))

  return {
    root,
    async readBytes(path) {
      const normalized = normalizeRelativePath(path)
      const staged = overlay.get(normalized)
      return staged ? staged.slice() : readFileBytes(root.path, normalized)
    },
    async readText(path) {
      const content = await this.readBytes(path)
      return content ? new TextDecoder().decode(content) : null
    },
    async exists(path) {
      return (await this.readBytes(path)) !== null
    },
    async listFiles(prefix = '') {
      const normalizedPrefix = prefix ? normalizeRelativePath(prefix) : ''
      const current = await listRootFiles(root.path, normalizedPrefix)
      for (const path of overlay.keys()) {
        if (
          !normalizedPrefix ||
          path === normalizedPrefix ||
          path.startsWith(`${normalizedPrefix}/`)
        ) {
          current.add(path)
        }
      }
      return [...current].sort()
    },
  }
}

async function validateRoot(root: PublicationRoot): Promise<PublicationRoot> {
  if (!root.id.trim()) {
    throw new PublicationError('invalid_bundle', 'Publication root ID is required')
  }

  const absolutePath = resolve(root.path)
  const rootStats = await lstat(absolutePath).catch(() => null)
  if (!rootStats?.isDirectory() || rootStats.isSymbolicLink()) {
    throw new PublicationError(
      'invalid_path',
      `Publication root must be an existing physical directory: ${absolutePath}`,
    )
  }

  return { id: root.id, path: await realpath(absolutePath) }
}

function normalizeRelativePath(path: string) {
  if (!path || isAbsolute(path) || path.includes('\\')) {
    throw new PublicationError('invalid_path', `Invalid publication path: ${path}`)
  }
  const normalized = posix.normalize(path)
  if (
    normalized !== path ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new PublicationError('invalid_path', `Invalid publication path: ${path}`)
  }
  return normalized
}

async function assertSafeTarget(rootPath: string, path: string, allowDirectory = false) {
  const target = resolve(rootPath, path)
  const fromRoot = relative(rootPath, target)
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
    throw new PublicationError('invalid_path', `Path escapes publication root: ${path}`)
  }

  const parts = path.split('/')
  let current = rootPath
  for (const [index, part] of parts.entries()) {
    current = resolve(current, part)
    const stats = await lstat(current).catch(() => null)
    if (!stats) {
      break
    }
    if (stats.isSymbolicLink()) {
      throw new PublicationError('invalid_path', `Symlink is not writable authority: ${path}`)
    }
    if (index < parts.length - 1 && !stats.isDirectory()) {
      throw new PublicationError('invalid_path', `Parent path is not a directory: ${path}`)
    }
    if (index === parts.length - 1 && !stats.isFile() && !(allowDirectory && stats.isDirectory())) {
      throw new PublicationError('invalid_path', `Publication target is not a file: ${path}`)
    }
  }
  return target
}

async function readFileBytes(rootPath: string, path: string) {
  const target = await assertSafeTarget(rootPath, path)
  const file = Bun.file(target)
  if (!(await file.exists())) {
    return null
  }
  return new Uint8Array(await file.arrayBuffer())
}

async function replaceFileAtomically(rootPath: string, write: PreparedWrite) {
  const target = await assertSafeTarget(rootPath, write.path)
  await mkdir(dirname(target), { recursive: true })
  await assertSafeTarget(rootPath, write.path)
  const temporaryPath = `${target}.tmp.${crypto.randomUUID()}`
  try {
    await Bun.write(temporaryPath, write.content)
    await rename(temporaryPath, target)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

async function listRootFiles(rootPath: string, prefix: string) {
  const result = new Set<string>()
  const startPath = prefix ? await assertSafeTarget(rootPath, prefix, true) : rootPath
  const startStats = await lstat(startPath).catch(() => null)
  if (!startStats) {
    return result
  }
  if (startStats.isFile()) {
    result.add(prefix)
    return result
  }

  async function visit(directory: string, relativeDirectory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) {
        throw new PublicationError(
          'invalid_path',
          `Symlink is not readable authority: ${relativePath}`,
        )
      }
      if (entry.isDirectory()) {
        await visit(resolve(directory, entry.name), relativePath)
      } else if (entry.isFile()) {
        result.add(relativePath)
      }
    }
  }

  await visit(startPath, prefix)
  return result
}

function toBytes(content: string | Uint8Array) {
  return typeof content === 'string' ? new TextEncoder().encode(content) : content.slice()
}

function validateExpectedHash(hash: string | null) {
  if (hash !== null && !/^[a-f0-9]{64}$/.test(hash)) {
    throw new PublicationError('invalid_bundle', `Invalid expected SHA-256 hash: ${hash}`)
  }
  return hash
}

export async function hashBytes(content: Uint8Array) {
  const copied = new Uint8Array(content.byteLength)
  copied.set(content)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copied.buffer))
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function publicationResult(
  kind: PublicationResult['kind'],
  writes: PreparedWrite[],
): PublicationResult {
  return {
    kind,
    hashes: Object.freeze(
      Object.fromEntries(writes.map((write) => [write.path, write.desiredHash])),
    ),
  }
}

function formatHash(hash: string | null) {
  return hash ?? 'missing file'
}
