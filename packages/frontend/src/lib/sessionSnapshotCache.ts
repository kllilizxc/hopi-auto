export interface SessionSnapshot<T> {
  savedAt: number
  value: T
}

export interface SessionSnapshotStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface SessionSnapshotCacheOptions {
  storageKey: string
  maxEntries: number
  maxEntryCharacters: number
  maxTotalCharacters: number
}

interface CacheIndexEntry {
  key: string
  savedAt: number
  size: number
}

interface CacheEntry<T> extends SessionSnapshot<T> {
  key: string
}

export function createSessionSnapshotCache(options: SessionSnapshotCacheOptions) {
  const indexKey = `${options.storageKey}.index`
  const entryPrefix = `${options.storageKey}.entry.`

  function entryKey(key: string) {
    return `${entryPrefix}${encodeURIComponent(key)}`
  }

  function read<T>(
    key: string,
    storage: SessionSnapshotStorage | null = browserSessionStorage(),
  ): SessionSnapshot<T> | null {
    if (!storage) return null
    try {
      const raw = storage.getItem(entryKey(key))
      if (!raw) return null
      const parsed = JSON.parse(raw) as Partial<CacheEntry<T>>
      if (parsed.key !== key || typeof parsed.savedAt !== 'number' || !('value' in parsed)) {
        return null
      }
      return { savedAt: parsed.savedAt, value: parsed.value as T }
    } catch {
      return null
    }
  }

  function readAll<T>(
    storage: SessionSnapshotStorage | null = browserSessionStorage(),
  ): Array<{ key: string; snapshot: SessionSnapshot<T> }> {
    if (!storage) return []
    return readIndex(storage).flatMap(({ key }) => {
      const snapshot = read<T>(key, storage)
      return snapshot ? [{ key, snapshot }] : []
    })
  }

  function write<T>(
    key: string,
    value: T,
    storage: SessionSnapshotStorage | null = browserSessionStorage(),
    savedAt = Date.now(),
  ) {
    if (!storage) return false

    let serialized: string
    try {
      serialized = JSON.stringify({
        key,
        savedAt,
        value,
      })
    } catch {
      return false
    }
    if (serialized.length > options.maxEntryCharacters) return false

    const current: CacheIndexEntry = { key, savedAt, size: serialized.length }
    const entries = [
      current,
      ...readIndex(storage)
        .filter((entry) => entry.key !== key)
        .sort((left, right) => right.savedAt - left.savedAt),
    ]
    let total = entries.reduce((sum, entry) => sum + entry.size, 0)
    while (entries.length > options.maxEntries || total > options.maxTotalCharacters) {
      const removed = entries.pop()
      if (!removed || removed.key === key) return false
      total -= removed.size
      safelyRemoveEntry(storage, removed.key)
    }

    while (true) {
      try {
        storage.setItem(entryKey(key), serialized)
        break
      } catch {
        const removed = entries.pop()
        if (!removed || removed.key === key) return false
        safelyRemoveEntry(storage, removed.key)
      }
    }

    try {
      storage.setItem(indexKey, JSON.stringify(entries))
      return true
    } catch {
      safelyRemoveEntry(storage, key)
      return false
    }
  }

  function remove(key: string, storage: SessionSnapshotStorage | null = browserSessionStorage()) {
    if (!storage) return
    safelyRemoveEntry(storage, key)
    try {
      storage.setItem(
        indexKey,
        JSON.stringify(readIndex(storage).filter((entry) => entry.key !== key)),
      )
    } catch {
      // A disposable cache never blocks the product when browser storage is unavailable.
    }
  }

  function readIndex(storage: SessionSnapshotStorage): CacheIndexEntry[] {
    try {
      const raw = storage.getItem(indexKey)
      if (!raw) return []
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (entry): entry is CacheIndexEntry =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof entry.key === 'string' &&
          typeof entry.savedAt === 'number' &&
          typeof entry.size === 'number' &&
          entry.size >= 0,
      )
    } catch {
      return []
    }
  }

  function safelyRemoveEntry(storage: SessionSnapshotStorage, key: string) {
    try {
      storage.removeItem(entryKey(key))
    } catch {
      // A cache that cannot be written or evicted is simply ignored.
    }
  }

  return {
    available: () => browserSessionStorage() !== null,
    read,
    readAll,
    remove,
    write,
  }
}

export function browserSessionStorage(): SessionSnapshotStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}
