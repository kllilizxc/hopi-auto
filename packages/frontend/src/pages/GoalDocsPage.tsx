import { useQuery } from '@tanstack/react-query'
import { Bot, FileText, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import {
  AppAlert,
  AppButton,
  AppScrollShadow,
  AppSpinner,
  CountBadge,
  StatusChip,
} from '../components/ui'
import { readGoal, readState } from '../lib/api'
import { cn, excerpt, formatTime, projectDisplayName } from '../lib/utils'

const CONTRACT_KEY = '__goal_contract__'

export function GoalDocsPage() {
  const { projectId, goalId } = useParams()
  const [selectedDocument, setSelectedDocument] = useState(CONTRACT_KEY)
  const goalQuery = useQuery({
    queryKey: ['mvp-goal', projectId, goalId],
    queryFn: () => readGoal(projectId ?? '', goalId ?? ''),
    enabled: Boolean(projectId && goalId),
    refetchInterval: 2_000,
  })
  const snapshotQuery = useQuery({
    queryKey: ['mvp-state'],
    queryFn: readState,
    refetchInterval: 2_000,
  })

  useEffect(() => setSelectedDocument(CONTRACT_KEY), [projectId, goalId])

  if (!projectId || !goalId) return <Navigate to="/projects" replace />
  if (goalQuery.isLoading) return <div className="full-loading"><AppSpinner size="sm" /> Loading Goal documents</div>
  if (!goalQuery.data) {
    return <AppAlert className="full-error"><FileText /><h1>Documents unavailable</h1><p>{goalQuery.error?.message}</p></AppAlert>
  }

  const goal = goalQuery.data
  const project = snapshotQuery.data?.projects.find((item) => item.projectId === projectId)
  const selected =
    selectedDocument === CONTRACT_KEY
      ? { path: 'goal.md', content: goal.goal.body }
      : goal.design.find((document) => document.path === selectedDocument) ?? {
          path: 'goal.md',
          content: goal.goal.body,
        }

  return (
    <div className="docs-page">
      <header className="docs-header">
        <div>
          <span className="eyebrow">
            <span title={projectId}>{project ? projectDisplayName(project) : projectId}</span> /{' '}
            {goalId}
          </span>
          <h1>Goal Design</h1>
          <p>Canonical documents are the durable design and traceability surface.</p>
        </div>
      </header>

      {goalQuery.error && <AppAlert className="error-banner">{goalQuery.error.message}</AppAlert>}

      <div className="docs-layout">
        <AppScrollShadow className="docs-index" orientation="auto" aria-label="Documents">
          <div className="docs-index-heading"><FileText /><span>Documents</span></div>
          <AppButton className={cn(selectedDocument === CONTRACT_KEY && 'active')} variant="ghost" type="button" onClick={() => setSelectedDocument(CONTRACT_KEY)}>
            <strong>goal.md</strong>
            <small>Contract · revision {goal.goal.contractRevision}</small>
          </AppButton>
          {goal.design.map((document) => (
            <AppButton className={cn(selectedDocument === document.path && 'active')} variant="ghost" type="button" key={document.path} onClick={() => setSelectedDocument(document.path)}>
              <strong>{document.path.split('/').at(-1)}</strong>
              <small>{excerpt(document.content, 60) || 'Empty document'}</small>
            </AppButton>
          ))}
          {goal.design.length === 0 && <p>No design documents yet.</p>}
          <div className="docs-note">
            <Bot />
            <p>Tell Assistant what to change. It decides whether the instruction updates design only or also requires Planning and code.</p>
          </div>
        </AppScrollShadow>

        <AppScrollShadow className="document-reader" aria-label="Canonical document">
          <header>
            <div><small>Canonical document</small><h2>{selected.path}</h2></div>
            <StatusChip className={`lifecycle-pill ${goal.goal.lifecycle}`} size="sm">{goal.goal.lifecycle}</StatusChip>
          </header>
          <pre>{selected.content}</pre>
        </AppScrollShadow>

        <AppScrollShadow className="evidence-panel" aria-label="Evidence">
          <div className="docs-index-heading"><ShieldCheck /><span>Evidence</span><CountBadge>{goal.evidence.length}</CountBadge></div>
          {goal.evidence.length ? goal.evidence
            .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
            .map((evidence) => (
              <article key={evidence.id}>
                <div><strong>{evidence.id}</strong><time>{formatTime(evidence.createdAt)}</time></div>
                <p>{excerpt(evidence.body, 150)}</p>
                <small>{evidence.owner}{evidence.producerRun ? ` · ${evidence.producerRun}` : ''}</small>
              </article>
            )) : <p className="empty-copy">Evidence appears as passes complete.</p>}
        </AppScrollShadow>
      </div>
    </div>
  )
}
