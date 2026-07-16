import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  CirclePause,
  CirclePlay,
  ExternalLink,
  FileText,
  Inbox,
  MessageSquareText,
  Square,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useShell } from '../components/Layout'
import { UnifiedMessageFeed } from '../components/UnifiedMessageFeed'
import {
  AppAlert,
  AppButton,
  AppButtonGroup,
  AppDisclosure,
  AppLink,
  AppModal,
  AppRouterLink,
  AppScrollShadow,
  AppSpinner,
  AppTabs,
  CountBadge,
  IconButton,
  SelectField,
  StatusChip,
  WorkingIndicator,
} from '../components/ui'
import {
  type GoalControl,
  type KanbanColumn,
  type RunAttemptDetail,
  type RunAttemptEvent,
  type RunAttemptSummary,
  type WorkView,
  controlGoal,
  readGoal,
  readState,
  readWorkAttempt,
  readWorkAttemptEvents,
  readWorkAttempts,
  requestPreviewRepair,
  startPreview,
  stopPreview,
} from '../lib/api'
import { runEventsToMessageFeed } from '../lib/messageFeed'
import { useInfiniteMessageStream } from '../lib/useInfiniteMessageStream'
import { cn, excerpt, formatTime } from '../lib/utils'

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

export function BoardView() {
  const { projectId, goalId } = useParams()
  const queryClient = useQueryClient()
  const { openAssistant } = useShell()
  const [selectedWork, setSelectedWork] = useState<WorkView | null>(null)
  const [repairPrompt, setRepairPrompt] = useState<string | null>(null)
  const snapshotQuery = useQuery({
    queryKey: ['mvp-state'],
    queryFn: readState,
    refetchInterval: 2_000,
  })
  const goalQuery = useQuery({
    queryKey: ['mvp-goal', projectId, goalId],
    queryFn: () => readGoal(projectId ?? '', goalId ?? ''),
    enabled: Boolean(projectId && goalId),
    refetchInterval: 2_000,
  })

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['mvp-state'] }),
      queryClient.invalidateQueries({ queryKey: ['mvp-goal', projectId, goalId] }),
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
  })
  const previewStopMutation = useMutation({
    mutationFn: () => stopPreview(projectId ?? ''),
    onSuccess: refresh,
  })
  const previewRepairMutation = useMutation({
    mutationFn: () =>
      requestPreviewRepair(repairPrompt ?? '', {
        projectId: projectId ?? '',
        goalId: goalId ?? '',
      }),
    onSuccess: async () => {
      setRepairPrompt(null)
      await refresh()
      openAssistant()
    },
  })

  if (!projectId || !goalId) return <Navigate to="/projects" replace />
  const snapshot = snapshotQuery.data
  const project = snapshot?.projects.find((item) => item.projectId === projectId)
  const goal = goalQuery.data
  const error = snapshotQuery.error ?? goalQuery.error ?? controlMutation.error

  if (!goal && (snapshotQuery.isLoading || goalQuery.isLoading)) {
    return (
      <div className="full-loading">
        <AppSpinner size="sm" /> Loading canonical Goal
      </div>
    )
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
    (attention) => attention.target !== null && attention.resolvedAt === null,
  )
  const assistantAttention =
    openAssistantAttentions.find((attention) => attention.notifiedAt !== null) ??
    openAssistantAttentions[0]
  const assistantAttentionLabel = assistantAttention?.notifiedAt
    ? 'Needs you'
    : 'Waiting for Assistant'
  const projectAttention =
    goal.projectAttention?.resolvedAt === null ? goal.projectAttention : null
  const focus =
    goal.works.find((work) => work.projection.primaryBadge === 'Needs you') ??
    goal.works.find((work) => work.projection.primaryBadge === 'Waiting for Assistant') ??
    goal.works.find((work) => work.projection.primaryBadge === 'working') ??
    goal.works.find((work) => work.stage !== 'done' && work.stage !== 'cancelled')
  const cancelled = goal.works.filter((work) => work.projection.cancelled)
  const mutationError =
    previewStartMutation.error ?? previewStopMutation.error ?? previewRepairMutation.error

  const runControl = (control: GoalControl) => {
    controlMutation.mutate(control)
  }
  const closeWork = () => {
    const workId = selectedWork?.id
    setSelectedWork(null)
    window.setTimeout(() => {
      const trigger = workId
        ? document.querySelector<HTMLElement>(`[data-work-id="${CSS.escape(workId)}"]`)
        : null
      trigger?.focus({ preventScroll: true })
    }, 150)
  }

  return (
    <div className="board-page">
      <header className="board-header">
        <div className="goal-title-block">
          <div>
            <span className="eyebrow">
              {projectId} / {goalId}
            </span>
            <h1>{goal.goal.title}</h1>
          </div>
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
          <AppButtonGroup className="preview-compact-control" aria-label="Preview controls">
            {project.preview?.status === 'running' &&
              (project.preview.endpoint ? (
                <AppLink
                  className="preview-compact-open"
                  href={project.preview.endpoint}
                  target="_blank"
                  rel="noreferrer"
                  title="Open Preview"
                >
                  <span className="preview-dot running" /> Preview <ExternalLink />
                </AppLink>
              ) : (
                <span className="preview-compact-open">
                  <span className="preview-dot running" /> Preview
                </span>
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
                title={project.preview?.error ?? 'Start Preview'}
              >
                {previewStartMutation.isPending || project.preview?.status === 'starting' ? (
                  <AppSpinner size="sm" />
                ) : (
                  <CirclePlay />
                )}
                Preview
              </AppButton>
            )}
          </AppButtonGroup>
        </div>
      </header>

      {error && (
        <AppAlert className="error-banner board-error">{(error as Error).message}</AppAlert>
      )}

      {projectAttention && (
        <div className="attention-status-banner project-blocked-banner" role="status">
          <span>
            <AlertCircle />
          </span>
          <span>
            <strong>Project blocked</strong>
            <p>{excerpt(projectAttention.body, 360)}</p>
            <small>Created {formatTime(projectAttention.createdAt)}</small>
          </span>
        </div>
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
              ? assistantAttention.notifiedAt
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

      {assistantAttention && (
        <div className="attention-status-banner needs-you-banner" role="status">
          <span>
            <AlertCircle />
          </span>
          <span>
            <strong>{assistantAttentionLabel}</strong>
            <small>
              {assistantAttention.notifiedAt
                ? 'Reply in Assistant so work can continue.'
                : 'Assistant is reviewing the issue before deciding whether you need to act.'}
            </small>
          </span>
        </div>
      )}

      <AppScrollShadow className="kanban-scroll" orientation="horizontal">
        <div className="kanban-board">
          {COLUMNS.map((column) => {
            const works = goal.works.filter((work) => work.projection.column === column.id)
            return (
              <section
                className={`kanban-column column-${column.id.toLowerCase()}`}
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
                  {works.length ? (
                    works.map((work) => (
                      <WorkCard key={work.id} work={work} onOpen={() => setSelectedWork(work)} />
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
              <WorkCard key={work.id} work={work} onOpen={() => setSelectedWork(work)} />
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
function WorkCard({ work, onOpen }: { work: WorkView; onOpen: () => void }) {
  const badge = work.projection.primaryBadge ?? (work.stage === 'done' ? 'Done' : null)
  return (
    <AppButton
      className={cn('work-card', work.kind)}
      data-work-id={work.id}
      variant="ghost"
      type="button"
      onClick={(event) => {
        event.currentTarget.focus({ preventScroll: true })
        onOpen()
      }}
    >
      <div className="work-card-top">
        <span>{work.id}</span>
        {badge && (
          <StatusChip
            className={`work-badge badge-${badge.toLowerCase().replaceAll(' ', '-')}`}
            size="sm"
          >
            {badge === 'working' ? <WorkingIndicator label={badge} /> : badge}
          </StatusChip>
        )}
      </div>
      <h2>{work.title}</h2>
      <p>{excerpt(work.body)}</p>
      {work.repos && work.repos.length > 0 && (
        <div className="work-repos" aria-label="Repositories">
          {work.repos.map((repoId) => (
            <span key={repoId}>{repoId}</span>
          ))}
        </div>
      )}
      <div className="work-card-foot">
        <span>{work.projection.responsibility ?? work.stage}</span>
        <span>{work.attempts}/3 recovery</span>
      </div>
      {work.dependsOn.length > 0 && (
        <small className="depends-line">after {work.dependsOn.join(', ')}</small>
      )}
    </AppButton>
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
  work: WorkView
  onClose: () => void
}) {
  const [activePane, setActivePane] = useState<'activity' | 'contract'>('activity')
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null)
  const attemptsQuery = useQuery({
    queryKey: ['work-attempts', projectId, goalId, work.id],
    queryFn: () => readWorkAttempts(projectId, goalId, work.id),
    refetchInterval: 1_000,
  })
  const attempts = attemptsQuery.data?.attempts ?? []
  const selectedAttempt =
    attempts.find((attempt) => attempt.runId === selectedAttemptId) ?? attempts[0] ?? null
  const attemptQuery = useQuery({
    queryKey: ['work-attempt', projectId, goalId, work.id, selectedAttempt?.runId],
    queryFn: () => readWorkAttempt(projectId, goalId, work.id, selectedAttempt!.runId),
    enabled: Boolean(selectedAttempt) && activePane === 'contract',
    refetchInterval:
      activePane === 'contract' && selectedAttempt?.status === 'running' ? 1_000 : false,
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
              onSelectionChange={(key) => setActivePane(String(key) as 'activity' | 'contract')}
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
                  <AppTabs.ListContainer>
                    <AppTabs.List className="work-detail-tabs" aria-label="Work detail view">
                      <AppTabs.Tab id="activity">
                        <MessageSquareText /> Activity
                      </AppTabs.Tab>
                      <AppTabs.Tab id="contract">
                        <FileText /> Work contract
                      </AppTabs.Tab>
                    </AppTabs.List>
                  </AppTabs.ListContainer>
                  <AppModal.CloseTrigger className="icon-button" aria-label="Close Work detail">
                    <X />
                  </AppModal.CloseTrigger>
                </div>
              </header>
              <AppScrollShadow className="fact-grid work-fact-strip" orientation="horizontal">
                <span>
                  <small>Stage</small>
                  <strong>{work.stage}</strong>
                </span>
                <span>
                  <small>Responsibility</small>
                  <strong>{work.projection.responsibility ?? 'none'}</strong>
                </span>
                <span>
                  <small>Repositories</small>
                  <strong>{work.repos?.join(', ') ?? 'project docs'}</strong>
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
              </AppScrollShadow>
              <div className="work-detail-body">
                <AppTabs.Panel className="work-detail-tab-panel" id="activity">
                  {activePane === 'activity' ? (
                    <AttemptHistory
                      projectId={projectId}
                      goalId={goalId}
                      workId={work.id}
                      attempts={attempts}
                      selectedAttempt={selectedAttempt}
                      loading={attemptsQuery.isLoading}
                      error={attemptsQuery.error as Error | null}
                      onSelect={setSelectedAttemptId}
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
                      loading={attemptsQuery.isLoading || attemptQuery.isLoading}
                      error={(attemptsQuery.error ?? attemptQuery.error) as Error | null}
                      onSelect={setSelectedAttemptId}
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
  loading,
  error,
  onSelect,
}: {
  work: WorkView
  attempts: RunAttemptSummary[]
  selectedAttempt: RunAttemptSummary | null
  detail: RunAttemptDetail | null
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
        <pre>{work.body}</pre>
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
              <StatusChip className={`attempt-status ${attemptStatusTone(selectedAttempt)}`} size="sm">
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
  selectedAttempt,
  loading,
  error,
  onSelect,
}: {
  projectId: string
  goalId: string
  workId: string
  attempts: RunAttemptSummary[]
  selectedAttempt: RunAttemptSummary | null
  loading: boolean
  error: Error | null
  onSelect: (runId: string) => void
}) {
  const eventStream = useInfiniteMessageStream<RunAttemptEvent>({
    streamKey: selectedAttempt?.runId ?? 'no-attempt',
    queryKey: ['work-attempt-events', projectId, goalId, workId, selectedAttempt?.runId ?? null],
    readPage: (input) =>
      readWorkAttemptEvents(projectId, goalId, workId, selectedAttempt?.runId ?? '', input),
    getItemId: runEventId,
    compareItems: compareRunEvents,
    enabled: Boolean(selectedAttempt),
    refetchInterval: selectedAttempt?.status === 'running' ? 1_000 : false,
    tailPageSize: 200,
  })
  const messages = useMemo(() => {
    if (!selectedAttempt) return []
    const groupId = `attempt:${selectedAttempt.runId}`
    const next = runEventsToMessageFeed(eventStream.items, {
      namespace: groupId,
      groupId,
      active: selectedAttempt.status === 'running',
    })
    if (selectedAttempt.status === 'running') {
      next.push({
        id: `${groupId}:runtime-status`,
        createdAt: next.at(-1)?.createdAt ?? selectedAttempt.startedAt,
        kind: 'status',
        role: 'system',
        text: 'Agent is working',
        label: selectedAttempt.responsibility,
        groupId,
        pending: true,
      })
    }
    return next
  }, [eventStream.items, selectedAttempt])
  const streamError = error ?? eventStream.error
  const streamLoading = loading || eventStream.isLoading

  return (
    <section className="attempt-workspace">
      <aside className="attempt-sidebar">
        <div className="attempt-history-heading">
          <div>
            <h2>Attempts</h2>
            <p>Messages and tool activity</p>
          </div>
          <CountBadge>{attempts.length}</CountBadge>
        </div>

        {attempts.length > 0 ? (
          <AppScrollShadow className="attempt-tabs" orientation="auto">
            {attempts.map((attempt, index) => (
              <AppButton
                variant="ghost"
                aria-pressed={attempt.runId === selectedAttempt?.runId}
                className={attempt.runId === selectedAttempt?.runId ? 'active' : undefined}
                key={attempt.runId}
                type="button"
                onClick={() => onSelect(attempt.runId)}
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
          <div className="attempt-feed-empty">
            <AppSpinner size="sm" /> Loading Attempt
          </div>
        ) : !selectedAttempt ? (
          <div className="attempt-feed-empty">No Attempt has been recorded for this Work.</div>
        ) : (
          <>
            <header>
              <div>
                <StatusChip className={`attempt-status ${attemptStatusTone(selectedAttempt)}`} size="sm">
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
              <p className="attempt-summary">{selectedAttempt.summary}</p>
            )}
            <UnifiedMessageFeed
              feedKey={`attempt:${selectedAttempt.runId}`}
              items={messages}
              density="compact"
              className="attempt-message-feed"
              ariaLabel={`Attempt ${selectedAttempt.runId} message stream`}
              isLoading={eventStream.isLoading}
              hasMoreBefore={eventStream.hasMoreBefore}
              isLoadingOlder={eventStream.isLoadingOlder}
              onLoadOlder={eventStream.loadOlder}
              emptyState={
                <div className="attempt-feed-empty">This Attempt predates live event capture.</div>
              }
            />
          </>
        )}
      </div>
    </section>
  )
}

export function attemptStatus(attempt: RunAttemptSummary) {
  if (attempt.status === 'running') return 'working'
  if (attempt.application === 'stale') return 'stale'
  return attempt.result ?? attempt.status
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
