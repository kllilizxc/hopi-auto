import { expect, test } from 'bun:test'
import {
  MESSAGE_STREAM_CACHE_MAX_ENTRIES,
  MESSAGE_STREAM_CACHE_MAX_ENTRY_CHARACTERS,
  type MessageStreamStorage,
  messageStreamSnapshotKey,
  readMessageStreamSnapshot,
  writeMessageStreamSnapshot,
} from './messageStreamCache'

class MemoryStorage implements MessageStreamStorage {
  readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

test('restores the last stream snapshot only for its exact identity', () => {
  const storage = new MemoryStorage()
  const first = messageStreamSnapshotKey(['attempt-events', 'work-a', 'run-1'])
  const second = messageStreamSnapshotKey(['attempt-events', 'work-b', 'run-1'])

  expect(writeMessageStreamSnapshot(first, { items: ['cached'] }, storage, 42)).toBe(true)
  expect(readMessageStreamSnapshot<{ items: string[] }>(first, storage)).toEqual({
    savedAt: 42,
    value: { items: ['cached'] },
  })
  expect(readMessageStreamSnapshot(second, storage)).toBeNull()
})

test('keeps the browser-session cache bounded and evicts the oldest stream', () => {
  const storage = new MemoryStorage()
  for (let index = 0; index <= MESSAGE_STREAM_CACHE_MAX_ENTRIES; index += 1) {
    writeMessageStreamSnapshot(`stream-${index}`, { index }, storage, index)
  }

  expect(readMessageStreamSnapshot('stream-0', storage)).toBeNull()
  expect(readMessageStreamSnapshot('stream-1', storage)).not.toBeNull()
  expect(
    writeMessageStreamSnapshot(
      'oversized',
      'x'.repeat(MESSAGE_STREAM_CACHE_MAX_ENTRY_CHARACTERS),
      storage,
    ),
  ).toBe(false)
})
