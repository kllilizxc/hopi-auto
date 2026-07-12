export interface PublicationRoot {
  id: string
  path: string
}

export interface PublicationWrite {
  path: string
  expectedHash: string | null
  content: string | Uint8Array
}

export interface PublicationCandidate {
  readonly root: PublicationRoot
  readBytes(path: string): Promise<Uint8Array | null>
  readText(path: string): Promise<string | null>
  exists(path: string): Promise<boolean>
  listFiles(prefix?: string): Promise<string[]>
}

export interface PublicationBundle {
  root: PublicationRoot
  supportingWrites: PublicationWrite[]
  gateWrite?: PublicationWrite
  validateCandidate(
    candidate: PublicationCandidate,
    current: PublicationCandidate,
  ): Promise<void> | void
}

export interface PublicationResult {
  kind: 'published' | 'already_current'
  hashes: Readonly<Record<string, string>>
}

export interface PublicationSnapshotFile {
  path: string
  hash: string | null
  content: Uint8Array | null
}

export interface PublicationSnapshot {
  root: PublicationRoot
  files: readonly PublicationSnapshotFile[]
}

export interface PublicationSnapshotSelection {
  paths?: readonly string[]
  prefixes?: readonly string[]
}

export interface PublicationFaultHooks {
  afterSupportingWrite?(path: string, index: number): Promise<void> | void
  beforeGateWrite?(path: string): Promise<void> | void
  afterGateWrite?(path: string): Promise<void> | void
}
