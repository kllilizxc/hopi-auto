import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRight,
  CirclePlay,
  Cpu,
  ExternalLink,
  FolderGit2,
  FolderPlus,
  Link2,
  Plus,
  Radio,
  RefreshCw,
  Settings2,
  Square,
  Star,
  Wrench,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useShell } from '../components/Layout'
import {
  AppAlert,
  AppButton,
  AppButtonGroup,
  AppCard,
  AppForm,
  AppInput,
  AppLink,
  AppRouterLink,
  AppScrollShadow,
  AppSpinner,
  AppSurface,
  AppSwitch,
  AppTextField,
  CountBadge,
  IconButton,
  SelectField,
  StatusChip,
} from '../components/ui'
import {
  type CodingAgentTransport,
  type CodingReasoningEffort,
  type ConfigurableAgentRole,
  type AgentRoleCodingSettings,
  type ProjectCodingDefaults,
  type ProjectDirectorySelection,
  type ProjectSummary,
  createProject,
  linkProjectRepo,
  planProjectRepoRebind,
  readShellState,
  readProjectAgentAccess,
  rebindProjectRepo,
  requestPreviewRepair,
  selectProjectDirectory,
  startPreview,
  stopPreview,
  updateAgentRoleSettings,
  updateProjectAgentAccess,
} from '../lib/api'
import { buildGoalRoute } from '../lib/goalScope'
import { readProjectAgentFullAccess, writeProjectAgentFullAccess } from '../lib/projectAgentAccess'
import { shellPollInterval, STABLE_QUERY_NOTIFY_PROPS } from '../lib/queryPerformance'
import { preloadBoardView, preloadGoalCreatePage } from '../routeModules'
import { excerpt, projectDisplayName } from '../lib/utils'

export function ProjectHomePage() {
  const queryClient = useQueryClient()
  const [repoDrafts, setRepoDrafts] = useState<ProjectRepoDraft[]>([])
  const [directoryNotice, setDirectoryNotice] = useState<string | null>(null)
  const pickerRequestActive = useRef(false)
  const snapshotQuery = useQuery({
    queryKey: ['mvp-state'],
    queryFn: readShellState,
    refetchInterval: shellPollInterval,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
  })
  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: async () => {
      setRepoDrafts([])
      setDirectoryNotice(null)
      await queryClient.invalidateQueries({ queryKey: ['mvp-state'] })
    },
  })
  const pickerMutation = useMutation({
    mutationFn: selectProjectDirectory,
    onSuccess: ({ selection }) => {
      if (!selection) return
      if (selection.kind === 'git_repository') {
        if (repoDrafts.some((repo) => repo.repoPath === selection.repoPath)) {
          setDirectoryNotice(
            `That Git repository is already selected. Remove it first if you want to use ${selection.path} as this Project's scope.`,
          )
          return
        }
        setDirectoryNotice(null)
        setRepoDrafts((current) => addRepoDraft(current, selection))
        return
      }
      if (selection.kind === 'empty_directory') {
        setDirectoryNotice(null)
        setRepoDrafts((current) => addRepoDraft(current, selection))
        return
      }
      setDirectoryNotice(
        `${selection.path} is not a Git repository and contains ${selection.entryCount} ${selection.entryCount === 1 ? 'item' : 'items'}. HOPI left it unchanged. Choose an empty folder or a folder inside an existing Git repository.`,
      )
    },
    onSettled: () => {
      pickerRequestActive.current = false
    },
  })
  const primaryRepo = repoDrafts.find((repo) => repo.primary)
  const canCreate =
    Boolean(primaryRepo) &&
    repoDrafts.length > 0 &&
    repoDrafts.every((repo) => Boolean(repo.repoId.trim()))

  return (
    <>
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

          {directoryNotice && (
            <AppAlert className="directory-notice" status="warning">
              <AlertTriangle />
              <span>{directoryNotice}</span>
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
                      Choose a Git repository, one of its subfolders, or an empty folder for a new
                      project. HOPI keeps your checkout untouched.
                    </p>
                  </div>
                )}
              </div>
            </AppSurface>

            <div className="projects-side-column">
              {snapshotQuery.data && (
                <AgentSettingsPanel settings={snapshotQuery.data.home.agentRoleCodingDefaults} />
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
                      projectPath: repo.projectPath,
                    })),
                  })
                }}
              >
                <div className="panel-title">
                  <span>
                    <Link2 /> Link project
                  </span>
                </div>
                <p className="panel-intro">
                  Choose the folders this Project uses. Its primary folder also names it.
                </p>
                <div className="project-create-repos">
                  {repoDrafts.map((repo) => (
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
                        <strong>{repo.repoId}</strong>
                        <small title={repo.displayPath}>{repo.displayPath}</small>
                      </span>
                      <span className="project-create-repo-badges">
                        {repo.projectPath !== '.' && (
                          <small className="project-scope-label">Subfolder</small>
                        )}
                        {repo.primary && <small className="project-primary-label">Primary</small>}
                      </span>
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
                  ))}
                  <AppButton
                    className="project-directory-picker"
                    type="button"
                    variant="ghost"
                    disabled={pickerMutation.isPending}
                    onClick={() => {
                      if (pickerRequestActive.current) return
                      pickerRequestActive.current = true
                      pickerMutation.reset()
                      setDirectoryNotice(null)
                      pickerMutation.mutate()
                    }}
                  >
                    {pickerMutation.isPending ? <AppSpinner size="sm" /> : <FolderPlus />}
                    {pickerMutation.isPending
                      ? 'Waiting for folder selection'
                      : repoDrafts.length > 0
                        ? 'Add another folder'
                        : 'Choose project folder'}
                  </AppButton>
                </div>
                <AppButton
                  className="primary-button"
                  type="submit"
                  disabled={
                    !canCreate ||
                    createMutation.isPending ||
                    pickerMutation.isPending
                  }
                >
                  {createMutation.isPending ? <AppSpinner size="sm" /> : <Plus />}
                  Link project
                </AppButton>
              </AppForm>
            </div>
          </section>
        </div>
      </AppScrollShadow>

    </>
  )
}

interface ProjectRepoDraft {
  key: string
  repoId: string
  repoPath: string
  projectPath: string
  displayPath: string
  primary: boolean
}

type LinkableProjectDirectorySelection = Extract<
  ProjectDirectorySelection,
  { kind: 'git_repository' | 'empty_directory' }
>

function addRepoDraft(
  current: ProjectRepoDraft[],
  selection: LinkableProjectDirectorySelection,
): ProjectRepoDraft[] {
  const repoPath = selection.kind === 'git_repository' ? selection.repoPath : selection.path
  const projectPath = selection.kind === 'git_repository' ? selection.projectPath : '.'
  if (current.some((repo) => repo.repoPath === repoPath)) return current
  return [
    ...current,
    {
      key: crypto.randomUUID(),
      repoId: suggestedRepoId(selection.path, current),
      repoPath,
      projectPath,
      displayPath: selection.path,
      primary: current.length === 0,
    },
  ]
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

const AGENT_ROLE_OPTIONS: Array<{ label: string; value: ConfigurableAgentRole }> = [
  { label: 'Assistant', value: 'assistant' },
  { label: 'Planner', value: 'planner' },
  { label: 'Generator', value: 'generator' },
  { label: 'Reviewer', value: 'reviewer' },
]

function AgentSettingsPanel({
  settings,
}: {
  settings: Record<ConfigurableAgentRole, AgentRoleCodingSettings>
}) {
  const queryClient = useQueryClient()
  const [role, setRole] = useState<ConfigurableAgentRole>('assistant')
  const selected = settings[role]
  const [draft, setDraft] = useState(() => codingDefaultsToDraft(settings.assistant.codingDefaults))
  const settingsMutation = useMutation({
    mutationFn: ({
      role,
      codingDefaults,
    }: {
      role: ConfigurableAgentRole
      codingDefaults: ProjectCodingDefaults | null
    }) => updateAgentRoleSettings(role, codingDefaults),
    onSuccess: async (snapshot, variables) => {
      setDraft(
        codingDefaultsToDraft(snapshot.home.agentRoleCodingDefaults[variables.role].codingDefaults),
      )
      await queryClient.invalidateQueries({ queryKey: ['mvp-state'] })
    },
  })

  return (
    <AppSurface className="assistant-settings-panel panel-card">
      <div className="panel-title">
        <span>
          <Cpu /> Agents
        </span>
        <StatusChip size="sm">{selected.inherited ? 'Default' : 'Custom'}</StatusChip>
      </div>
      <p className="panel-intro">
        Configure the Home-wide model used by each role. Projects share these settings.
      </p>
      <div className="assistant-settings-current">
        <small>
          {selected.inherited && role !== 'assistant' ? 'Home fallback' : 'Current model'}
        </small>
        <strong>{formatCodingDefaults(selected.codingDefaults)}</strong>
      </div>
      <AppForm
        className="assistant-settings-form"
        onSubmit={(event) => {
          event.preventDefault()
          settingsMutation.mutate({ role, codingDefaults: modelDraftToCodingDefaults(draft) })
        }}
      >
        <SelectField
          disabled={settingsMutation.isPending}
          label="Role"
          onValueChange={(value) => {
            const nextRole = value as ConfigurableAgentRole
            setRole(nextRole)
            setDraft(codingDefaultsToDraft(settings[nextRole].codingDefaults))
            settingsMutation.reset()
          }}
          options={AGENT_ROLE_OPTIONS}
          value={role}
        />
        <SelectField
          disabled={!selected.configurable}
          label="Agent"
          onValueChange={(transport) =>
            setDraft((current) => changeDraftTransport(current, transport as CodingAgentTransport))
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
          isDisabled={!selected.configurable}
          onValueChange={(model) => setDraft((current) => ({ ...current, model }))}
          placeholder={assistantModelPlaceholder(draft.transport)}
          value={draft.model}
        />
        {draft.transport === 'codex' && (
          <SelectField
            label="Reasoning"
            disabled={!selected.configurable}
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
            disabled={settingsMutation.isPending || selected.inherited || !selected.configurable}
            onClick={() => settingsMutation.mutate({ role, codingDefaults: null })}
          >
            Use default
          </AppButton>
          <AppButton
            className="secondary-button"
            type="submit"
            disabled={
              settingsMutation.isPending ||
              !selected.configurable ||
              (draft.transport === 'codex' && !draft.model.trim())
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
  const { openAssistant } = useShell()
  const projectName = projectDisplayName(project)
  const [showRepoManager, setShowRepoManager] = useState(false)
  const [editingRepoId, setEditingRepoId] = useState<string | null>(null)
  const [nextRepoPath, setNextRepoPath] = useState('')
  const [newRepoId, setNewRepoId] = useState('')
  const [newRepoPath, setNewRepoPath] = useState('')
  const [rebindPlanSummary, setRebindPlanSummary] = useState<string | null>(null)
  const [fullAgentAccess, setFullAgentAccess] = useState(() =>
    readProjectAgentFullAccess(project.projectId),
  )
  const [agentAccessError, setAgentAccessError] = useState<string | null>(null)
  const [agentAccessPending, setAgentAccessPending] = useState(false)
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
    mutationFn: async () => {
      const repoId = editingRepoId ?? ''
      const path = nextRepoPath.trim()
      const plan = await planProjectRepoRebind(project.projectId, repoId, path)
      setRebindPlanSummary(
        [plan.summary, ...plan.warnings].filter(Boolean).join(' '),
      )
      return rebindProjectRepo(project.projectId, repoId, path)
    },
    onSuccess: async () => {
      setEditingRepoId(null)
      setNextRepoPath('')
      await queryClient.invalidateQueries({ queryKey: ['mvp-state'] })
    },
  })
  const previewStartMutation = useMutation({
    mutationFn: () => startPreview(project.projectId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mvp-state'] })
    },
  })
  const previewStopMutation = useMutation({
    mutationFn: () => stopPreview(project.projectId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mvp-state'] })
    },
  })
  const previewRepairMutation = useMutation({
    mutationFn: () =>
      requestPreviewRepair({
        projectId: project.projectId,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mvp-state'] })
      openAssistant()
    },
  })

  useEffect(() => {
    let active = true
    void readProjectAgentAccess(project.projectId)
      .then(async (access) => {
        if (!active) return
        if (access.configured) {
          writeProjectAgentFullAccess(project.projectId, access.fullAccess)
          setFullAgentAccess(access.fullAccess)
          return
        }
        const localPreference = readProjectAgentFullAccess(project.projectId)
        await updateProjectAgentAccess(project.projectId, localPreference)
      })
      .catch((error: unknown) => {
        if (active) setAgentAccessError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      active = false
    }
  }, [project.projectId])

  const changeAgentAccess = async (next: boolean) => {
    writeProjectAgentFullAccess(project.projectId, next)
    setFullAgentAccess(next)
    setAgentAccessError(null)
    setAgentAccessPending(true)
    try {
      await updateProjectAgentAccess(project.projectId, next)
    } catch (error) {
      setAgentAccessError(error instanceof Error ? error.message : String(error))
    } finally {
      setAgentAccessPending(false)
    }
  }

  return (
    <AppCard className="project-card">
      <div className="project-card-top">
        <span className="project-initial">{projectName.slice(0, 2).toUpperCase()}</span>
        <div>
          <h2 title={project.projectId}>{projectName}</h2>
          <p>
            {project.primaryRepoId} · {scopedRepoPath(project.repoPath, project.projectPath)}
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

      <div className="project-preview-row">
        <small>Project Preview</small>
        <AppButtonGroup
          className="preview-compact-control project-preview-control"
          aria-label={`${projectName} Project Preview controls`}
        >
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
              aria-label={`Stop ${projectName} Preview`}
              title="Stop Project Preview"
            >
              {previewStopMutation.isPending ? <AppSpinner size="sm" /> : <Square />}
            </IconButton>
          ) : (
            <AppButton
              className="secondary-button preview-start-button"
              type="button"
              onClick={() => previewStartMutation.mutate()}
              disabled={
                previewStartMutation.isPending || project.preview?.status === 'starting'
              }
              title={project.preview?.error ?? 'Start Project Preview'}
            >
              {previewStartMutation.isPending || project.preview?.status === 'starting' ? (
                <AppSpinner size="sm" />
              ) : (
                <CirclePlay />
              )}
              Start
            </AppButton>
          )}
          {project.preview?.repair && project.preview.status === 'failed' && (
            <AppButton
              className="text-button"
              type="button"
              variant="ghost"
              onClick={() => previewRepairMutation.mutate()}
              disabled={previewRepairMutation.isPending}
            >
              {previewRepairMutation.isPending ? <AppSpinner size="sm" /> : <Wrench />}
              Ask Assistant
            </AppButton>
          )}
        </AppButtonGroup>
      </div>

      <p className="project-guidance">
        {excerpt(
          project.guidance ?? 'Planner will create AGENTS.md guidance on its first pass.',
          170,
        )}
      </p>

      <AppSwitch
        className="project-agent-access"
        isDisabled={agentAccessPending}
        isSelected={fullAgentAccess}
        onChange={(selected) => void changeAgentAccess(selected)}
      >
        <span>
          <strong>Full agent access</strong>
          <small>
            Let this Project's agents use your full local filesystem, commands, and network.
          </small>
        </span>
      </AppSwitch>

      <div className="project-repos">
        <div className="project-repos-heading">
          <span>Repositories</span>
          <strong>{project.repos.length}</strong>
        </div>
        {project.repos.map((repo) => (
          <div key={repo.repoId} className="project-repo-entry">
            <div className="project-repo-row">
              <span className="project-repo-id">{repo.repoId}</span>
              <span
                className="project-repo-path"
                title={scopedRepoPath(repo.repoPath, repo.projectPath)}
              >
                {scopedRepoPath(repo.repoPath, repo.projectPath)}
              </span>
              {repo.projectPath !== '.' && <small className="project-scope-label">subfolder</small>}
              {repo.primary && <small>primary</small>}
              {showRepoManager && (
                <AppButton
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    setEditingRepoId(repo.repoId)
                    setNextRepoPath(scopedRepoPath(repo.repoPath, repo.projectPath))
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

      <div className="project-goal-list">
        {project.goals.length ? (
          project.goals.map((goal) => (
            <AppRouterLink
              key={goal.id}
              to={buildGoalRoute({ projectId: project.projectId, goalId: goal.id }, 'board')}
              onFocus={preloadBoardView}
              onPointerDown={preloadBoardView}
              onPointerEnter={preloadBoardView}
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

      {(linkRepoMutation.error ||
        rebindRepoMutation.error ||
        previewStartMutation.error ||
        previewStopMutation.error ||
        previewRepairMutation.error ||
        agentAccessError) && (
        <AppAlert className="inline-error">
          {linkRepoMutation.error?.message ??
            rebindRepoMutation.error?.message ??
            previewStartMutation.error?.message ??
            previewStopMutation.error?.message ??
            previewRepairMutation.error?.message ??
            agentAccessError}
        </AppAlert>
      )}

      {rebindPlanSummary && !rebindRepoMutation.error && (
        <p className="project-scope-label">{rebindPlanSummary}</p>
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
          onFocus={preloadGoalCreatePage}
          onPointerDown={preloadGoalCreatePage}
          onPointerEnter={preloadGoalCreatePage}
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

const FALLBACK_CODING_DEFAULTS: ProjectCodingDefaults = {
  transport: 'codex',
  model: 'gpt-5.4',
  reasoningEffort: 'xhigh',
}

export function resolveCodingDefaults(defaults: ProjectCodingDefaults | undefined) {
  return defaults ?? FALLBACK_CODING_DEFAULTS
}

export function codingDefaultsToDraft(
  defaults: ProjectCodingDefaults | undefined,
): CodingDefaultsDraft {
  const resolved = resolveCodingDefaults(defaults)
  return {
    transport: resolved.transport,
    model: resolved.model ?? '',
    reasoningEffort: resolved.transport === 'codex' ? resolved.reasoningEffort : 'xhigh',
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

export function formatCodingDefaults(defaults: ProjectCodingDefaults | undefined) {
  const resolved = resolveCodingDefaults(defaults)
  const model = resolved.model ?? 'provider default'
  return resolved.transport === 'codex'
    ? `${model} · ${resolved.reasoningEffort}`
    : `${resolved.transport} · ${model}`
}

function assistantModelPlaceholder(transport: CodingAgentTransport) {
  if (transport === 'codex') return 'gpt-5.4'
  if (transport === 'opencode') return 'provider/model'
  return 'Provider default'
}

export function scopedRepoPath(repoPath: string, projectPath?: string) {
  if (!projectPath || projectPath === '.') return repoPath
  return `${repoPath.replace(/[\\/]+$/, '')}/${projectPath}`
}
