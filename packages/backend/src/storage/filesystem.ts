import type { Dirent } from 'node:fs'
import { readdir, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function readDirectoryEntriesIfExists(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch (error) {
    if (filesystemErrorCode(error) === 'ENOENT') return []
    throw error
  }
}

export async function canonicalPathOrMissing(path: string) {
  try {
    return await realpath(path)
  } catch (error) {
    if (filesystemErrorCode(error) === 'ENOENT') return resolve(path)
    throw error
  }
}

export function filesystemErrorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null
}
