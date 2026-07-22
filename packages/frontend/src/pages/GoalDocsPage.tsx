import { useQuery } from '@tanstack/react-query'
import { Bot, FileText, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useShell } from '../components/Layout'
import { PeerSwitcher } from '../components/PeerSwitcher'
import {
  AppAlert,
  AppBreathingIndicator,
  AppButton,
  AppLoadingNotice,
  AppScrollShadow,
  CountBadge,
  StatusChip,
} from '../components/ui'
import { readGoalDocs, readGoalDocument, readShellState } from '../lib/api'
import {
  documentPollInterval,
  shellPollInterval,
  STABLE_QUERY_NOTIFY_PROPS,
} from '../lib/queryPerformance'
import { goalDocsQueryKey } from '../lib/queryKeys'
import { orderGoalsByRecency, readRecentGoals } from '../lib/goalScope'
import { cn, formatTime, projectDisplayName } from '../lib/utils'

const CONTRACT_KEY = '__goal_contract__'

export function GoalDocsPage() {
  const { projectId, goalId } = useParams()
  const { selectGoal, warmGoal } = useShell()
  const [selectedDocument, setSelectedDocument] = useState(CONTRACT_KEY)
  const goalQuery = useQuery({
    queryKey: goalDocsQueryKey(projectId, goalId),
    queryFn: () => readGoalDocs(projectId ?? '', goalId ?? ''),
    enabled: Boolean(projectId && goalId),
    refetchInterval: documentPollInterval,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
  })
  const projectQuery = useQuery({
    queryKey: ['mvp-state'],
    queryFn: readShellState,
    enabled: Boolean(projectId),
    refetchInterval: shellPollInterval,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
    select: (snapshot) => snapshot.projects.find((item) => item.projectId === projectId) ?? null,
  })
  const selectedDesign =
    goalQuery.data?.design.find((document) => document.path === selectedDocument) ?? null
  const documentQuery = useQuery({
    queryKey: [
      'goal-document',
      projectId,
      goalId,
      selectedDesign?.path,
      goalQuery.data?.goal.contractRevision,
    ],
    queryFn: () =>
      readGoalDocument(projectId ?? '', goalId ?? '', selectedDesign?.path ?? ''),
    enabled:
      Boolean(projectId && goalId && selectedDesign) && selectedDocument !== CONTRACT_KEY,
    staleTime: Number.POSITIVE_INFINITY,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
  })

  useEffect(() => setSelectedDocument(CONTRACT_KEY), [projectId, goalId])

  if (!projectId || !goalId) return <Navigate to="/projects" replace />
  if (goalQuery.isLoading)
    return (
      <AppLoadingNotice detail="Reading canonical documents…" label="Loading Goal" />
    )
  if (!goalQuery.data) {
    return (
      <AppAlert className="full-error">
        <FileText />
        <h1>Documents unavailable</h1>
        <p>{goalQuery.error?.message}</p>
      </AppAlert>
    )
  }

  const goal = goalQuery.data
  const project = projectQuery.data
  const selectedPath = selectedDesign?.path ?? 'goal.md'
  const selectedContent = selectedDesign ? documentQuery.data?.content : goal.goal.body
  const goalPeers = project
    ? orderGoalsByRecency(project.goals, projectId, readRecentGoals(projectId)).map((item) => ({
        id: item.id,
        label: item.title,
      }))
    : [{ id: goalId, label: goal.goal.title }]

  return (
    <div className="docs-page">
      <header className="docs-header">
        <div className="docs-title-block">
          <PeerSwitcher
            ariaLabel={`${project ? projectDisplayName(project) : projectId} Goals`}
            items={goalPeers}
            label={
              <>
                <span title={projectId}>{project ? projectDisplayName(project) : projectId}</span> /{' '}
                Goals
              </>
            }
            moreAriaLabel="More Goals"
            onSelectionChange={selectGoal}
            onWarm={warmGoal}
            selectedKey={goalId}
            variant="headline"
          />
          <p>Canonical documents are the durable design and traceability surface.</p>
        </div>
      </header>

      {goalQuery.error && <AppAlert className="error-banner">{goalQuery.error.message}</AppAlert>}

      <div className="docs-layout">
        <AppScrollShadow className="docs-index" orientation="auto" aria-label="Documents">
          <div className="docs-index-heading">
            <FileText />
            <span>Documents</span>
          </div>
          <AppButton
            className={cn(selectedDocument === CONTRACT_KEY && 'active')}
            variant="ghost"
            type="button"
            onClick={() => setSelectedDocument(CONTRACT_KEY)}
          >
            <strong>goal.md</strong>
            <small>Contract · revision {goal.goal.contractRevision}</small>
          </AppButton>
          {goal.design.map((document) => (
            <AppButton
              className={cn(selectedDocument === document.path && 'active')}
              variant="ghost"
              type="button"
              key={document.path}
              onClick={() => setSelectedDocument(document.path)}
            >
              <strong>{document.path.split('/').at(-1)}</strong>
              <small>{document.excerpt || 'Empty document'}</small>
            </AppButton>
          ))}
          {goal.design.length === 0 && <p>No design documents yet.</p>}
          <div className="docs-note">
            <Bot />
            <p>
              Tell Assistant what to change. It decides whether the instruction updates design only
              or also requires Planning and code.
            </p>
          </div>
        </AppScrollShadow>

        <AppScrollShadow className="document-reader" aria-label="Canonical document">
          <header>
            <div>
              <small>Canonical document</small>
              <h2>{selectedPath}</h2>
            </div>
            <StatusChip className={`lifecycle-pill ${goal.goal.lifecycle}`} size="sm">
              {goal.goal.lifecycle}
            </StatusChip>
          </header>
          {documentQuery.error ? (
            <AppAlert className="work-document-status error">
              {documentQuery.error.message}
            </AppAlert>
          ) : selectedDesign && documentQuery.isLoading ? (
            <div className="work-document-status" role="status">
              <AppBreathingIndicator /> Loading document
            </div>
          ) : (
            <pre>{selectedContent}</pre>
          )}
        </AppScrollShadow>

        <AppScrollShadow className="evidence-panel" aria-label="Evidence">
          <div className="docs-index-heading">
            <ShieldCheck />
            <span>Evidence</span>
            <CountBadge>{goal.evidence.length}</CountBadge>
          </div>
          {goal.evidence.length ? (
            goal.evidence
              .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
              .map((evidence) => (
                <article key={evidence.id}>
                  <div>
                    <strong>{evidence.id}</strong>
                    <time>{formatTime(evidence.createdAt)}</time>
                  </div>
                  <p>{evidence.excerpt}</p>
                  <small>
                    {evidence.owner}
                    {evidence.producerRun ? ` · ${evidence.producerRun}` : ''}
                  </small>
                </article>
              ))
          ) : (
            <p className="empty-copy">Evidence appears as passes complete.</p>
          )}
        </AppScrollShadow>
      </div>
    </div>
  )
}
