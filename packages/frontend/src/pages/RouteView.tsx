import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CirclePause, CirclePlay, CloudFog, FileText, Flag, History } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useShell } from '../components/Layout'
import { PeerSwitcher } from '../components/PeerSwitcher'
import { ProjectPreviewControl } from '../components/ProjectPreviewControl'
import { AppAlert, AppButton, AppLoadingNotice, AppModal, AppRouterLink, StatusChip } from '../components/ui'
import {
  type GoalControl,
  type WorkRouteView,
  controlGoal,
  readGoalRoute,
  readShellState,
  requireGoalRouteDetail,
  startPreview,
  stopPreview,
} from '../lib/api'
import { buildGoalRoute, orderGoalsByRecency, readRecentGoals } from '../lib/goalScope'
import { goalRouteQueryKey } from '../lib/queryKeys'
import { STABLE_QUERY_NOTIFY_PROPS, routePollInterval, shellPollInterval } from '../lib/queryPerformance'
import { cn, excerpt, projectDisplayName } from '../lib/utils'
import { WorkDetailModal, workStateLabel, workSummary } from './route/WorkDetailModal'
import { layoutGoalRoute, routeEdgePath } from './route/routeLayout'

type HistoryKind = 'decision' | 'engineering'

export function RouteView() {
  const { projectId, goalId } = useParams()
  const queryClient = useQueryClient()
  const { openAssistant, selectGoal, warmGoal } = useShell()
  const [selectedWork, setSelectedWork] = useState<WorkRouteView | null>(null)
  const [selectedHistory, setSelectedHistory] = useState<HistoryKind | null>(null)
  const projectQuery = useQuery({
    queryKey: ['mvp-state'],
    queryFn: readShellState,
    enabled: Boolean(projectId),
    refetchInterval: shellPollInterval,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
    select: (snapshot) => snapshot.projects.find((item) => item.projectId === projectId) ?? null,
  })
  const goalQuery = useQuery({
    queryKey: goalRouteQueryKey(projectId, goalId),
    queryFn: () => readGoalRoute(projectId ?? '', goalId ?? ''),
    enabled: Boolean(projectId && goalId),
    refetchInterval: routePollInterval,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
    select: requireGoalRouteDetail,
  })
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['mvp-state'] }),
    queryClient.invalidateQueries({ queryKey: ['mvp-goal', projectId, goalId] }),
  ])
  const controlMutation = useMutation({
    mutationFn: (control: GoalControl) => controlGoal(projectId ?? '', goalId ?? '', control),
    onSuccess: refresh,
  })
  const previewStartMutation = useMutation({
    mutationFn: () => startPreview(projectId ?? ''),
    onSuccess: refresh,
    onError: refresh,
  })
  const previewStopMutation = useMutation({
    mutationFn: () => stopPreview(projectId ?? ''),
    onSuccess: refresh,
  })
  const layout = useMemo(
    () => goalQuery.data ? layoutGoalRoute(goalQuery.data.route) : null,
    [goalQuery.data],
  )

  if (!projectId || !goalId) return <Navigate to="/projects" replace />
  const project = projectQuery.data
  const goal = goalQuery.data
  const error = projectQuery.error ?? goalQuery.error ?? controlMutation.error
  if ((!goal || project === undefined) && (projectQuery.isLoading || goalQuery.isLoading)) {
    return <AppLoadingNotice detail="Deriving the current known route…" label="Loading Goal" />
  }
  if (!goal || !project || !layout) {
    return (
      <AppAlert className="full-error">
        <AlertCircle /><h1>Goal unavailable</h1>
        <p>{(error as Error | null)?.message ?? `${projectId} / ${goalId} was not found.`}</p>
        <AppRouterLink className="secondary-button" to="/projects">Back to Projects</AppRouterLink>
      </AppAlert>
    )
  }

  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]))
  const goalPeers = orderGoalsByRecency(project.goals, projectId, readRecentGoals(projectId)).map(
    (item) => ({ id: item.id, label: item.title }),
  )
  const workAttention = (workId: string) =>
    goal.attentions.find((attention) => attention.target?.endsWith(`/work:${workId}`)) ?? null
  const terminalWorks = selectedHistory
    ? goal.works.filter((work) => work.kind === selectedHistory && work.status === 'done')
    : []

  return (
    <div className="route-page">
      <header className="route-page-header">
        <div className="goal-title-block">
          <PeerSwitcher
            ariaLabel={`${projectDisplayName(project)} Goals`}
            items={goalPeers}
            label={<><span title={projectId}>{projectDisplayName(project)}</span> / Goals</>}
            moreAriaLabel="More Goals"
            onSelectionChange={selectGoal}
            onWarm={warmGoal}
            selectedKey={goalId}
            variant="headline"
          />
          <p>{excerpt(goal.goal.body, 220)}</p>
        </div>
        <div className="route-page-actions">
          {goal.goal.lifecycle === 'active' ? (
            <AppButton className="secondary-button goal-pause-button" disabled={controlMutation.isPending} onClick={() => controlMutation.mutate('pause')} type="button"><CirclePause /> Pause</AppButton>
          ) : goal.goal.lifecycle === 'paused' ? (
            <AppButton className="primary-button compact" disabled={controlMutation.isPending} onClick={() => controlMutation.mutate('resume')} type="button"><CirclePlay /> Resume</AppButton>
          ) : null}
          <ProjectPreviewControl
            ariaLabel="Project Preview"
            error={project.preview?.error}
            onStart={() => previewStartMutation.mutate()}
            onStop={() => previewStopMutation.mutate()}
            startLabel="Project Preview"
            startPending={previewStartMutation.isPending}
            status={project.preview?.status}
            stopPending={previewStopMutation.isPending}
            surfaces={project.preview?.surfaces}
          />
        </div>
      </header>

      {error ? <AppAlert className="error-banner route-error">{(error as Error).message}</AppAlert> : null}

      <section className="route-surface" aria-label="Current known route">
        <header className="route-surface-header">
          <div><span className="eyebrow">Current known route</span><h1>{goal.goal.title}</h1></div>
          <div className="route-overview">
            <StatusChip className={`lifecycle-pill ${goal.goal.lifecycle}`} size="sm">{goal.goal.lifecycle}</StatusChip>
            <span>{goal.route.completedDecisionCount + goal.route.completedEngineeringCount} completed</span>
            <span>{goal.works.filter((work) => work.status === 'open').length} ahead</span>
          </div>
        </header>

        <div className="route-viewport">
          <div className="route-canvas" style={{ width: layout.width, height: layout.height }}>
            <svg className="route-edges" width={layout.width} height={layout.height} aria-hidden="true">
              <defs><marker id="route-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" /></marker></defs>
              {layout.edges.map((edge) => {
                const from = nodeById.get(edge.from)
                const to = nodeById.get(edge.to)
                if (!from || !to) return null
                return <path className={edge.dashed ? 'dashed' : undefined} d={routeEdgePath(from, to)} key={`${edge.from}:${edge.to}`} markerEnd="url(#route-arrow)" />
              })}
            </svg>
            {goal.route.fogSummary ? (
              <AppRouterLink className="route-fog" to={buildGoalRoute({ projectId, goalId }, 'docs')}><CloudFog /><span><strong>Fog ahead</strong><small>{goal.route.fogSummary}</small></span></AppRouterLink>
            ) : null}
            {layout.nodes.map((node) => {
              const style = { left: node.x, top: node.y, width: node.width, minHeight: node.height }
              if (node.type === 'destination') {
                return <div className="route-destination" key={node.id} style={style}><Flag /><span><small>Destination</small><strong>{goal.route.destination.title}</strong></span></div>
              }
              if (node.type === 'history') {
                return <AppButton className={cn('route-node', 'history', node.historyKind)} key={node.id} onClick={() => setSelectedHistory(node.historyKind)} style={style} type="button" variant="ghost"><History /><span><small>{node.historyKind === 'decision' ? 'Decisions made' : 'Delivered'}</small><strong>{node.count} completed</strong><em>Open history</em></span></AppButton>
              }
              const work = node.work
              const attention = workAttention(work.id)
              const focused = work.id === goal.route.focusWorkId
              return (
                <AppButton
                  className={cn('route-node', 'work', `state-${work.projection.state}`, focused && 'focused')}
                  data-work-id={work.id}
                  key={node.id}
                  onClick={() => attention ? openAssistant(attention) : setSelectedWork(work)}
                  style={style}
                  type="button"
                  variant="ghost"
                >
                  <span className="route-node-status"><i />{workStateLabel(work.projection.state)}</span>
                  <strong>{work.title}</strong>
                  <small>{workSummary(work)}</small>
                </AppButton>
              )
            })}
          </div>
        </div>

        <footer className="route-legend">
          <div><span className="running"><i />Working</span><span className="ready"><i />Ready</span><span className="needs-user"><i />Needs you</span><span className="blocked"><i />Waiting</span></div>
          <span>Lines mean “must finish first” · layout is derived, never stored</span>
        </footer>
      </section>

      {selectedWork ? <WorkDetailModal projectId={projectId} goalId={goalId} work={selectedWork} onClose={() => setSelectedWork(null)} /> : null}
      {selectedHistory ? (
        <AppModal isOpen onOpenChange={(open) => !open && setSelectedHistory(null)}>
          <AppModal.Backdrop className="modal-backdrop" isDismissable variant="blur">
            <AppModal.Container className="route-history-modal-container" placement="center" scroll="inside" size="lg">
              <AppModal.Dialog className="route-history-modal" aria-label="Completed Work">
                <header><div><span className="eyebrow">Route history</span><AppModal.Heading>{selectedHistory === 'decision' ? 'Decisions made' : 'Delivered'}</AppModal.Heading></div><AppModal.CloseTrigger className="icon-button">×</AppModal.CloseTrigger></header>
                <div>{terminalWorks.map((work) => <AppButton key={work.id} onClick={() => { setSelectedHistory(null); setSelectedWork(work) }} type="button" variant="ghost"><FileText /><span><strong>{work.title}</strong><small>{work.id} · {work.runAttemptCount} Run{work.runAttemptCount === 1 ? '' : 's'}</small></span></AppButton>)}</div>
              </AppModal.Dialog>
            </AppModal.Container>
          </AppModal.Backdrop>
        </AppModal>
      ) : null}
    </div>
  )
}
