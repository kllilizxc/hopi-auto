import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Cpu, FolderGit2, Link2, Plus, Radio, RefreshCw, Settings2 } from 'lucide-react'
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
  ComboBoxField,
  CountBadge,
  SelectField,
  StatusChip,
} from '../components/ui'
import {
  type CodingAgentTransport,
  type CodingReasoningEffort,
  type ProjectCodingDefaults,
  type ProjectSummary,
  createProject,
  linkProjectRepo,
  readState,
  rebindProjectRepo,
  updateProjectSettings,
} from '../lib/api'
import { buildGoalRoute } from '../lib/goalScope'
import { excerpt } from '../lib/utils'

const MODEL_OPTIONS: Record<string, { label: string; value: string }[]> = {
  codex: [
    { label: 'GPT-5.4', value: 'gpt-5.4' },
    { label: 'GPT-4o', value: 'gpt-4o' },
    { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
    { label: 'o1-preview', value: 'o1-preview' },
    { label: 'o1-mini', value: 'o1-mini' },
  ],
  claude: [
    { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
    { label: 'Claude 3.5 Haiku', value: 'claude-3-5-haiku-20241022' },
    { label: 'Claude 3 Opus', value: 'claude-3-opus-20240229' },
  ],
  opencode: [
    { label: 'Gemini 3.1 Pro Preview', value: 'gemini-proxy/gemini-3.1-pro-preview' },
    { label: 'Gemini 3.5 Flash', value: 'gemini-proxy/gemini-3.5-flash' },
    { label: 'Gemini 2.5 Flash', value: 'genai-gemini/gemini-2.5-flash' },
    { label: 'Gemini 2.5 Pro', value: 'genai-gemini/gemini-2.5-pro' },
    {
      label: 'AWS Claude 3.5 Sonnet',
      value: 'genai-claude/aws:anthropic.claude-sonnet-4-5-20250929-v1:0',
    },
  ],
}

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
              <span>
                <FolderGit2 /> Linked projects
              </span>
              <CountBadge>{snapshotQuery.data?.projects.length ?? 0}</CountBadge>
            </div>
            <div className="project-cards">
              {snapshotQuery.isLoading ? (
                <div className="loading-state">
                  <AppSpinner size="sm" /> Reading project documents
                </div>
              ) : snapshotQuery.data?.projects.length ? (
                snapshotQuery.data.projects.map((project) => (
                  <ProjectCard key={project.projectId} project={project} />
                ))
              ) : (
                <div className="empty-state">
                  <FolderGit2 />
                  <strong>No Project bound</strong>
                  <p>
                    Link a Git repository. HOPI creates a managed release worktree without touching
                    your checkout.
                  </p>
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
            <div className="panel-title">
              <span>
                <Link2 /> Link repository
              </span>
            </div>
            <p className="panel-intro">
              The selected path identifies the Repo. Canonical documents and Preview run from HOPI's
              managed integration root.
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
              label={
                <>
                  Project ID <small>optional</small>
                </>
              }
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
  const [showRepoManager, setShowRepoManager] = useState(false)
  const [editingRepoId, setEditingRepoId] = useState<string | null>(null)
  const [showModelSettings, setShowModelSettings] = useState(false)
  const [nextRepoPath, setNextRepoPath] = useState('')
  const [newRepoId, setNewRepoId] = useState('')
  const [newRepoPath, setNewRepoPath] = useState('')
  const [modelDraft, setModelDraft] = useState(() => codingDefaultsToDraft(project.codingDefaults))
  const firstGoal = project.goals[0]
  const linkRepoMutation = useMutation({
    mutationFn: () =>
      linkProjectRepo(project.projectId, {
        repoId: newRepoId.trim(),
        repoPath: newRepoPath.trim(),
      }),
    onSuccess: async () => {
      setNewRepoId('')
      setNewRepoPath('')
      await queryClient.invalidateQueries({ queryKey: ['mvp-state'] })
    },
  })
  const rebindRepoMutation = useMutation({
    mutationFn: () =>
      rebindProjectRepo(project.projectId, editingRepoId ?? '', nextRepoPath.trim()),
    onSuccess: async () => {
      setEditingRepoId(null)
      setNextRepoPath('')
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
          <p>
            {project.primaryRepoId} · {project.repoPath}
          </p>
        </div>
        <StatusChip className={`preview-status ${project.preview?.status ?? 'stopped'}`} size="sm">
          {project.preview?.stoppedReason === 'release_updated'
            ? 'stopped · release updated'
            : (project.preview?.status ?? 'preview off')}
        </StatusChip>
      </div>

      <div className="project-stats">
        <span>
          <strong>{project.goals.length}</strong> Goals
        </span>
        <span>
          <strong>{project.goals.filter((goal) => goal.lifecycle === 'active').length}</strong>{' '}
          Active
        </span>
        <span>
          <strong>{project.goals.reduce((sum, goal) => sum + goal.openAttentionCount, 0)}</strong>{' '}
          Waiting for Assistant
        </span>
      </div>

      <p className="project-guidance">
        {excerpt(
          project.guidance ?? 'Planner will create AGENTS.md guidance on its first pass.',
          170,
        )}
      </p>

      <div className="project-repos">
        <div className="project-repos-heading">
          <span>Repositories</span>
          <strong>{project.repos.length}</strong>
        </div>
        {project.repos.map((repo) => (
          <div key={repo.repoId} className="project-repo-entry">
            <div className="project-repo-row">
              <span className="project-repo-id">{repo.repoId}</span>
              <span className="project-repo-path" title={repo.repoPath}>
                {repo.repoPath}
              </span>
              {repo.primary && <small>primary</small>}
              {showRepoManager && (
                <AppButton
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    setEditingRepoId(repo.repoId)
                    setNextRepoPath(repo.repoPath)
                  }}
                >
                  <RefreshCw /> Rebind
                </AppButton>
              )}
            </div>
            {editingRepoId === repo.repoId && (
              <AppForm
                className="project-repo-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (nextRepoPath.trim()) rebindRepoMutation.mutate()
                }}
              >
                <AppInput
                  aria-label={`New path for ${repo.repoId}`}
                  value={nextRepoPath}
                  onChange={(event) => setNextRepoPath(event.target.value)}
                />
                <AppButton
                  type="submit"
                  disabled={!nextRepoPath.trim() || rebindRepoMutation.isPending}
                >
                  {rebindRepoMutation.isPending ? <AppSpinner size="sm" /> : <RefreshCw />}
                  Apply
                </AppButton>
              </AppForm>
            )}
          </div>
        ))}
        {showRepoManager && (
          <AppForm
            className="project-repo-form project-repo-link-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (newRepoId.trim() && newRepoPath.trim()) linkRepoMutation.mutate()
            }}
          >
            <AppInput
              aria-label="Repository ID"
              placeholder="api"
              value={newRepoId}
              onChange={(event) => setNewRepoId(event.target.value)}
            />
            <AppInput
              aria-label="Repository path"
              placeholder="/home/me/Code/product-api"
              value={newRepoPath}
              onChange={(event) => setNewRepoPath(event.target.value)}
            />
            <AppButton
              type="submit"
              disabled={!newRepoId.trim() || !newRepoPath.trim() || linkRepoMutation.isPending}
            >
              {linkRepoMutation.isPending ? <AppSpinner size="sm" /> : <Plus />}
              Link
            </AppButton>
          </AppForm>
        )}
      </div>

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
          <ComboBoxField
            label="Model"
            onInputChange={(model) => setModelDraft((current) => ({ ...current, model }))}
            options={MODEL_OPTIONS[modelDraft.transport] ?? []}
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
              {goal.openAttentionCount > 0 && (
                <CountBadge color="warning">{goal.openAttentionCount}</CountBadge>
              )}
              <ArrowRight />
            </AppRouterLink>
          ))
        ) : (
          <p>No Goals yet.</p>
        )}
      </div>

      {(linkRepoMutation.error || rebindRepoMutation.error || settingsMutation.error) && (
        <AppAlert className="inline-error">
          {linkRepoMutation.error?.message ??
            rebindRepoMutation.error?.message ??
            settingsMutation.error?.message}
        </AppAlert>
      )}

      <div className="project-card-actions">
        <AppButton
          className="text-button"
          variant="ghost"
          type="button"
          onClick={() => {
            setShowRepoManager((value) => !value)
            setEditingRepoId(null)
          }}
        >
          {showRepoManager ? 'Close repositories' : `Manage ${project.repos.length} repos`}
        </AppButton>
        <AppRouterLink
          className="secondary-button"
          to={`/projects/${encodeURIComponent(project.projectId)}/goals/new`}
        >
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
