import { expect, test } from 'bun:test'
import {
  goalBoardQueryKey,
  goalDocsQueryKey,
  infiniteMessageHistoryQueryKey,
  workAttemptEventsQueryKey,
  workAttemptsQueryKey,
} from './queryKeys'
import { mergeTailIntoMessageHistory } from './messageStreamCache'

test('navigation prefetch and mounted views share canonical query keys', () => {
  expect(goalBoardQueryKey('project', 'goal')).toEqual([
    'mvp-goal',
    'project',
    'goal',
    'board',
  ])
  expect(goalDocsQueryKey('project', 'goal')).toEqual([
    'mvp-goal',
    'project',
    'goal',
    'docs',
  ])
  expect(workAttemptsQueryKey('project', 'goal', 'work')).toEqual([
    'work-attempts',
    'project',
    'goal',
    'work',
  ])
  expect(
    infiniteMessageHistoryQueryKey(
      workAttemptEventsQueryKey('project', 'goal', 'work', 'run'),
    ),
  ).toEqual([
    'work-attempt-events',
    'project',
    'goal',
    'work',
    'run',
    'history',
    'default',
  ])
})

test('newly synchronized messages are retained in the reusable history cache', () => {
  const current = {
    pages: [
      {
        items: [{ id: 'old', order: 1 }],
        pageInfo: {
          oldestCursor: 'before-old',
          newestCursor: 'after-old',
          hasOlder: false,
          hasNewer: false,
          totalCount: 1,
        },
      },
    ],
    pageParams: [null],
  }
  const head = {
    items: [{ id: 'new', order: 2 }],
    pageInfo: {
      oldestCursor: 'before-new',
      newestCursor: 'after-new',
      hasOlder: true,
      hasNewer: false,
      totalCount: 2,
    },
  }

  const merged = mergeTailIntoMessageHistory(
    current,
    head.items,
    head,
    (item) => item.id,
    (left, right) => left.order - right.order,
  )

  expect(merged?.pages[0]?.items.map((item) => item.id)).toEqual(['old', 'new'])
  expect(merged?.pages[0]?.pageInfo.newestCursor).toBe('after-new')
  expect(merged?.pages[0]?.pageInfo.totalCount).toBe(2)
})
