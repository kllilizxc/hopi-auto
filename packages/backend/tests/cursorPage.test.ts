import { describe, expect, test } from 'bun:test'
import { CursorPageError, paginateItems } from '../src/presentation/cursorPage'

const items = Array.from({ length: 7 }, (_, index) => ({ id: `M-${index + 1}` }))
const options = { scope: 'test-feed', getId: (item: { id: string }) => item.id }

describe('cursor pagination', () => {
  test('opens at the latest page and walks backward without gaps or duplicates', () => {
    const latest = paginateItems(items, { limit: 3 }, options)
    expect(latest.items.map((item) => item.id)).toEqual(['M-5', 'M-6', 'M-7'])
    expect(latest.pageInfo).toMatchObject({
      hasOlder: true,
      hasNewer: false,
      totalCount: 7,
    })

    const middle = paginateItems(
      items,
      { limit: 3, before: latest.pageInfo.oldestCursor ?? undefined },
      options,
    )
    const oldest = paginateItems(
      items,
      { limit: 3, before: middle.pageInfo.oldestCursor ?? undefined },
      options,
    )

    expect(middle.items.map((item) => item.id)).toEqual(['M-2', 'M-3', 'M-4'])
    expect(oldest.items.map((item) => item.id)).toEqual(['M-1'])
    expect(oldest.pageInfo.hasOlder).toBe(false)
  })

  test('uses stable item anchors when new items are appended', () => {
    const latest = paginateItems(items, { limit: 2 }, options)
    const appended = [...items, { id: 'M-8' }, { id: 'M-9' }]
    const delta = paginateItems(
      appended,
      { limit: 10, after: latest.pageInfo.newestCursor ?? undefined },
      options,
    )

    expect(delta.items.map((item) => item.id)).toEqual(['M-8', 'M-9'])
    expect(delta.pageInfo.hasNewer).toBe(false)
  })

  test('rejects cursors from another stream', () => {
    const latest = paginateItems(items, { limit: 2 }, options)
    expect(() =>
      paginateItems(
        items,
        { limit: 2, before: latest.pageInfo.oldestCursor ?? undefined },
        { ...options, scope: 'other-feed' },
      ),
    ).toThrow(CursorPageError)
  })
})
