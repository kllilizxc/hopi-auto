import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { readDurableJsonLines } from '../src/storage/jsonLines'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'json-lines')
const eventsPath = join(temporaryRoot, 'events.jsonl')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('durable JSONL recovery', () => {
  test('retains a valid record after legacy leading NUL crash padding', async () => {
    await Bun.write(eventsPath, '{"id":1}\n\0\0\0{"id":2}\n')

    expect(await readDurableJsonLines(eventsPath, parseId)).toEqual([1, 2])
  })

  test('keeps rejecting NUL corruption inside a durable record', async () => {
    await Bun.write(eventsPath, '{"id":\0 1}\n')

    await expect(readDurableJsonLines(eventsPath, parseId)).rejects.toThrow(
      'Invalid durable JSONL record',
    )
  })
})

function parseId(value: unknown) {
  if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'number') {
    throw new Error('invalid id')
  }
  return (value as { id: number }).id
}
