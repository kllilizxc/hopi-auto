import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Cpu,
  FolderGit2,
  Link2,
  Plus,
  Radio,
  RefreshCw,
  Settings2,
} from 'lucide-react'
import { useState } from 'react'
import {
  AppAlert,
  AppButton,
  AppCard,
  AppForm,
  AppInput,
  AppRouterLink,
  AppScrollShadow,
  AppSpinner,
  AppSurface,
  AppTextField,
  CountBadge,
  SelectField,
  StatusChip,
} from '../components/ui'
import {
  createProject,
  readState,
  rebindProject,
  updateProjectSettings,
  type CodingAgentTransport,
  type CodingReasoningEffort,
  type ProjectCodingDefaults,
  type ProjectSummary,
} from '../lib/api'
import { buildGoalRoute } from '../lib/goalScope'
import { excerpt } from '../lib/utils'

export function ProjectHomePage() {
  const queryClient = useQueryClient()
  const [repoPath, setRepoPath] = useState('')
  const [projectId, setProjectId] = useState('')
  const snapshotQuery = useQuery({
    queryKey: ['mvp-state'],
    queryFn: readState,
    refetchInterval: 2_000,
  })
  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: async () => {
      setRepoPath('')
      setProjectId('')
      await queryClient.invalidateQueries({ queryKey: ['mvp-state'] })
    },
  })

  return (
    <AppScrollShadow className="page-scroll">
      <div className="projects-page page-content">
        <header className="page-heading">
          <div>
            <span className="eyebrow">Workspace</span>
            <h1>Projects</h1>
            <p>Stable product context, managed release roots, and the Goals HOPI keeps moving.</p>
          </div>
          <StatusChip className="home-chip" size="sm">
            <Radio /> {snapshotQuery.data?.home.homeId ?? 'Loading home'}
          </StatusChip>
        </header>

        {(snapshotQuery.error || createMutation.error) && (
          <AppAlert className="error-banner">
            {(snapshotQuery.error as Error | null)?.message ?? createMutation.error?.message}
          </AppAlert>
        )}

        <section className="projects-grid">
          <AppSurface className="project-list-panel panel-card">
            <div className="panel-title">
              <span><FolderGit2 /> Linked projects</span>
              <CountBadge>{snapshotQuery.data?.projects.length ?? 0}</CountBadge>
            </div>
            <div className="project-cards">
              {snapshotQuery.isLoading ? (
                <div className="loading-state"><AppSpinner size="sm" /> Reading project documents</div>
              ) : snapshotQuery.data?.projects.length ? (
                snapshotQuery.data.projects.map((project) => (
                  <ProjectCard key={project.projectId} project={project} />
                ))
              ) : (
                <div className="empty-state">
                  <FolderGit2 />
                  <strong>No Project bound</strong>
                  <p>Link a Git repository. HOPI creates a managed release worktree without touching your checkout.</p>
                </div>
              )}
            </div>
          </AppSurface>

          <AppForm
            className="link-project-panel panel-card"
            onSubmit={(event) => {
              event.preventDefault()
              if (!repoPath.trim()) return
              createMutation.mutate({
                repoPath: repoPath.trim(),
                ...(projectId.trim() ? { projectId: projectId.trim() } : {}),
              })
            }}
          >
            <div className="panel-title"><span><Link2 /> Link repository</span></div>
            <p className="panel-intro">
              The selected path identifies the Repo. Canonical documents and Preview run from HOPI's managed integration root.
            </p>
            <AppTextField
              className="field"
              label="Repository path"
              onValueChange={setRepoPath}
              placeholder="/home/me/Code/product"
              value={repoPath}
            />
            <AppTextField
              className="field"
              label={<>Project ID <small>optional</small></>}
              onValueChange={setProjectId}
              placeholder="Derived when omitted"
              value={projectId}
            />
            <AppButton
              className="primary-button"
              type="submit"
              disabled={!repoPath.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? <AppSpinner size="sm" /> : <Plus />}
              Link Project
            </AppButton>
          </AppForm>
        </section>
      </div>
    </AppScrollShadow>
  )
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const queryClient = useQueryClient()
  const [showRebind, setShowRebind] = useState(false)
  const [showModelSettings, setShowModelSettings] = useState(false)
  const [nextPath, setNextPath] = useState(project.repoPath)
  const [modelDraft, setModelDraft] = useState(() => codingDefaultsToDraft(project.codingDefaults))
  const firstGoal = project.goals[0]
  const rebindMutation = useMutation({
    mutationFn: () => rebindProject(project.projectId, nextPath.trim()),
    onSuccess: async () => {
      setShowRebind(false)
      await queryClient.invalidateQueries({ queryKey: ['mvp-state'] })
    },
  })
  const settingsMutation = useMutation({
    mutationFn: (codingDefaults: ProjectCodingDefaults | null) =>
      updateProjectSettings(project.projectId, codingDefaults),
    onSuccess: async () => {
      setShowModelSettings(false)
      await queryClient.invalidateQueries({ queryKey: ['mvp-state'] })
    },
  })

  return (
    <AppCard className="project-card">
      <div className="project-card-top">
        <span className="project-initial">{project.projectId.slice(0, 2).toUpperCase()}</span>
        <div>
          <h2>{project.projectId}</h2>
          <p>{project.repoPath}</p>
        </div>
        <StatusChip className={`preview-status ${project.preview?.status ?? 'stopped'}`} size="sm">
          {project.preview?.stoppedReason === 'release_updated'
            ? 'stopped · release updated'
            : (project.preview?.status ?? 'preview off')}
        </StatusChip>
      </div>

      <div className="project-stats">
        <span><strong>{project.goals.length}</strong> Goals</span>
        <span><strong>{project.goals.filter((goal) => goal.lifecycle === 'active').length}</strong> Active</span>
        <span><strong>{project.goals.reduce((sum, goal) => sum + goal.openAttentionCount, 0)}</strong> Need you</span>
      </div>

      <p className="project-guidance">
        {excerpt(project.guidance ?? 'Planner will create AGENTS.md guidance on its first pass.', 170)}
      </p>

      <div className="project-model-row">
        <Cpu />
        <span>
          <small>{project.codingDefaultsInherited ? 'Home default' : 'Project default'}</small>
          <strong>{formatCodingDefaults(project.codingDefaults)}</strong>
        </span>
        <AppButton
          variant="ghost"
          type="button"
          onClick={() => {
            setModelDraft(codingDefaultsToDraft(project.codingDefaults))
            setShowModelSettings((value) => !value)
          }}
        >
          <Settings2 /> Configure
        </AppButton>
      </div>

      {showModelSettings && (
        <AppForm
          className="project-model-form"
          onSubmit={(event) => {
            event.preventDefault()
            settingsMutation.mutate(modelDraftToCodingDefaults(modelDraft))
          }}
        >
          <SelectField
            label="Agent"
            onValueChange={(transport) =>
              setModelDraft((current) => ({
                ...current,
                transport: transport as CodingAgentTransport,
              }))
            }
            options={[
              { label: 'Codex', value: 'codex' },
              { label: 'Claude', value: 'claude' },
              { label: 'OpenCode', value: 'opencode' },
            ]}
            value={modelDraft.transport}
          />
          <AppTextField
            label="Model"
            onValueChange={(model) =>
              setModelDraft((current) => ({ ...current, model }))
            }
            placeholder={modelDraft.transport === 'codex' ? 'gpt-5.4' : 'Provider default'}
            value={modelDraft.model}
          />
          {modelDraft.transport === 'codex' && (
            <SelectField
              label="Reasoning"
              onValueChange={(reasoningEffort) =>
                setModelDraft((current) => ({
                  ...current,
                  reasoningEffort: reasoningEffort as CodingReasoningEffort,
                }))
              }
              options={[
                { label: 'Low', value: 'low' },
                { label: 'Medium', value: 'medium' },
                { label: 'High', value: 'high' },
                { label: 'xHigh', value: 'xhigh' },
              ]}
              value={modelDraft.reasoningEffort}
            />
          )}
          <div className="project-model-actions">
            <AppButton
              className="text-button"
              variant="ghost"
              type="button"
              disabled={settingsMutation.isPending || project.codingDefaultsInherited}
              onClick={() => settingsMutation.mutate(null)}
            >
              Use Home default
            </AppButton>
            <AppButton
              className="secondary-button"
              type="submit"
              disabled={
                settingsMutation.isPending ||
                (modelDraft.transport === 'codex' && !modelDraft.model.trim())
              }
            >
              {settingsMutation.isPending ? <AppSpinner size="sm" /> : <Settings2 />}
              Save model
            </AppButton>
          </div>
        </AppForm>
      )}

      <div className="project-goal-list">
        {project.goals.length ? (
          project.goals.map((goal) => (
            <AppRouterLink
              key={goal.id}
              to={buildGoalRoute({ projectId: project.projectId, goalId: goal.id }, 'board')}
            >
              <span className={`goal-state-dot ${goal.lifecycle}`} />
              <span>
                <strong>{goal.title}</strong>
                <small>{goal.currentSummary}</small>
                <small>Next: {goal.nextSummary}</small>
              </span>
              {goal.openAttentionCount > 0 && <CountBadge color="warning">{goal.openAttentionCount}</CountBadge>}
              <ArrowRight />
            </AppRouterLink>
          ))
        ) : (
          <p>No Goals yet.</p>
        )}
      </div>

      {(rebindMutation.error || settingsMutation.error) && (
        <AppAlert className="inline-error">
          {rebindMutation.error?.message ?? settingsMutation.error?.message}
        </AppAlert>
      )}
      {showRebind && (
        <AppForm
          className="rebind-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (nextPath.trim()) rebindMutation.mutate()
          }}
        >
          <AppInput aria-label="New repository path" value={nextPath} onChange={(event) => setNextPath(event.target.value)} />
          <AppButton type="submit" disabled={!nextPath.trim() || rebindMutation.isPending}>
            {rebindMutation.isPending ? <AppSpinner size="sm" /> : <RefreshCw />} Rebind
          </AppButton>
        </AppForm>
      )}

      <div className="project-card-actions">
        <AppButton className="text-button" variant="ghost" type="button" onClick={() => setShowRebind((value) => !value)}>
          {showRebind ? 'Close rebind' : 'Repo moved?'}
        </AppButton>
        <AppRouterLink className="secondary-button" to={`/projects/${encodeURIComponent(project.projectId)}/goals/new`}>
          <Plus /> New Goal
        </AppRouterLink>
        {firstGoal && (
          <AppRouterLink
            className="primary-button compact"
            to={buildGoalRoute({ projectId: project.projectId, goalId: firstGoal.id }, 'board')}
          >
            Open <ArrowRight />
          </AppRouterLink>
        )}
      </div>
    </AppCard>
  )
}

interface CodingDefaultsDraft {
  transport: CodingAgentTransport
  model: string
  reasoningEffort: CodingReasoningEffort
}

function codingDefaultsToDraft(defaults: ProjectCodingDefaults): CodingDefaultsDraft {
  return {
    transport: defaults.transport,
    model: defaults.model ?? '',
    reasoningEffort: defaults.transport === 'codex' ? defaults.reasoningEffort : 'xhigh',
  }
}

function modelDraftToCodingDefaults(draft: CodingDefaultsDraft): ProjectCodingDefaults {
  const model = draft.model.trim()
  if (draft.transport === 'codex') {
    return {
      transport: 'codex',
      model,
      reasoningEffort: draft.reasoningEffort,
    }
  }
  return {
    transport: draft.transport,
    ...(model ? { model } : {}),
  }
}

function formatCodingDefaults(defaults: ProjectCodingDefaults) {
  const model = defaults.model ?? 'provider default'
  return defaults.transport === 'codex'
    ? `${model} · ${defaults.reasoningEffort}`
    : `${defaults.transport} · ${model}`
}
