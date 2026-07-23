import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ChevronDown,
  CirclePause,
  CirclePlay,
  ExternalLink,
  FileText,
  Inbox,
  MessageSquareText,
  Square,
  X,
} from 'lucide-react'
import {
  memo,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useShell } from '../components/Layout'
import { MessageFeedSkeleton } from '../components/MessageFeedSkeleton'
import { PeerSwitcher } from '../components/PeerSwitcher'
import {
  AppAlert,
  AppBreathingIndicator,
  AppButton,
  AppButtonGroup,
  AppDisclosure,
  AppLink,
  AppLoadingNotice,
  AppModal,
  AppRouterLink,
  AppScrollShadow,
  AppSpinner,
  AppTabs,
  AnimatedShinyText,
  CountBadge,
  IconButton,
  SelectField,
  StatusChip,
  WorkingIndicator,
} from '../components/ui'
import {
  type AgentPlanSnapshot,
  type GoalControl,
  type KanbanColumn,
  type PreviewSession,
  type RunAttemptDetail,
  type RunAttemptDiagnostics,
  type RunAttemptEvent,
  type RunAttemptSummary,
  type RunCostSummary,
  type WorkCardView,
  controlGoal,
  readGoalBoard,
  readGoalExecutionCost,
  readShellState,
  readWorkAttempt,
  readWorkAttemptEvents,
  readWorkAttempts,
  readWorkDocument,
  requestPreviewRepair,
  startPreview,
  stopPreview,
} from '../lib/api'
import { runEventsToMessageFeed } from '../lib/messageFeed'
import {
  hydrateInfiniteMessageStreamSnapshot,
  messageStreamSnapshotKey,
  readMessageStreamSnapshot,
  writeMessageStreamSnapshot,
} from '../lib/messageStreamCache'
import {
  orderGoalsByRecency,
  readGoalViewState,
  readRecentGoals,
  rememberGoalViewState,
  type GoalViewLane,
  type GoalViewState,
} from '../lib/goalScope'
import {
  ACTIVE_STREAM_POLL_INTERVAL_MS,
  boardPollInterval,
  shellPollInterval,
  STABLE_QUERY_NOTIFY_PROPS,
} from '../lib/queryPerformance'
import {
  goalBoardQueryKey,
  workAttemptEventsQueryKey,
  workAttemptsQueryKey,
} from '../lib/queryKeys'
import {
  prefetchInfiniteMessageStream,
  useInfiniteMessageStream,
} from '../lib/useInfiniteMessageStream'
import { cn, excerpt, formatTime, projectDisplayName } from '../lib/utils'

const COLUMNS: Array<{
  id: KanbanColumn
  description: string
  emptyTitle: string
  emptyDescription: string
}> = [
  {
    id: 'Plan',
    description: 'Contract and next work',
    emptyTitle: 'Plan is clear',
    emptyDescription: 'No contract or planning work is waiting.',
  },
  {
    id: 'Build',
    description: 'Generator pass',
    emptyTitle: 'Build queue is clear',
    emptyDescription: 'No work is waiting for generation.',
  },
  {
    id: 'Review',
    description: 'Reviewer pass',
    emptyTitle: 'Review queue is clear',
    emptyDescription: 'Nothing is waiting for review.',
  },
  {
    id: 'Done',
    description: 'Integrated evidence',
    emptyTitle: 'No integrated work yet',
    emptyDescription: 'Completed work will collect here.',
  },
]

const COMPACT_KANBAN_QUERY = '(max-width: 900px)'

export function compactLaneRenderWindow(selectedLane: GoalViewLane | null) {
  const selectedIndex = Math.max(
    0,
    COLUMNS.findIndex((column) => column.id === (selectedLane ?? 'Plan')),
  )
  return new Set(
    COLUMNS.filter((_, index) => Math.abs(index - selectedIndex) <= 1).map((column) => column.id),
  )
}

export function orderDoneWorks<T extends { completedAt: string | null }>(works: readonly T[]) {
  return works.toSorted((left, right) => {
    const leftTime = completionTimestamp(left.completedAt)
    const rightTime = completionTimestamp(right.completedAt)
    if (leftTime === null) return rightTime === null ? 0 : 1
    if (rightTime === null) return -1
    return rightTime - leftTime
  })
}

function completionTimestamp(value: string | null) {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function shouldShowWorkProgress(input: {
  stage: WorkCardView['stage']
  runAttemptCount: number
  hasAgentPlan: boolean
  running: boolean
}) {
  const terminal = input.stage === 'done' || input.stage === 'cancelled'
  const started = input.running || input.hasAgentPlan || input.runAttemptCount > 0
  return !terminal && started
}

export function previewRepairPrompt(preview: PreviewSession | null | undefined) {
  return preview?.repair?.prompt ?? null
}

const loadUnifiedMessageFeed = () => import('../components/UnifiedMessageFeed')

const UnifiedMessageFeed = lazy(() =>
  loadUnifiedMessageFeed().then((module) => ({
    default: module.UnifiedMessageFeed,
  })),
)

function prepareAttemptMessageStream(
  queryClient: QueryClient,
  projectId: string,
  goalId: string,
  workId: string,
  runId: string,
) {
  const queryKey = workAttemptEventsQueryKey(projectId, goalId, workId, runId)
  const cached = hydrateInfiniteMessageStreamSnapshot<RunAttemptEvent>(queryClient, queryKey)
  const prefetch = prefetchInfiniteMessageStream<RunAttemptEvent>(queryClient, {
    queryKey,
    readPage: (input) => readWorkAttemptEvents(projectId, goalId, workId, runId, input),
  })
  const loadFeed = loadUnifiedMessageFeed()

  if (cached) {
    void prefetch
    return loadFeed.then(() => undefined)
  }
  return Promise.all([loadFeed, prefetch]).then(() => undefined)
}

async function prepareWorkActivity(
  queryClient: QueryClient,
  projectId: string,
  goalId: string,
  workId: string,
) {
  const queryKey = workAttemptsQueryKey(projectId, goalId, workId)
  const snapshotKey = messageStreamSnapshotKey(queryKey)
  const persisted = readMessageStreamSnapshot<{ attempts: RunAttemptSummary[] }>(snapshotKey)
  const cached =
    queryClient.getQueryData<{ attempts: RunAttemptSummary[] }>(queryKey) ?? persisted?.value
  if (queryClient.getQueryData(queryKey) === undefined && persisted) {
    queryClient.setQueryData(queryKey, persisted.value, { updatedAt: persisted.savedAt })
  }
  const prefetch = queryClient.prefetchQuery({
    queryKey,
    queryFn: () => readWorkAttempts(projectId, goalId, workId),
  })

  if (cached !== undefined) void prefetch
  else await prefetch

  const attempts = cached ?? queryClient.getQueryData<{ attempts: RunAttemptSummary[] }>(queryKey)
  const latestAttempt = attempts?.attempts[0]
  if (latestAttempt) {
    await prepareAttemptMessageStream(queryClient, projectId, goalId, workId, latestAttempt.runId)
  }
}

interface ScopedGoalViewState {
  scopeKey: string
  state: GoalViewState
}

function goalViewScopeKey(projectId: string | undefined, goalId: string | undefined) {
  return projectId && goalId ? `${projectId}\u0000${goalId}` : ''
}

function readScopedGoalViewState(
  projectId: string | undefined,
  goalId: string | undefined,
): ScopedGoalViewState {
  const scopeKey = goalViewScopeKey(projectId, goalId)
  return {
    scopeKey,
    state:
      projectId && goalId
        ? readGoalViewState(projectId, goalId)
        : { expandedWorkIds: [], mobileLane: null },
  }
}

function useGoalViewState(projectId: string | undefined, goalId: string | undefined) {
  const scopeKey = goalViewScopeKey(projectId, goalId)
  const [snapshot, setSnapshot] = useState(() => readScopedGoalViewState(projectId, goalId))
  const current =
    snapshot.scopeKey === scopeKey ? snapshot : readScopedGoalViewState(projectId, goalId)

  useEffect(() => {
    if (snapshot.scopeKey !== scopeKey) setSnapshot(current)
  }, [current, scopeKey, snapshot.scopeKey])

  const update = useCallback(
    (change: (state: GoalViewState) => GoalViewState) => {
      if (!projectId || !goalId) return
      setSnapshot((previous) => {
        const base =
          previous.scopeKey === scopeKey ? previous.state : readGoalViewState(projectId, goalId)
        const state = rememberGoalViewState(projectId, goalId, change(base))
        return { scopeKey, state }
      })
    },
    [goalId, projectId, scopeKey],
  )

  return [current.state, update] as const
}

function useCompactKanban() {
  const [compact, setCompact] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(COMPACT_KANBAN_QUERY).matches,
  )

  useEffect(() => {
    const media = window.matchMedia(COMPACT_KANBAN_QUERY)
    const update = () => setCompact(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return compact
}

export function BoardView() {
  const { projectId, goalId } = useParams()
  const queryClient = useQueryClient()
  const { openAssistant, selectGoal, warmGoal } = useShell()
  const [selectedWork, setSelectedWork] = useState<WorkCardView | null>(null)
  const [repairPrompt, setRepairPrompt] = useState<string | null>(null)
  const [executionCostOpen, setExecutionCostOpen] = useState(false)
  const [goalViewState, updateGoalViewState] = useGoalViewState(projectId, goalId)
  const compactKanban = useCompactKanban()
  const kanbanRef = useRef<HTMLDivElement | null>(null)
  const laneSaveFrame = useRef(0)
  const mobileLaneRef = useRef<GoalViewLane | null>(goalViewState.mobileLane)
  mobileLaneRef.current = goalViewState.mobileLane
  const projectQuery = useQuery({
    queryKey: ['mvp-state'],
    queryFn: readShellState,
    enabled: Boolean(projectId),
    refetchInterval: shellPollInterval,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
    select: (snapshot) => snapshot.projects.find((item) => item.projectId === projectId) ?? null,
  })
  const goalQuery = useQuery({
    queryKey: goalBoardQueryKey(projectId, goalId),
    queryFn: () => readGoalBoard(projectId ?? '', goalId ?? ''),
    enabled: Boolean(projectId && goalId),
    refetchInterval: boardPollInterval,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
  })
  const executionCostQuery = useQuery({
    queryKey: ['goal-execution-cost', projectId, goalId],
    queryFn: () => readGoalExecutionCost(projectId ?? '', goalId ?? ''),
    enabled: Boolean(projectId && goalId && executionCostOpen),
    refetchInterval: executionCostOpen ? 5_000 : false,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
  })
  const worksByColumn = useMemo(() => {
    const groups = new Map<KanbanColumn, WorkCardView[]>(COLUMNS.map((column) => [column.id, []]))
    for (const work of goalQuery.data?.works ?? []) {
      if (work.projection.column) groups.get(work.projection.column)?.push(work)
    }
    groups.set('Done', orderDoneWorks(groups.get('Done') ?? []))
    return groups
  }, [goalQuery.data?.works])
  const cancelled = useMemo(
    () => (goalQuery.data?.works ?? []).filter((work) => work.projection.cancelled),
    [goalQuery.data?.works],
  )
  const goalReady = Boolean(goalQuery.data)
  const expandedWorkIds = useMemo(
    () => new Set(goalViewState.expandedWorkIds),
    [goalViewState.expandedWorkIds],
  )
  const compactRenderedLanes = useMemo(
    () => compactLaneRenderWindow(goalViewState.mobileLane),
    [goalViewState.mobileLane],
  )
  const setWorkExpanded = useCallback(
    (workId: string, expanded: boolean) => {
      updateGoalViewState((current) => {
        const nextIds = new Set(current.expandedWorkIds)
        if (expanded) nextIds.add(workId)
        else nextIds.delete(workId)
        return { ...current, expandedWorkIds: [...nextIds] }
      })
    },
    [updateGoalViewState],
  )
  const setMobileLane = useCallback(
    (mobileLane: GoalViewLane) => {
      updateGoalViewState((current) =>
        current.mobileLane === mobileLane ? current : { ...current, mobileLane },
      )
    },
    [updateGoalViewState],
  )
  const handleKanbanScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!compactKanban || laneSaveFrame.current) return
      const scroller = event.currentTarget
      laneSaveFrame.current = window.requestAnimationFrame(() => {
        laneSaveFrame.current = 0
        const board = scroller.querySelector<HTMLElement>('.kanban-board')
        const columns = [...scroller.querySelectorAll<HTMLElement>('[data-lane]')]
        if (!board || columns.length === 0) return
        const lane = columns.reduce((nearest, column) => {
          const nearestDistance = Math.abs(
            nearest.offsetLeft - board.offsetLeft - scroller.scrollLeft,
          )
          const columnDistance = Math.abs(
            column.offsetLeft - board.offsetLeft - scroller.scrollLeft,
          )
          return columnDistance < nearestDistance ? column : nearest
        })
        const laneId = lane.dataset.lane as GoalViewLane | undefined
        if (laneId && laneId !== mobileLaneRef.current) {
          mobileLaneRef.current = laneId
          setMobileLane(laneId)
        }
      })
    },
    [compactKanban, setMobileLane],
  )

  useEffect(
    () => () => {
      if (laneSaveFrame.current) window.cancelAnimationFrame(laneSaveFrame.current)
    },
    [],
  )

  useLayoutEffect(() => {
    const scroller = kanbanRef.current
    const lane = goalViewState.mobileLane
    if (!compactKanban || !scroller || !lane || !goalReady) return
    const board = scroller.querySelector<HTMLElement>('.kanban-board')
    const column = [...scroller.querySelectorAll<HTMLElement>('[data-lane]')].find(
      (item) => item.dataset.lane === lane,
    )
    if (!board || !column) return
    scroller.scrollLeft = column.offsetLeft - board.offsetLeft
  }, [compactKanban, goalId, goalReady, goalViewState.mobileLane, projectId])
  const workOpenRequest = useRef(0)
  const warmWork = useCallback(
    (work: WorkCardView) => {
      if (!projectId || !goalId) return
      void prepareWorkActivity(queryClient, projectId, goalId, work.id).catch(() => undefined)
    },
    [goalId, projectId, queryClient],
  )
  const openWork = useCallback(
    (work: WorkCardView) => {
      const request = ++workOpenRequest.current
      if (!projectId || !goalId) {
        setSelectedWork(work)
        return
      }
      void prepareWorkActivity(queryClient, projectId, goalId, work.id)
        .catch(() => undefined)
        .then(() => {
          if (request === workOpenRequest.current) setSelectedWork(work)
        })
    },
    [goalId, projectId, queryClient],
  )
  const closeWork = useCallback(() => {
    workOpenRequest.current += 1
    const workId = selectedWork?.id
    setSelectedWork(null)
    window.setTimeout(() => {
      const trigger = workId
        ? document.querySelector<HTMLElement>(
            `[data-work-id="${CSS.escape(workId)}"] .work-card__open`,
          )
        : null
      trigger?.focus({ preventScroll: true })
    }, 150)
  }, [selectedWork?.id])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['mvp-state'] }),
      queryClient.invalidateQueries({
        queryKey: ['mvp-goal', projectId, goalId],
      }),
    ])
  }
  const controlMutation = useMutation({
    mutationFn: (control: GoalControl) => controlGoal(projectId ?? '', goalId ?? '', control),
    onSuccess: refresh,
  })
  const previewStartMutation = useMutation({
    mutationFn: () => startPreview(projectId ?? ''),
    onSuccess: async (result) => {
      setRepairPrompt(result.kind === 'repair_required' ? result.prompt : null)
      await refresh()
    },
    onError: refresh,
  })
  const previewStopMutation = useMutation({
    mutationFn: () => stopPreview(projectId ?? ''),
    onSuccess: refresh,
  })
  const previewRepairMutation = useMutation({
    mutationFn: () =>
      requestPreviewRepair({
        projectId: projectId ?? '',
        goalId: goalId ?? '',
      }),
    onSuccess: async () => {
      setRepairPrompt(null)
      await refresh()
      openAssistant()
    },
  })
  const previewSession = projectQuery.data?.preview
  useEffect(() => {
    setRepairPrompt(previewRepairPrompt(previewSession))
    if (
      previewStartMutation.isError &&
      (previewSession?.status === 'starting' || previewSession?.status === 'running')
    ) {
      previewStartMutation.reset()
    }
  }, [
    previewSession?.repair?.prompt,
    previewSession?.sessionId,
    previewSession?.status,
    previewStartMutation.isError,
    previewStartMutation.reset,
  ])

  if (!projectId || !goalId) return <Navigate to="/projects" replace />
  const project = projectQuery.data
  const goal = goalQuery.data
  const error = projectQuery.error ?? goalQuery.error ?? controlMutation.error

  if ((!goal || project === undefined) && (projectQuery.isLoading || goalQuery.isLoading)) {
    return <AppLoadingNotice detail="Reading the latest projection…" label="Loading Goal" />
  }
  if (!goal || !project) {
    return (
      <AppAlert className="full-error">
        <AlertCircle />
        <h1>Goal unavailable</h1>
        <p>{(error as Error | null)?.message ?? `${projectId} / ${goalId} was not found.`}</p>
        <AppRouterLink className="secondary-button" to="/projects">
          Back to Projects
        </AppRouterLink>
      </AppAlert>
    )
  }

  const openAssistantAttentions = goal.attentions.filter(
    (attention) =>
      attention.target !== null &&
      attention.resolvedAt === null &&
      (attention.retryRunId ?? null) === null,
  )
  const assistantAttention =
    openAssistantAttentions.find((attention) => Boolean(attention.operatorRequest)) ??
    openAssistantAttentions[0]
  const assistantAttentionLabel = assistantAttention?.operatorRequest
    ? 'Needs you'
    : 'Waiting for Assistant'
  const projectAttention = goal.projectAttention?.resolvedAt === null ? goal.projectAttention : null
  const focus =
    goal.works.find((work) => work.projection.primaryBadge === 'Needs you') ??
    goal.works.find((work) => work.projection.primaryBadge === 'Waiting for Assistant') ??
    goal.works.find((work) => work.projection.primaryBadge === 'working') ??
    goal.works.find((work) => work.stage !== 'done' && work.stage !== 'cancelled')
  const mutationError =
    previewStartMutation.error ?? previewStopMutation.error ?? previewRepairMutation.error
  const goalPeers = orderGoalsByRecency(
    project.goals,
    projectId,
    readRecentGoals(projectId),
  ).map((item) => ({ id: item.id, label: item.title }))

  const runControl = (control: GoalControl) => {
    controlMutation.mutate(control)
  }

  return (
    <div className="board-page">
      <header className="board-header">
        <div className="goal-title-block">
          <PeerSwitcher
            ariaLabel={`${projectDisplayName(project)} Goals`}
            items={goalPeers}
            label={
              <>
                <span title={projectId}>{projectDisplayName(project)}</span> / Goals
              </>
            }
            moreAriaLabel="More Goals"
            onSelectionChange={selectGoal}
            onWarm={warmGoal}
            selectedKey={goalId}
            variant="headline"
          />
        </div>

        <div className="board-actions">
          {goal.goal.lifecycle === 'active' && (
            <AppButton
              className="secondary-button goal-pause-button"
              type="button"
              onClick={() => runControl('pause')}
              disabled={controlMutation.isPending}
            >
              <CirclePause /> Pause
            </AppButton>
          )}
          {goal.goal.lifecycle === 'paused' && (
            <AppButton
              className="primary-button compact"
              type="button"
              onClick={() => runControl('resume')}
              disabled={controlMutation.isPending}
            >
              <CirclePlay /> Resume
            </AppButton>
          )}
          <AppButtonGroup className="preview-compact-control" aria-label="Project Preview controls">
            {project.preview?.status === 'running' &&
              project.preview.surfaces.map((surface) => (
                <AppLink
                  className="preview-compact-open"
                  href={surface.url}
                  key={surface.id}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open ${surface.label}`}
                >
                  <span className="preview-dot running" /> {surface.label} <ExternalLink />
                </AppLink>
              ))}
            {project.preview?.status === 'running' ? (
              <IconButton
                className="icon-button preview-stop-button"
                type="button"
                onClick={() => previewStopMutation.mutate()}
                disabled={previewStopMutation.isPending}
                aria-label="Stop Preview"
                title="Stop Preview"
              >
                {previewStopMutation.isPending ? <AppSpinner size="sm" /> : <Square />}
              </IconButton>
            ) : (
              <AppButton
                className="secondary-button preview-start-button"
                type="button"
                onClick={() => previewStartMutation.mutate()}
                disabled={previewStartMutation.isPending || project.preview?.status === 'starting'}
                title={project.preview?.error ?? 'Start Project Preview'}
              >
                {previewStartMutation.isPending || project.preview?.status === 'starting' ? (
                  <AppSpinner size="sm" />
                ) : (
                  <CirclePlay />
                )}
                Project Preview
              </AppButton>
            )}
          </AppButtonGroup>
        </div>
      </header>

      {error && (
        <AppAlert className="error-banner board-error">{(error as Error).message}</AppAlert>
      )}

      {projectAttention && (
        <output className="attention-status-banner project-blocked-banner">
          <span>
            <AlertCircle />
          </span>
          <span>
            <strong>Project blocked</strong>
            <p>{excerpt(projectAttention.body, 360)}</p>
            <small>Created {formatTime(projectAttention.createdAt)}</small>
          </span>
        </output>
      )}

      <section className="goal-focus-strip">
        <div>
          <small>Contract · revision {goal.goal.contractRevision}</small>
          <p>{excerpt(goal.goal.body, 240)}</p>
        </div>
        <div>
          <small>Current focus</small>
          <strong>
            {projectAttention
              ? 'Project blocked'
              : assistantAttention
                ? assistantAttentionLabel
                : (focus?.title ?? goal.goal.lifecycle)}
          </strong>
          <p>
            {projectAttention
              ? excerpt(projectAttention.body)
              : assistantAttention
                ? assistantAttention.operatorRequest
                  ? 'Your decision is needed. Open Assistant to reply.'
                  : 'Assistant is diagnosing the blocker and will contact you only if needed.'
                : (focus?.projection.primaryBadge ?? 'No pending Work')}
          </p>
        </div>
        <div>
          <small>Progress</small>
          <strong>
            {goal.works.filter((work) => work.stage === 'done').length} of {goal.works.length}
          </strong>
          <p>Work complete</p>
        </div>
      </section>

      <AppDisclosure
        className="goal-execution-cost"
        isExpanded={executionCostOpen}
        onExpandedChange={setExecutionCostOpen}
        summary={
          <>
            <span>
              <strong>Execution cost</strong>
              <small>Read-only Run diagnostics</small>
            </span>
            <span>
              {executionCostQuery.data
                ? executionCostHeadline(executionCostQuery.data.summary)
                : 'Open to calculate'}
            </span>
          </>
        }
      >
        {executionCostQuery.error ? (
          <AppAlert className="goal-execution-cost__error">
            {(executionCostQuery.error as Error).message}
          </AppAlert>
        ) : !executionCostQuery.data ? (
          <div className="goal-execution-cost__loading">
            <AppSpinner size="sm" /> Reading Attempt diagnostics
          </div>
        ) : (
          <div className="goal-execution-cost__roles">
            {executionCostQuery.data.byResponsibility.map(({ responsibility, summary }) => (
              <div key={responsibility}>
                <small>{responsibility}</small>
                <strong>{summary.runs} Runs</strong>
                <span>{executionCostHeadline(summary)}</span>
                <span>{formatTokenCoverage(summary)}</span>
                <span>{formatRunOutcomes(summary)}</span>
              </div>
            ))}
          </div>
        )}
      </AppDisclosure>

      <AppScrollShadow
        className="kanban-scroll"
        ref={kanbanRef}
        orientation="horizontal"
        onScroll={handleKanbanScroll}
      >
        <div className="kanban-board">
          {COLUMNS.map((column) => {
            const works = worksByColumn.get(column.id) ?? []
            const renderCards = !compactKanban || compactRenderedLanes.has(column.id)
            return (
              <section
                className={`kanban-column column-${column.id.toLowerCase()}`}
                data-lane={column.id}
                key={column.id}
              >
                <header>
                  <div>
                    <strong>{column.id}</strong>
                    <small>{column.description}</small>
                  </div>
                  <CountBadge>{works.length}</CountBadge>
                </header>
                <AppScrollShadow className="kanban-cards">
                  {!renderCards ? (
                    <div className="kanban-cards-deferred" aria-hidden="true" />
                  ) : works.length ? (
                    works.map((work) => (
                      <WorkCard
                        expanded={expandedWorkIds.has(work.id)}
                        key={work.id}
                        work={work}
                        onExpandedChange={setWorkExpanded}
                        onOpen={openWork}
                        onWarm={warmWork}
                      />
                    ))
                  ) : (
                    <div className="column-empty">
                      <span className="column-empty-icon" aria-hidden="true">
                        <Inbox />
                      </span>
                      <strong>{column.emptyTitle}</strong>
                      <small>{column.emptyDescription}</small>
                    </div>
                  )}
                </AppScrollShadow>
              </section>
            )
          })}
        </div>
      </AppScrollShadow>

      {cancelled.length > 0 && (
        <AppDisclosure
          className="cancelled-archive"
          bodyClassName="cancelled-archive__content"
          summary={`Cancelled archive · ${cancelled.length}`}
        >
          {cancelled.map((work) => (
            <WorkCard
              expanded={expandedWorkIds.has(work.id)}
              key={work.id}
              work={work}
              onExpandedChange={setWorkExpanded}
              onOpen={openWork}
              onWarm={warmWork}
            />
          ))}
        </AppDisclosure>
      )}

      {repairPrompt && (
        <aside className="preview-repair-banner">
          <div>
            <strong>Preview adapter needs work</strong>
            <p>HOPI can check for equivalent Work and create the smallest reviewed repair.</p>
          </div>
          <AppButton
            className="primary-button compact"
            type="button"
            onClick={() => previewRepairMutation.mutate()}
            disabled={previewRepairMutation.isPending}
          >
            {previewRepairMutation.isPending ? <AppSpinner size="sm" /> : <MessageSquareText />}
            Ask Assistant to repair
          </AppButton>
          <IconButton
            type="button"
            onClick={() => setRepairPrompt(null)}
            aria-label="Dismiss repair prompt"
          >
            <X />
          </IconButton>
        </aside>
      )}
      {mutationError && (
        <AppAlert className="error-banner board-error">{mutationError.message}</AppAlert>
      )}

      {selectedWork && (
        <WorkDetail projectId={projectId} goalId={goalId} work={selectedWork} onClose={closeWork} />
      )}
    </div>
  )
}
const WorkCard = memo(function WorkCard({
  expanded,
  work,
  onExpandedChange,
  onOpen,
  onWarm,
}: {
  expanded: boolean
  work: WorkCardView
  onExpandedChange: (workId: string, expanded: boolean) => void
  onOpen: (work: WorkCardView) => void
  onWarm: (work: WorkCardView) => void
}) {
  const badge = work.projection.primaryBadge
  const running = badge === 'working'
  const showProgress = shouldShowWorkProgress({
    stage: work.stage,
    runAttemptCount: work.runAttemptCount,
    hasAgentPlan: Boolean(work.agentPlan),
    running,
  })
  const completedAt =
    work.stage === 'done' && work.completedAt ? formatTime(work.completedAt) : null

  return (
    <article
      className={cn('work-card', work.kind, running && 'work-card--working')}
      data-work-id={work.id}
    >
      <AppButton
        aria-label={`Open Work details: ${work.title}`}
        className="work-card__open"
        variant="ghost"
        type="button"
        onFocus={() => onWarm(work)}
        onClick={() => onOpen(work)}
        onPointerDown={() => onWarm(work)}
        onPointerEnter={() => onWarm(work)}
      />
      <h2 className="work-card__title">
        {running ? (
          <AnimatedShinyText className="work-card__title-shimmer" shimmerWidth={140}>
            {work.title}
          </AnimatedShinyText>
        ) : (
          work.title
        )}
      </h2>
      {showProgress && (
        <WorkProgress
          expanded={expanded}
          plan={work.agentPlan}
          running={running}
          onExpandedChange={(nextExpanded) => onExpandedChange(work.id, nextExpanded)}
        />
      )}
      <div className="work-card-meta">
        <span className="work-card-attempts">Attempts {work.runAttemptCount}</span>
        {work.blockedBy && (
          <span className="work-card-blocker" title={work.blockedBy}>
            Blocked by {work.blockedBy}
          </span>
        )}
        {completedAt && (
          <time
            className="work-card-completed-at"
            dateTime={work.completedAt ?? undefined}
            title={`Completed ${completedAt}`}
          >
            Completed {completedAt}
          </time>
        )}
      </div>
    </article>
  )
})

type AgentPlanItemStatus = 'complete' | 'current' | 'pending'

function planItemStatus(
  completed: boolean,
  index: number,
  currentIndex: number,
): AgentPlanItemStatus {
  if (completed) return 'complete'
  return index === currentIndex ? 'current' : 'pending'
}

function AgentPlanItems({
  plan,
  running,
}: {
  plan: AgentPlanSnapshot
  running: boolean
}) {
  const currentIndex = running ? plan.items.findIndex((item) => !item.completed) : -1

  return (
    <ul className="agent-plan__items">
      {plan.items.map((item, index) => {
        const status = planItemStatus(item.completed, index, currentIndex)
        return (
          <li
            className={cn('agent-plan__item', `is-${status}`)}
            key={`${plan.planId}:${item.text}`}
          >
            <span className="agent-plan__marker" aria-hidden="true">
              {status === 'current' && (
                <AppBreathingIndicator className="agent-plan__current-indicator" />
              )}
            </span>
            <span>{item.text}</span>
          </li>
        )
      })}
    </ul>
  )
}

function WorkProgress({
  expanded,
  plan,
  running,
  onExpandedChange,
}: {
  expanded: boolean
  plan: AgentPlanSnapshot | null
  running: boolean
  onExpandedChange: (expanded: boolean) => void
}) {
  const items = plan?.items ?? []
  const hasSubtasks = items.length > 0
  const total = hasSubtasks ? items.length : 1
  const completed = hasSubtasks ? items.filter((item) => item.completed).length : 0
  const currentIndex = running ? (hasSubtasks ? items.findIndex((item) => !item.completed) : 0) : -1
  const segments = hasSubtasks
    ? items.map((item, index) => ({
        key: `${plan?.planId ?? 'plan'}:${item.text}`,
        status: planItemStatus(item.completed, index, currentIndex),
      }))
    : [
        {
          key: 'work',
          status: currentIndex === 0 ? 'current' : 'pending',
        } satisfies { key: string; status: AgentPlanItemStatus },
      ]
  const summary = (
    <span className="agent-plan__progress-summary">
      <span
        className="agent-plan__track"
        style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
        aria-hidden="true"
      >
        {segments.map((segment) => (
          <span className={cn('agent-plan__segment', `is-${segment.status}`)} key={segment.key}>
            {segment.status === 'current' && <span className="agent-plan__segment-progress" />}
          </span>
        ))}
      </span>
      <strong className="agent-plan__count">
        {completed}/{total}
      </strong>
      {hasSubtasks && <ChevronDown className="agent-plan__chevron" aria-hidden="true" />}
    </span>
  )
  const label = `Task progress, ${completed} of ${total} complete`

  if (!plan || !hasSubtasks) {
    return (
      <div className="agent-plan agent-plan--card agent-plan--single" aria-label={label}>
        {summary}
      </div>
    )
  }

  return (
    <AppDisclosure
      className="agent-plan agent-plan--card"
      isExpanded={expanded}
      onExpandedChange={onExpandedChange}
      summary={summary}
      triggerClassName="agent-plan__trigger"
      contentClassName="agent-plan__content"
      bodyClassName="agent-plan__body"
    >
      <AgentPlanItems plan={plan} running={running} />
    </AppDisclosure>
  )
}

function WorkDetail({
  projectId,
  goalId,
  work,
  onClose,
}: {
  projectId: string
  goalId: string
  work: WorkCardView
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [activePane, setActivePane] = useState<'activity' | 'contract'>('activity')
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null)
  const attemptSelectionRequest = useRef(0)
  const paneSelectionRequest = useRef(0)
  const attemptsQuery = useQuery({
    queryKey: workAttemptsQueryKey(projectId, goalId, work.id),
    queryFn: () => readWorkAttempts(projectId, goalId, work.id),
    refetchInterval:
      work.stage === 'done' || work.stage === 'cancelled' ? false : ACTIVE_STREAM_POLL_INTERVAL_MS,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
  })
  const attemptsSnapshotKey = messageStreamSnapshotKey(
    workAttemptsQueryKey(projectId, goalId, work.id),
  )
  useEffect(() => {
    if (attemptsQuery.data) {
      writeMessageStreamSnapshot(attemptsSnapshotKey, attemptsQuery.data)
    }
  }, [attemptsQuery.data, attemptsSnapshotKey])
  const attempts = attemptsQuery.data?.attempts ?? []
  const firstAttemptId = attempts[0]?.runId
  const selectedAttempt =
    attempts.find((attempt) => attempt.runId === selectedAttemptId) ?? attempts[0] ?? null

  useEffect(() => {
    if (!selectedAttemptId && firstAttemptId) setSelectedAttemptId(firstAttemptId)
  }, [firstAttemptId, selectedAttemptId])

  const warmAttempt = useCallback(
    (runId: string) => {
      void prepareAttemptMessageStream(queryClient, projectId, goalId, work.id, runId).catch(
        () => undefined,
      )
    },
    [goalId, projectId, queryClient, work.id],
  )
  const selectAttempt = useCallback(
    (runId: string) => {
      if (runId === selectedAttemptId) return
      if (activePane !== 'activity') {
        paneSelectionRequest.current += 1
        setSelectedAttemptId(runId)
        warmAttempt(runId)
        return
      }
      const request = ++attemptSelectionRequest.current
      void prepareAttemptMessageStream(queryClient, projectId, goalId, work.id, runId)
        .catch(() => undefined)
        .then(() => {
          if (request === attemptSelectionRequest.current) setSelectedAttemptId(runId)
        })
    },
    [activePane, goalId, projectId, queryClient, selectedAttemptId, warmAttempt, work.id],
  )
  const selectPane = useCallback(
    (nextPane: 'activity' | 'contract') => {
      if (nextPane === activePane) return
      const request = ++paneSelectionRequest.current
      if (nextPane !== 'activity' || !selectedAttempt) {
        setActivePane(nextPane)
        return
      }
      void prepareAttemptMessageStream(
        queryClient,
        projectId,
        goalId,
        work.id,
        selectedAttempt.runId,
      )
        .catch(() => undefined)
        .then(() => {
          if (request === paneSelectionRequest.current) setActivePane(nextPane)
        })
    },
    [activePane, goalId, projectId, queryClient, selectedAttempt, work.id],
  )
  const attemptQuery = useQuery({
    queryKey: ['work-attempt', projectId, goalId, work.id, selectedAttempt?.runId],
    queryFn: () => readWorkAttempt(projectId, goalId, work.id, selectedAttempt?.runId ?? ''),
    enabled: Boolean(selectedAttempt) && activePane === 'contract',
    refetchInterval:
      activePane === 'contract' && selectedAttempt?.status === 'running'
        ? ACTIVE_STREAM_POLL_INTERVAL_MS
        : false,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
  })
  const workDocumentQuery = useQuery({
    queryKey: ['work-document', projectId, goalId, work.id, work.contractRevision],
    queryFn: () => readWorkDocument(projectId, goalId, work.id),
    enabled: activePane === 'contract',
    staleTime: Number.POSITIVE_INFINITY,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
  })

  return (
    <AppModal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AppModal.Backdrop className="modal-backdrop" isDismissable variant="blur">
        <AppModal.Container
          className="work-detail-modal-container"
          placement="center"
          scroll="inside"
          size="cover"
        >
          <AppModal.Dialog className="work-detail-modal" aria-label={work.title}>
            <AppTabs
              className="work-detail-tabs-root"
              onSelectionChange={(key) => selectPane(String(key) as 'activity' | 'contract')}
              selectedKey={activePane}
            >
              <header>
                <div className="work-detail-title">
                  <span className="eyebrow">
                    {work.kind} · {work.id}
                  </span>
                  <AppModal.Heading className="work-detail-heading">{work.title}</AppModal.Heading>
                </div>
                <div className="work-detail-header-actions">
                  <AppTabs.List className="work-detail-tabs" aria-label="Work detail view">
                    <AppTabs.Tab
                      id="activity"
                      onFocus={() => selectedAttempt && warmAttempt(selectedAttempt.runId)}
                      onPointerDown={() => selectedAttempt && warmAttempt(selectedAttempt.runId)}
                      onPointerEnter={() => selectedAttempt && warmAttempt(selectedAttempt.runId)}
                    >
                      <MessageSquareText /> Activity
                    </AppTabs.Tab>
                    <AppTabs.Tab id="contract">
                      <FileText /> Work contract
                    </AppTabs.Tab>
                  </AppTabs.List>
                  <AppModal.CloseTrigger className="icon-button" aria-label="Close Work detail">
                    <X />
                  </AppModal.CloseTrigger>
                </div>
              </header>
              <AppScrollShadow className="fact-grid work-fact-strip" orientation="horizontal">
                <span className="work-fact-model">
                  <small>Model</small>
                  <strong
                    title={
                      selectedAttempt?.execution
                        ? `Transport: ${selectedAttempt.execution.transport}; reasoning effort: ${selectedAttempt.execution.reasoningEffort ?? 'not recorded'}`
                        : undefined
                    }
                  >
                    {attemptModelLabel(selectedAttempt)}
                  </strong>
                </span>
                <span>
                  <small>Revision</small>
                  <strong>{work.contractRevision}</strong>
                </span>
                <span>
                  <small>Recovery</small>
                  <strong>{work.attempts} / 3</strong>
                </span>
                <span>
                  <small>Not before</small>
                  <strong>{work.notBefore ?? 'now'}</strong>
                </span>
                <AttemptDiagnosticFacts
                  summary={attemptsQuery.data?.summary ?? null}
                  diagnostics={selectedAttempt?.diagnostics ?? null}
                />
              </AppScrollShadow>
              <div className="work-detail-body">
                <AppTabs.Panel className="work-detail-tab-panel" id="activity">
                  {activePane === 'activity' ? (
                    <AttemptHistory
                      projectId={projectId}
                      goalId={goalId}
                      workId={work.id}
                      attempts={attempts}
                      costSummary={attemptsQuery.data?.summary ?? null}
                      selectedAttempt={selectedAttempt}
                      loading={attemptsQuery.isLoading}
                      error={attemptsQuery.error as Error | null}
                      onSelect={selectAttempt}
                      onWarm={warmAttempt}
                    />
                  ) : null}
                </AppTabs.Panel>
                <AppTabs.Panel className="work-detail-tab-panel" id="contract">
                  {activePane === 'contract' ? (
                    <WorkContract
                      work={work}
                      attempts={attempts}
                      selectedAttempt={selectedAttempt}
                      detail={attemptQuery.data ?? null}
                      workBody={workDocumentQuery.data?.body ?? null}
                      workBodyError={workDocumentQuery.error as Error | null}
                      workBodyLoading={workDocumentQuery.isLoading}
                      loading={attemptsQuery.isLoading || attemptQuery.isLoading}
                      error={(attemptsQuery.error ?? attemptQuery.error) as Error | null}
                      onSelect={selectAttempt}
                    />
                  ) : null}
                </AppTabs.Panel>
              </div>
            </AppTabs>
          </AppModal.Dialog>
        </AppModal.Container>
      </AppModal.Backdrop>
    </AppModal>
  )
}

function WorkContract({
  work,
  attempts,
  selectedAttempt,
  detail,
  workBody,
  workBodyError,
  workBodyLoading,
  loading,
  error,
  onSelect,
}: {
  work: WorkCardView
  attempts: RunAttemptSummary[]
  selectedAttempt: RunAttemptSummary | null
  detail: RunAttemptDetail | null
  workBody: string | null
  workBodyError: Error | null
  workBodyLoading: boolean
  loading: boolean
  error: Error | null
  onSelect: (runId: string) => void
}) {
  const selectedDetail = detail?.runId === selectedAttempt?.runId ? detail : null

  return (
    <AppScrollShadow className="work-contract-pane">
      {work.dependsOn.length > 0 && (
        <section>
          <h2>Depends on</h2>
          <div className="chip-list">
            {work.dependsOn.map((item) => (
              <StatusChip key={item} size="sm" variant="soft">
                {item}
              </StatusChip>
            ))}
          </div>
        </section>
      )}
      {work.projection.failedPredicates.length > 0 && (
        <section>
          <h2>Waiting predicates</h2>
          <div className="chip-list warning">
            {work.projection.failedPredicates.map((item) => (
              <StatusChip color="warning" key={item} size="sm" variant="soft">
                {item}
              </StatusChip>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2>Evidence</h2>
        <div className="chip-list">
          {work.evidenceRefs.length ? (
            work.evidenceRefs.map((item) => (
              <StatusChip key={item} size="sm" variant="soft">
                {item}
              </StatusChip>
            ))
          ) : (
            <small>No Evidence yet</small>
          )}
        </div>
      </section>
      <section>
        <h2>Canonical Work document</h2>
        {workBodyError ? (
          <AppAlert className="work-document-status error">{workBodyError.message}</AppAlert>
        ) : workBodyLoading || workBody === null ? (
          <div className="work-document-status" role="status">
            <AppBreathingIndicator /> Loading Work contract
          </div>
        ) : (
          <pre>{workBody}</pre>
        )}
      </section>
      <section className="work-system-prompt-section">
        <div className="work-system-prompt-heading">
          <div>
            <h2>Run prompt</h2>
            <p>The exact stdin instructions staged for this responsibility Attempt.</p>
          </div>
          {attempts.length > 0 && selectedAttempt && (
            <SelectField
              aria-label="Run prompt Attempt"
              label="Attempt"
              onValueChange={onSelect}
              options={attempts.map((attempt, index) => ({
                label: `Attempt ${attempts.length - index} · ${attempt.responsibility} · ${formatAttemptTime(attempt.startedAt)}`,
                value: attempt.runId,
              }))}
              value={selectedAttempt.runId}
            />
          )}
        </div>
        {error ? (
          <AppAlert className="work-system-prompt-empty error">{error.message}</AppAlert>
        ) : loading && !selectedDetail ? (
          <div className="work-system-prompt-empty">
            <AppSpinner size="sm" /> Loading Run prompt
          </div>
        ) : !selectedAttempt ? (
          <div className="work-system-prompt-empty">
            The Run prompt is generated when this Work stages its first Attempt.
          </div>
        ) : (
          <>
            <div className="work-system-prompt-meta">
              <StatusChip
                className={`attempt-status ${attemptStatusTone(selectedAttempt)}`}
                size="sm"
              >
                {selectedAttempt.status === 'running' ? (
                  <WorkingIndicator label={attemptStatus(selectedAttempt)} />
                ) : (
                  attemptStatus(selectedAttempt)
                )}
              </StatusChip>
              <strong>{selectedAttempt.responsibility}</strong>
              <code>{selectedAttempt.runId}</code>
            </div>
            {selectedDetail?.runPrompt !== null && selectedDetail?.runPrompt !== undefined ? (
              <RunPromptView prompt={selectedDetail.runPrompt} />
            ) : (
              <div className="work-system-prompt-empty">
                This Attempt predates prompt capture, or its prompt.md is unavailable.
              </div>
            )}
          </>
        )}
      </section>
    </AppScrollShadow>
  )
}

function RunPromptView({ prompt }: { prompt: string }) {
  if (!prompt.includes('## Current Assignment')) {
    return (
      <div className="work-run-prompt">
        <div>
          <strong>Legacy Run instructions</strong>
          <pre className="work-system-prompt">{prompt}</pre>
        </div>
      </div>
    )
  }
  const boundary = prompt.indexOf('\n## Canonical Boundary')
  const assignment = boundary === -1 ? prompt : prompt.slice(0, boundary)
  const protocol = boundary === -1 ? '' : prompt.slice(boundary + 1)
  return (
    <div className="work-run-prompt">
      <div>
        <strong>Current assignment</strong>
        <pre className="work-system-prompt">{assignment}</pre>
      </div>
      {protocol && (
        <AppDisclosure summary="Canonical boundary, role protocol, and result contract">
          <pre className="work-system-prompt">{protocol}</pre>
        </AppDisclosure>
      )}
    </div>
  )
}

function AttemptHistory({
  projectId,
  goalId,
  workId,
  attempts,
  costSummary,
  selectedAttempt,
  loading,
  error,
  onSelect,
  onWarm,
}: {
  projectId: string
  goalId: string
  workId: string
  attempts: RunAttemptSummary[]
  costSummary: RunCostSummary | null
  selectedAttempt: RunAttemptSummary | null
  loading: boolean
  error: Error | null
  onSelect: (runId: string) => void
  onWarm: (runId: string) => void
}) {
  const eventStream = useInfiniteMessageStream<RunAttemptEvent>({
    streamKey: selectedAttempt?.runId ?? 'no-attempt',
    queryKey: workAttemptEventsQueryKey(projectId, goalId, workId, selectedAttempt?.runId ?? null),
    readPage: (input) =>
      readWorkAttemptEvents(projectId, goalId, workId, selectedAttempt?.runId ?? '', input),
    getItemId: runEventId,
    compareItems: compareRunEvents,
    enabled: Boolean(selectedAttempt),
    refetchInterval: selectedAttempt?.status === 'running' ? ACTIVE_STREAM_POLL_INTERVAL_MS : false,
    tailPageSize: 200,
  })
  const messages = useMemo(() => {
    if (!selectedAttempt) return []
    const groupId = `attempt:${selectedAttempt.runId}`
    return runEventsToMessageFeed(eventStream.items, {
      namespace: groupId,
      groupId,
      active: selectedAttempt.status === 'running',
    })
  }, [eventStream.items, selectedAttempt])
  const streamError = error ?? eventStream.error
  const streamLoading = loading || eventStream.isLoading
  const outcomeSummary = attemptOutcomeSummary(attempts)

  return (
    <section className="attempt-workspace">
      <aside className="attempt-sidebar">
        <div className="attempt-history-heading">
          <div>
            <h2>Attempts</h2>
            <p>{outcomeSummary}</p>
            {costSummary && <p>{executionCostHeadline(costSummary)}</p>}
          </div>
          <CountBadge>{attempts.length}</CountBadge>
        </div>

        {attempts.length > 0 ? (
          <AppScrollShadow className="attempt-list" orientation="auto">
            {attempts.map((attempt, index) => (
              <AppButton
                variant="ghost"
                aria-pressed={attempt.runId === selectedAttempt?.runId}
                className={attempt.runId === selectedAttempt?.runId ? 'active' : undefined}
                key={attempt.runId}
                type="button"
                onFocus={() => onWarm(attempt.runId)}
                onClick={() => onSelect(attempt.runId)}
                onPointerDown={() => onWarm(attempt.runId)}
                onPointerEnter={() => onWarm(attempt.runId)}
              >
                <span>
                  <strong>Attempt {attempts.length - index}</strong>
                  <small>
                    {attempt.responsibility} · {formatAttemptTime(attempt.startedAt)}
                  </small>
                </span>
                <StatusChip className={`attempt-status ${attemptStatusTone(attempt)}`} size="sm">
                  {attempt.status === 'running' ? (
                    <WorkingIndicator label={attemptStatus(attempt)} />
                  ) : (
                    attemptStatus(attempt)
                  )}
                </StatusChip>
              </AppButton>
            ))}
          </AppScrollShadow>
        ) : (
          <p className="attempt-sidebar-empty">No attempts yet</p>
        )}
      </aside>

      <div className="attempt-feed">
        {streamError ? (
          <AppAlert className="attempt-feed-empty error">{streamError.message}</AppAlert>
        ) : streamLoading && eventStream.items.length === 0 ? (
          <MessageFeedSkeleton density="compact" />
        ) : !selectedAttempt ? (
          <div className="attempt-feed-empty">No Attempt has been recorded for this Work.</div>
        ) : (
          <>
            <header>
              <div>
                <StatusChip
                  className={`attempt-status ${attemptStatusTone(selectedAttempt)}`}
                  size="sm"
                >
                  {selectedAttempt.status === 'running' ? (
                    <WorkingIndicator label={attemptStatus(selectedAttempt)} />
                  ) : (
                    attemptStatus(selectedAttempt)
                  )}
                </StatusChip>
                <strong>{selectedAttempt.responsibility}</strong>
                <small>{selectedAttempt.runId}</small>
              </div>
              <span>{selectedAttempt.application ?? 'responsibility process'}</span>
            </header>
            {selectedAttempt.summary && (
              <AppDisclosure
                className="attempt-summary"
                bodyClassName="attempt-summary__body"
                summary={
                  <span className="attempt-summary__heading">
                    <strong>Result summary</strong>
                    <small aria-hidden="true">{selectedAttempt.summary}</small>
                  </span>
                }
              >
                <p>{selectedAttempt.summary}</p>
              </AppDisclosure>
            )}
            <Suspense fallback={<MessageFeedSkeleton density="compact" />}>
              <UnifiedMessageFeed
                feedKey={`attempt:${selectedAttempt.runId}`}
                items={messages}
                tailActivity={selectedAttempt.status === 'running' ? 'working' : null}
                density="compact"
                className="attempt-message-feed"
                ariaLabel={`Attempt ${selectedAttempt.runId} message stream`}
                isLoading={eventStream.isLoading}
                hasMoreBefore={eventStream.hasMoreBefore}
                isLoadingOlder={eventStream.isLoadingOlder}
                onLoadOlder={eventStream.loadOlder}
                emptyState={
                  <div className="attempt-feed-empty">
                    This Attempt predates live event capture.
                  </div>
                }
              />
            </Suspense>
          </>
        )}
      </div>
    </section>
  )
}

function AttemptDiagnosticFacts({
  summary,
  diagnostics,
}: {
  summary: RunCostSummary | null
  diagnostics: RunAttemptDiagnostics | null
}) {
  if (!summary || !diagnostics) return null
  return (
    <>
      <span title="Selected Attempt elapsed wall time">
        <small>Attempt elapsed</small>
        <strong>{formatDuration(diagnostics.elapsedMs)}</strong>
        <em>
          {diagnostics.turns !== null
            ? `${diagnostics.turns} vendor turns`
            : `${diagnostics.modelMessages} model messages`}
        </em>
      </span>
      <span title="Vendor-reported input tokens; cached input is a reported subset">
        <small>Work tokens</small>
        <strong>
          {summary.runsWithTokenUsage > 0
            ? formatCompactNumber(summary.inputTokens)
            : 'Unavailable'}
        </strong>
        <em>{formatTokenCoverage(summary)}</em>
      </span>
      <span title="Unique normalized tool calls in this Attempt">
        <small>Attempt tools</small>
        <strong>{diagnostics.toolCalls}</strong>
        <em>{diagnostics.commandCalls} commands</em>
      </span>
      <span title="Attempt elapsed time outside paired tool intervals; includes model and runtime overhead">
        <small>Model / overhead</small>
        <strong>{formatDuration(diagnostics.modelAndOverheadWallTimeMs)}</strong>
        <em>{formatDuration(diagnostics.observedToolWallTimeMs)} observed tools</em>
      </span>
      <span title="Only shown when the selected vendor reports a monetary amount">
        <small>Vendor cost</small>
        <strong>
          {summary.runsWithVendorReportedCost > 0
            ? `$${summary.vendorReportedCostUsd.toFixed(4)}`
            : 'Unavailable'}
        </strong>
        <em>
          {summary.runsWithVendorReportedCost} / {summary.runs} Runs reported
        </em>
      </span>
    </>
  )
}

export function attemptStatus(attempt: RunAttemptSummary) {
  if (attempt.status === 'running') return 'working'
  if (attempt.application === 'stale') return 'stale'
  return attempt.result ?? attempt.status
}

export function attemptModelLabel(attempt: RunAttemptSummary | null) {
  if (!attempt) return 'not started'
  if (!attempt.execution) return 'not recorded'
  const model = attempt.execution.model ?? `${attempt.execution.transport} default`
  return attempt.execution.reasoningEffort
    ? `${model} · ${attempt.execution.reasoningEffort}`
    : model
}

export function attemptOutcomeBreakdown(attempts: RunAttemptSummary[]) {
  let rejected = 0
  let preparationFailed = 0
  let failed = 0
  let interrupted = 0

  for (const attempt of attempts) {
    if (attempt.status === 'interrupted') interrupted += 1
    else if (attempt.application === 'candidate_preparation_failed') preparationFailed += 1
    else if (attempt.result === 'reject') rejected += 1
    else if (attempt.result === 'fail') failed += 1
  }

  return { rejected, preparationFailed, failed, interrupted }
}

export function attemptOutcomeSummary(attempts: RunAttemptSummary[]) {
  const counts = attemptOutcomeBreakdown(attempts)
  const parts = [
    counts.rejected > 0 ? `${counts.rejected} rejected` : null,
    counts.preparationFailed > 0
      ? `${counts.preparationFailed} candidate preflight failed`
      : null,
    counts.failed > 0 ? `${counts.failed} failed` : null,
    counts.interrupted > 0 ? `${counts.interrupted} interrupted` : null,
  ].filter((part): part is string => part !== null)

  return parts.length > 0 ? parts.join(' · ') : 'Messages and tool activity'
}

export function executionCostHeadline(summary: RunCostSummary) {
  const modelActivity = summary.runsWithTurnCount
    ? `${summary.reportedTurns} turns`
    : `${summary.modelMessages} model messages`
  return `${summary.runs} Runs · ${modelActivity} · ${summary.toolCalls} tools · ${formatDuration(summary.elapsedMs)}`
}

function formatTokenCoverage(summary: RunCostSummary) {
  if (summary.runsWithTokenUsage === 0)
    return `Tokens unavailable · 0 / ${summary.runs} Runs reported`
  return `${formatCompactNumber(summary.cachedInputTokens)} cached · ${formatCompactNumber(summary.outputTokens)} output · ${summary.runsWithTokenUsage} / ${summary.runs} Runs reported`
}

function formatRunOutcomes(summary: RunCostSummary) {
  const parts = [
    summary.outcomes.rejected ? `${summary.outcomes.rejected} rejected` : null,
    summary.outcomes.preparationFailed
      ? `${summary.outcomes.preparationFailed} candidate preflight failed`
      : null,
    summary.outcomes.failed ? `${summary.outcomes.failed} failed` : null,
    summary.outcomes.interrupted ? `${summary.outcomes.interrupted} interrupted` : null,
    summary.outcomes.stale ? `${summary.outcomes.stale} stale` : null,
  ].filter((part): part is string => Boolean(part))
  return parts.length ? parts.join(' · ') : `${summary.outcomes.success} successful`
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat([], { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`
  const seconds = milliseconds / 1_000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const minutes = seconds / 60
  if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`
  const hours = minutes / 60
  return `${hours.toFixed(hours < 10 ? 1 : 0)}h`
}

function attemptStatusTone(attempt: RunAttemptSummary) {
  return attempt.application === 'stale' ? 'stale' : attempt.status
}

function formatAttemptTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function runEventId(event: { eventId: string }) {
  return event.eventId
}

function compareRunEvents(left: RunAttemptEvent, right: RunAttemptEvent) {
  if (left.streamIndex !== undefined && right.streamIndex !== undefined) {
    return left.streamIndex - right.streamIndex
  }
  return left.createdAt.localeCompare(right.createdAt) || left.eventId.localeCompare(right.eventId)
}
