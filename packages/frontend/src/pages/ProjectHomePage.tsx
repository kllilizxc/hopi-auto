import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Cpu,
  FolderGit2,
  FolderPlus,
  Link2,
  Plus,
  Radio,
  RefreshCw,
  Settings2,
  Star,
  X,
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
  type CodingAgentTransport,
  type CodingReasoningEffort,
  type ProjectCodingDefaults,
  type ProjectSummary,
  createProject,
  linkProjectRepo,
  readState,
  rebindProjectRepo,
  selectProjectDirectory,
  updateAssistantSettings,
  updateProjectSettings,
} from '../lib/api'
import { buildGoalRoute } from '../lib/goalScope'
import { excerpt } from '../lib/utils'

export function ProjectHomePage() {
  const queryClient = useQueryClient()
  const [repoDrafts, setRepoDrafts] = useState<ProjectRepoDraft[]>([])
  const [projectId, setProjectId] = useState('')
  const snapshotQuery = useQuery({
    queryKey: ['mvp-state'],
    queryFn: readState,
    refetchInterval: 2_000,
  })
  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: async () => {
      setRepoDrafts([])
      setProjectId('')
      await queryClient.invalidateQueries({ queryKey: ['mvp-state'] })
    },
  })
  const pickerMutation = useMutation({
    mutationFn: selectProjectDirectory,
    onSuccess: ({ path }) => {
      if (!path) return
      setRepoDrafts((current) => {
        if (current.some((repo) => repo.repoPath === path)) return current
        return [
          ...current,
          {
            key: crypto.randomUUID(),
            repoId: suggestedRepoId(path, current),
            repoPath: path,
            primary: current.length === 0,
          },
        ]
      })
    },
  })
  const primaryRepo = repoDrafts.find((repo) => repo.primary)
  const canCreate =
    Boolean(primaryRepo) &&
    repoDrafts.length > 0 &&
    repoDrafts.every((repo) => Boolean(repo.repoId.trim()))

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

        {(snapshotQuery.error || createMutation.error || pickerMutation.error) && (
          <AppAlert className="error-banner">
            {(snapshotQuery.error as Error | null)?.message ??
              createMutation.error?.message ??
              pickerMutation.error?.message}
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

          <div className="projects-side-column">
            {snapshotQuery.data && (
              <AssistantSettingsPanel
                defaults={snapshotQuery.data.home.assistantCodingDefaults}
                inherited={snapshotQuery.data.home.assistantCodingDefaultsInherited}
              />
            )}

            <AppForm
              className="link-project-panel panel-card"
              onSubmit={(event) => {
                event.preventDefault()
                if (!primaryRepo || !canCreate) return
                createMutation.mutate({
                  primaryRepoId: primaryRepo.repoId.trim(),
                  repos: repoDrafts.map((repo) => ({
                    repoId: repo.repoId.trim(),
                    repoPath: repo.repoPath,
                  })),
                  ...(projectId.trim() ? { projectId: projectId.trim() } : {}),
                })
              }}
            >
              <div className="panel-title">
                <span>
                  <Link2 /> Link project
                </span>
              </div>
              <p className="panel-intro">
                Select every Git repository in this Project, then choose the primary control Repo.
                HOPI keeps your checkouts untouched.
              </p>
              <div className="project-create-repos">
                {repoDrafts.length === 0 ? (
                  <div className="project-create-repos-empty">
                    <FolderGit2 />
                    <span>No repositories selected</span>
                  </div>
                ) : (
                  repoDrafts.map((repo) => (
                    <div className="project-create-repo" key={repo.key}>
                      <AppButton
                        aria-label={`Use ${repo.repoId || 'repository'} as primary`}
                        aria-pressed={repo.primary}
                        className={repo.primary ? 'project-primary active' : 'project-primary'}
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          setRepoDrafts((current) =>
                            current.map((candidate) => ({
                              ...candidate,
                              primary: candidate.key === repo.key,
                            })),
                          )
                        }
                      >
                        <Star />
                      </AppButton>
                      <span className="project-create-repo-copy">
                        <AppInput
                          aria-label={`Repository ID for ${repo.repoPath}`}
                          value={repo.repoId}
                          onChange={(event) =>
                            setRepoDrafts((current) =>
                              current.map((candidate) =>
                                candidate.key === repo.key
                                  ? { ...candidate, repoId: event.target.value }
                                  : candidate,
                              ),
                            )
                          }
                        />
                        <small title={repo.repoPath}>{repo.repoPath}</small>
                      </span>
                      {repo.primary && <small className="project-primary-label">Primary</small>}
                      <AppButton
                        aria-label={`Remove ${repo.repoId || 'repository'}`}
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          setRepoDrafts((current) => removeRepoDraft(current, repo.key))
                        }
                      >
                        <X />
                      </AppButton>
                    </div>
                  ))
                )}
                <AppButton
                  className="project-directory-picker"
                  type="button"
                  variant="ghost"
                  disabled={pickerMutation.isPending}
                  onClick={() => pickerMutation.mutate()}
                >
                  {pickerMutation.isPending ? <AppSpinner size="sm" /> : <FolderPlus />}
                  Select repository
                </AppButton>
              </div>
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
                disabled={!canCreate || createMutation.isPending || pickerMutation.isPending}
              >
                {createMutation.isPending ? <AppSpinner size="sm" /> : <Plus />}
                Link Project
              </AppButton>
            </AppForm>
          </div>
        </section>
      </div>
    </AppScrollShadow>
  )
}

interface ProjectRepoDraft {
  key: string
  repoId: string
  repoPath: string
  primary: boolean
}

function suggestedRepoId(path: string, current: ProjectRepoDraft[]) {
  const tail = path.split(/[\\/]/).filter(Boolean).at(-1) ?? 'repo'
  const base = tail.replaceAll(/[^A-Za-z0-9._-]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'repo'
  const used = new Set(current.map((repo) => repo.repoId))
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

function removeRepoDraft(current: ProjectRepoDraft[], key: string) {
  const removed = current.find((repo) => repo.key === key)
  const remaining = current.filter((repo) => repo.key !== key)
  if (!removed?.primary || remaining.length === 0) return remaining
  return remaining.map((repo, index) => ({ ...repo, primary: index === 0 }))
}

function AssistantSettingsPanel({
  defaults,
  inherited,
}: {
  defaults: ProjectCodingDefaults
  inherited: boolean
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(() => codingDefaultsToDraft(defaults))
  const settingsMutation = useMutation({
    mutationFn: updateAssistantSettings,
    onSuccess: async (snapshot) => {
      setDraft(codingDefaultsToDraft(snapshot.home.assistantCodingDefaults))
      await queryClient.invalidateQueries({ queryKey: ['mvp-state'] })
    },
  })

  return (
    <AppSurface className="assistant-settings-panel panel-card">
      <div className="panel-title">
        <span>
          <Cpu /> Assistant
        </span>
        <StatusChip size="sm">{inherited ? 'Coding default' : 'Custom'}</StatusChip>
      </div>
      <p className="panel-intro">
        Used for your conversation and background Reflection. Project coding agents stay separate.
      </p>
      <div className="assistant-settings-current">
        <small>Current model</small>
        <strong>{formatCodingDefaults(defaults)}</strong>
      </div>
      <AppForm
        className="assistant-settings-form"
        onSubmit={(event) => {
          event.preventDefault()
          settingsMutation.mutate(modelDraftToCodingDefaults(draft))
        }}
      >
        <SelectField
          label="Agent"
          onValueChange={(transport) =>
            setDraft((current) =>
              changeDraftTransport(current, transport as CodingAgentTransport),
            )
          }
          options={[
            { label: 'Codex', value: 'codex' },
            { label: 'Claude', value: 'claude' },
            { label: 'OpenCode', value: 'opencode' },
          ]}
          value={draft.transport}
        />
        <AppTextField
          label="Model"
          onValueChange={(model) => setDraft((current) => ({ ...current, model }))}
          placeholder={assistantModelPlaceholder(draft.transport)}
          value={draft.model}
        />
        {draft.transport === 'codex' && (
          <SelectField
            label="Reasoning"
            onValueChange={(reasoningEffort) =>
              setDraft((current) => ({
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
            value={draft.reasoningEffort}
          />
        )}
        <div className="assistant-settings-actions">
          <AppButton
            variant="ghost"
            type="button"
            disabled={settingsMutation.isPending || inherited}
            onClick={() => settingsMutation.mutate(null)}
          >
            Use coding default
          </AppButton>
          <AppButton
            className="secondary-button"
            type="submit"
            disabled={
              settingsMutation.isPending || (draft.transport === 'codex' && !draft.model.trim())
            }
          >
            {settingsMutation.isPending ? <AppSpinner size="sm" /> : <Settings2 />}
            Save
          </AppButton>
        </div>
      </AppForm>
      {settingsMutation.error && (
        <AppAlert className="inline-error">{settingsMutation.error.message}</AppAlert>
      )}
    </AppSurface>
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
          <strong>{project.openAttentionCount}</strong> Open attention
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
              setModelDraft((current) =>
                changeDraftTransport(current, transport as CodingAgentTransport),
              )
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
            onValueChange={(model) => setModelDraft((current) => ({ ...current, model }))}
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

function changeDraftTransport(
  draft: CodingDefaultsDraft,
  transport: CodingAgentTransport,
): CodingDefaultsDraft {
  return draft.transport === transport ? draft : { ...draft, transport, model: '' }
}

function formatCodingDefaults(defaults: ProjectCodingDefaults) {
  const model = defaults.model ?? 'provider default'
  return defaults.transport === 'codex'
    ? `${model} · ${defaults.reasoningEffort}`
    : `${defaults.transport} · ${model}`
}

function assistantModelPlaceholder(transport: CodingAgentTransport) {
  if (transport === 'codex') return 'gpt-5.4'
  if (transport === 'opencode') return 'provider/model'
  return 'Provider default'
}
