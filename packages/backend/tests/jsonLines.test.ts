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
  test('reports and skips one corrupt durable record while preserving its siblings', async () => {
    await Bun.write(eventsPath, '{"id":1}\n{"id":\0 2}\n{"id":3}\n')

    expect(await readDurableJsonLines(eventsPath, parseId)).toEqual([1, 3])
  })
})

function parseId(value: unknown) {
  if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'number') {
    throw new Error('invalid id')
  }
  return (value as { id: number }).id
}
