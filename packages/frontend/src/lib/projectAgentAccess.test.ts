import { expect, test } from 'bun:test'
import {
  readProjectAgentFullAccess,
  writeProjectAgentFullAccess,
} from './projectAgentAccess'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  }
}

test('Project agent full access is off by default and isolated by Project', () => {
  const storage = memoryStorage()

  expect(readProjectAgentFullAccess('one', storage)).toBe(false)
  writeProjectAgentFullAccess('one', true, storage)
  expect(readProjectAgentFullAccess('one', storage)).toBe(true)
  expect(readProjectAgentFullAccess('two', storage)).toBe(false)
  writeProjectAgentFullAccess('one', false, storage)
  expect(readProjectAgentFullAccess('one', storage)).toBe(false)
})
