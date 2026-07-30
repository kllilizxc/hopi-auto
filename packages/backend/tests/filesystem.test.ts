import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalPathOrMissing, readDirectoryEntriesIfExists } from '../src/storage/filesystem'

let temporaryRoot = ''

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = ''
})

describe('optional directory reads', () => {
  test('treats a missing path as empty', async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'hopi-directory-read-'))

    expect(await readDirectoryEntriesIfExists(join(temporaryRoot, 'missing'))).toEqual([])
  })

  test('propagates a non-directory filesystem failure', async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'hopi-directory-read-'))
    const path = join(temporaryRoot, 'file')
    await Bun.write(path, 'not a directory')

    await expect(readDirectoryEntriesIfExists(path)).rejects.toMatchObject({ code: 'ENOTDIR' })
    await expect(canonicalPathOrMissing(join(path, 'child'))).rejects.toMatchObject({
      code: 'ENOTDIR',
    })
  })
})
