import type { PublicationCandidate, PublicationSnapshot, PublicationWrite } from './types'

export function publicationCandidateFromSnapshot(
  snapshot: PublicationSnapshot,
  writes: readonly PublicationWrite[] = [],
): PublicationCandidate {
  const files = new Map(
    snapshot.files.map((file) => [file.path, file.content ? file.content.slice() : null] as const),
  )
  for (const write of writes) {
    files.set(
      write.path,
      typeof write.content === 'string'
        ? new TextEncoder().encode(write.content)
        : write.content.slice(),
    )
  }

  return {
    root: snapshot.root,
    async readBytes(path) {
      return files.get(path)?.slice() ?? null
    },
    async readText(path) {
      const content = await this.readBytes(path)
      return content ? new TextDecoder().decode(content) : null
    },
    async exists(path) {
      return files.has(path) && files.get(path) !== null
    },
    async listFiles(prefix = '') {
      return [...files.entries()]
        .filter(
          ([path, content]) =>
            content !== null && (!prefix || path === prefix || path.startsWith(`${prefix}/`)),
        )
        .map(([path]) => path)
        .sort()
    },
  }
}
