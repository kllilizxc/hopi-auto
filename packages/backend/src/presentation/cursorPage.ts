export interface CursorPageRequest {
  before?: string
  after?: string
  limit: number
}

export interface CursorPageInfo {
  oldestCursor: string | null
  newestCursor: string | null
  hasOlder: boolean
  hasNewer: boolean
  totalCount: number
}

export interface CursorPage<T> {
  items: T[]
  pageInfo: CursorPageInfo
}

export class CursorPageError extends Error {}

interface CursorPayload {
  version: 1
  scope: string
  side: 'before' | 'after'
  anchorId: string
}

export function paginateItems<T>(
  items: readonly T[],
  request: CursorPageRequest,
  options: { scope: string; getId(item: T): string },
): CursorPage<T> {
  if (request.before && request.after) {
    throw new CursorPageError('before and after cursors are mutually exclusive')
  }
  if (!Number.isInteger(request.limit) || request.limit < 1) {
    throw new CursorPageError('limit must be a positive integer')
  }

  let start = Math.max(0, items.length - request.limit)
  let end = items.length

  if (request.before) {
    const cursor = decodeCursor(request.before, options.scope, 'before')
    end = findAnchor(items, cursor.anchorId, options.getId)
    start = Math.max(0, end - request.limit)
  } else if (request.after) {
    const cursor = decodeCursor(request.after, options.scope, 'after')
    start = findAnchor(items, cursor.anchorId, options.getId) + 1
    end = Math.min(items.length, start + request.limit)
  }

  const pageItems = items.slice(start, end)
  const first = pageItems[0]
  const last = pageItems.at(-1)

  return {
    items: pageItems,
    pageInfo: {
      oldestCursor: first
        ? encodeCursor({
            version: 1,
            scope: options.scope,
            side: 'before',
            anchorId: options.getId(first),
          })
        : (request.before ?? null),
      newestCursor: last
        ? encodeCursor({
            version: 1,
            scope: options.scope,
            side: 'after',
            anchorId: options.getId(last),
          })
        : (request.after ?? null),
      hasOlder: start > 0,
      hasNewer: end < items.length,
      totalCount: items.length,
    },
  }
}

function findAnchor<T>(items: readonly T[], anchorId: string, getId: (item: T) => string) {
  const index = items.findIndex((item) => getId(item) === anchorId)
  if (index === -1) throw new CursorPageError('The message cursor is no longer available')
  return index
}

function encodeCursor(payload: CursorPayload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string, scope: string, side: CursorPayload['side']) {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw new CursorPageError('Invalid message cursor')
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    parsed.scope !== scope ||
    parsed.side !== side ||
    typeof parsed.anchorId !== 'string' ||
    !parsed.anchorId
  ) {
    throw new CursorPageError('Invalid message cursor')
  }
  return parsed as unknown as CursorPayload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
