import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeJsonAtomically, writeTextAtomically } from '../src/storage/atomicFile'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'atomic-file')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

test('atomic file writes create parents and replace complete text or JSON', async () => {
  const textPath = join(temporaryRoot, 'nested', 'value.txt')
  await writeTextAtomically(textPath, 'first')
  await writeTextAtomically(textPath, 'second')
  expect(await Bun.file(textPath).text()).toBe('second')

  const jsonPath = join(temporaryRoot, 'state.json')
  await writeJsonAtomically(jsonPath, { ready: true })
  expect(await Bun.file(jsonPath).json()).toEqual({ ready: true })
})

test('atomic file writes remove their temporary file after replacement fails', async () => {
  const target = join(temporaryRoot, 'occupied')
  await mkdir(target)

  await expect(writeTextAtomically(target, 'cannot replace a directory')).rejects.toThrow()
  expect(
    (await readdir(temporaryRoot)).filter((entry) => entry.startsWith('occupied.tmp.')),
  ).toEqual([])
})
