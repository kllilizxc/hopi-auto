import { expect, test } from 'bun:test'
import type { AppSnapshot, GoalBoardDetail, GoalDetail, PreviewSession } from './apiTypes'
import {
  boardPollInterval,
  CANONICAL_POLL_INTERVAL_MS,
  DOCUMENT_POLL_INTERVAL_MS,
  documentPollInterval,
  NAVIGATION_CACHE_GC_INTERVAL_MS,
  SETTLED_POLL_INTERVAL_MS,
  shellPollInterval,
} from './queryPerformance'

test('polling surfaces share stable intervals and notify only visible state', async () => {
  const contract = await Bun.file(new URL('./queryPerformance.ts', import.meta.url)).text()
  const sources = await Promise.all([
    Bun.file(new URL('../components/Layout.tsx', import.meta.url)).text(),
    Bun.file(new URL('../pages/ProjectHomePage.tsx', import.meta.url)).text(),
    Bun.file(new URL('../pages/GoalDocsPage.tsx', import.meta.url)).text(),
    Bun.file(new URL('../pages/BoardView.tsx', import.meta.url)).text(),
    Bun.file(new URL('../components/AssistantPanel.tsx', import.meta.url)).text(),
    Bun.file(new URL('./useAssistantFeedStream.ts', import.meta.url)).text(),
    Bun.file(new URL('./useInfiniteMessageStream.ts', import.meta.url)).text(),
  ])
  const runtime = sources.join('\n')

  expect(contract).toContain('CANONICAL_POLL_INTERVAL_MS = 2_000')
  expect(contract).toContain('ACTIVE_STREAM_POLL_INTERVAL_MS = 1_000')
  expect(contract).toContain('SETTLED_POLL_INTERVAL_MS = 15_000')
  expect(NAVIGATION_CACHE_GC_INTERVAL_MS).toBe(30 * 60 * 1_000)
  expect(contract).toContain('STABLE_QUERY_NOTIFY_PROPS: QueryNotifyProp[] = [')
  expect(contract).toContain("'isLoading'")
  expect(contract).toContain("'isError'")
  expect(runtime).toContain('notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS')
  expect(runtime).toContain('select: (snapshot) =>')
  expect(runtime).not.toContain('refetchInterval: 2_000')
  expect(runtime).not.toContain('refetchInterval: 1_000')
  expect(runtime).toContain('queryFn: readShellState')
  expect(runtime).toContain('queryFn: () => readGoalBoard')
  expect(runtime).toContain('refetchInterval: boardPollInterval')
  expect(runtime).toContain('refetchInterval: documentPollInterval')
  expect(runtime).toContain('readMessageStreamSnapshot')
  expect(runtime).toContain('initialData: persistedHistory')
  expect(runtime).toContain('writeMessageStreamSnapshot')
})

test('canonical polling stays responsive only while the projection can change actively', () => {
  const shell = (
    activeRuns: AppSnapshot['activeRuns'],
    previewStatus?: PreviewSession['status'],
  ) =>
    ({
      state: {
        data: {
          activeRuns,
          projects: previewStatus ? [{ preview: { status: previewStatus } }] : [],
        } as AppSnapshot,
      },
    })
  const board = (lifecycle: GoalBoardDetail['goal']['lifecycle']) =>
    ({ state: { data: { goal: { lifecycle } } as GoalBoardDetail } })
  const documents = (lifecycle: GoalDetail['goal']['lifecycle']) =>
    ({ state: { data: { goal: { lifecycle } } as GoalDetail } })

  expect(shell([{ key: 'P/G/W', responsibility: 'generator' }])).toBeDefined()
  expect(shellPollInterval(shell([{ key: 'P/G/W', responsibility: 'generator' }]))).toBe(
    CANONICAL_POLL_INTERVAL_MS,
  )
  expect(shellPollInterval(shell([]))).toBe(SETTLED_POLL_INTERVAL_MS)
  expect(shellPollInterval(shell([], 'starting'))).toBe(CANONICAL_POLL_INTERVAL_MS)
  expect(shellPollInterval(shell([], 'running'))).toBe(SETTLED_POLL_INTERVAL_MS)
  expect(boardPollInterval(board('active'))).toBe(CANONICAL_POLL_INTERVAL_MS)
  expect(boardPollInterval(board('done'))).toBe(SETTLED_POLL_INTERVAL_MS)
  expect(documentPollInterval(documents('active'))).toBe(DOCUMENT_POLL_INTERVAL_MS)
  expect(documentPollInterval(documents('paused'))).toBe(SETTLED_POLL_INTERVAL_MS)
})

test('Goal docs polls a catalog and fetches only the selected document body', async () => {
  const page = await Bun.file(new URL('../pages/GoalDocsPage.tsx', import.meta.url)).text()
  const api = await Bun.file(new URL('./apiClient.ts', import.meta.url)).text()

  expect(page).toContain('queryKey: goalDocsQueryKey(projectId, goalId)')
  expect(page).toContain('queryFn: () => readGoalDocs(')
  expect(page).toContain("'goal-document'")
  expect(page).toContain('readGoalDocument(')
  expect(page).toContain('staleTime: Number.POSITIVE_INFINITY')
  expect(page).not.toContain('queryFn: () => readGoal(')
  expect(api).toContain("`${goalPath(projectId, goalId)}?view=docs`")
  expect(api).toContain("`${goalPath(projectId, goalId)}/documents?${params}`")
})
