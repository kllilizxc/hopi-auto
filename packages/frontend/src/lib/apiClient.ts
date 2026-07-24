import type {
  AppSnapshot,
  AssistantFeedChanges,
  AssistantFeedPage,
  ConfigurableAgentRole,
  CursorPage,
  GoalBoardDetail,
  GoalDetail,
  GoalDocsDetail,
  GoalDocumentView,
  GoalExecutionCost,
  PreviewStartResult,
  ProjectRebindPlan,
  ProjectCodingDefaults,
  ProjectDirectorySelection,
  ReflectionRunSummary,
  RunAttemptDetail,
  RunAttemptEvent,
  RunAttemptSummary,
  RunCostSummary,
  WorkDocumentView,
} from './apiTypes'

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH'
  body?: unknown
}

export type GoalControl = 'pause' | 'resume' | 'cancel' | 'reopen'

export interface CursorPageRequest {
  before?: string
  after?: string
  limit?: number
}

export interface AssistantScopeRequest {
  projectId?: string
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const formData = options.body instanceof FormData
  let response: Response
  try {
    response = await fetch(path, {
      method: options.method,
      headers:
        options.body === undefined || formData ? undefined : { 'content-type': 'application/json' },
      body:
        options.body === undefined
          ? undefined
          : formData
            ? (options.body as FormData)
            : JSON.stringify(options.body),
    })
  } catch {
    throw new Error('Cannot reach the HOPI backend. Check that it is running, then retry.')
  }
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`)
  return payload
}

export function readState() {
  return apiRequest<AppSnapshot>('/api/state')
}

export function readShellState() {
  return apiRequest<AppSnapshot>('/api/state?view=shell')
}

export function readAssistantFeed(input: CursorPageRequest & AssistantScopeRequest = {}) {
  return apiRequest<AssistantFeedPage>(withPage('/api/assistant/feed', input, input.projectId))
}

export function readAssistantFeedChanges(cursor: string | null, projectId?: string) {
  const query = new URLSearchParams()
  if (cursor) query.set('cursor', cursor)
  if (projectId) query.set('projectId', projectId)
  const suffix = query.toString()
  return apiRequest<AssistantFeedChanges>(
    `/api/assistant/feed/changes${suffix ? `?${suffix}` : ''}`,
  )
}

export function readReflectionRuns(input: CursorPageRequest = {}) {
  return apiRequest<CursorPage<ReflectionRunSummary>>(withPage('/api/debug/reflections', input))
}

export function readReflectionRunEvents(reflectionId: string, input: CursorPageRequest = {}) {
  return apiRequest<CursorPage<RunAttemptEvent>>(
    withPage(`/api/debug/reflections/${encodeURIComponent(reflectionId)}/events`, input),
  )
}

export function readGoal(projectId: string, goalId: string) {
  return apiRequest<GoalDetail>(goalPath(projectId, goalId))
}

export function readGoalBoard(projectId: string, goalId: string) {
  return apiRequest<GoalBoardDetail>(`${goalPath(projectId, goalId)}?view=board`)
}

export function readGoalExecutionCost(projectId: string, goalId: string) {
  return apiRequest<GoalExecutionCost>(`${goalPath(projectId, goalId)}/execution-cost`)
}

export function readGoalDocs(projectId: string, goalId: string) {
  return apiRequest<GoalDocsDetail>(`${goalPath(projectId, goalId)}?view=docs`)
}

export function readGoalDocument(projectId: string, goalId: string, path: string) {
  const params = new URLSearchParams({ path })
  return apiRequest<GoalDocumentView>(`${goalPath(projectId, goalId)}/documents?${params}`)
}

export function readWorkDocument(projectId: string, goalId: string, workId: string) {
  return apiRequest<WorkDocumentView>(
    `${goalPath(projectId, goalId)}/works/${encodeURIComponent(workId)}`,
  )
}

export function readWorkAttempts(projectId: string, goalId: string, workId: string) {
  return apiRequest<{ attempts: RunAttemptSummary[]; summary: RunCostSummary }>(
    attemptPath(projectId, goalId, workId),
  )
}

export function readWorkAttempt(projectId: string, goalId: string, workId: string, runId: string) {
  return apiRequest<RunAttemptDetail>(
    `${attemptPath(projectId, goalId, workId)}/${encodeURIComponent(runId)}`,
  )
}

export function readWorkAttemptEvents(
  projectId: string,
  goalId: string,
  workId: string,
  runId: string,
  input: CursorPageRequest = {},
) {
  return apiRequest<CursorPage<RunAttemptEvent>>(
    withPage(
      `${attemptPath(projectId, goalId, workId)}/${encodeURIComponent(runId)}/events`,
      input,
    ),
  )
}

export function createProject(input: {
  projectId?: string
  primaryRepoId: string
  repos: Array<{ repoId: string; repoPath: string; projectPath?: string }>
}) {
  return apiRequest<AppSnapshot>('/api/projects', { method: 'POST', body: input })
}

export function selectProjectDirectory() {
  return apiRequest<{ selection: ProjectDirectorySelection | null }>(
    '/api/system/select-directory',
    { method: 'POST' },
  ).catch((error: unknown) => {
    if (error instanceof Error && /404|not found/i.test(error.message)) {
      throw new Error(
        'The running backend does not provide directory selection. Stop stale HOPI backend processes, restart the backend, then retry.',
      )
    }
    throw error
  })
}

export function linkProjectRepo(
  projectId: string,
  input: { repoId: string; repoPath: string; projectPath?: string },
) {
  return apiRequest<AppSnapshot>(`/api/projects/${encodeURIComponent(projectId)}/repos`, {
    method: 'POST',
    body: input,
  })
}

export function rebindProject(projectId: string, repoPath: string, projectPath?: string) {
  return apiRequest<AppSnapshot>(`/api/projects/${encodeURIComponent(projectId)}/rebind`, {
    method: 'POST',
    body: { repoPath, ...(projectPath ? { projectPath } : {}) },
  })
}

export function rebindProjectRepo(
  projectId: string,
  repoId: string,
  repoPath: string,
  projectPath?: string,
) {
  return apiRequest<AppSnapshot>(
    `/api/projects/${encodeURIComponent(projectId)}/repos/${encodeURIComponent(repoId)}/rebind`,
    { method: 'POST', body: { repoPath, ...(projectPath ? { projectPath } : {}) } },
  )
}

export function planProjectRepoRebind(projectId: string, repoId: string, repoPath: string) {
  return apiRequest<ProjectRebindPlan>(
    `/api/projects/${encodeURIComponent(projectId)}/rebind/plan`,
    {
      method: 'POST',
      body: { repos: [{ repoId, repoPath }] },
    },
  )
}

export function rebindProjectRepos(
  projectId: string,
  repos: Array<{ repoId: string; repoPath: string; projectPath?: string }>,
) {
  return apiRequest<AppSnapshot>(`/api/projects/${encodeURIComponent(projectId)}/rebind`, {
    method: 'POST',
    body: { repos },
  })
}

export function updateAgentRoleSettings(
  role: ConfigurableAgentRole,
  codingDefaults: ProjectCodingDefaults | null,
) {
  return apiRequest<AppSnapshot>(`/api/agent-roles/${encodeURIComponent(role)}/settings`, {
    method: 'PATCH',
    body: { codingDefaults },
  })
}

export function updateProjectAgentAccess(projectId: string, fullAccess: boolean) {
  return apiRequest<{ projectId: string; fullAccess: boolean; configured: true }>(
    `/api/projects/${encodeURIComponent(projectId)}/agent-access`,
    { method: 'PUT', body: { fullAccess } },
  )
}

export function readProjectAgentAccess(projectId: string) {
  return apiRequest<{ projectId: string; fullAccess: boolean; configured: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/agent-access`,
  )
}

export function createGoal(
  projectId: string,
  input: { goalId?: string; title: string; objective: string; priority?: number },
) {
  return apiRequest<GoalDetail>(`/api/projects/${encodeURIComponent(projectId)}/goals`, {
    method: 'POST',
    body: input,
  })
}

export function sendInboxMessage(input: {
  content: string
  images?: File[]
  context?: {
    projectId?: string
    goalId?: string
    attentionId?: string
    attentionRefs?: string[]
    replyTo?: string
  }
}) {
  if (input.images?.length) {
    const form = new FormData()
    form.set('content', input.content)
    if (input.context) form.set('context', JSON.stringify(input.context))
    for (const image of input.images) form.append('images', image, image.name)
    return apiRequest<{ eventId: string; status: 'pending' | 'handled' }>('/api/inbox', {
      method: 'POST',
      body: form,
    })
  }
  return apiRequest<{ eventId: string; status: 'pending' | 'handled' }>('/api/inbox', {
    method: 'POST',
    body: { content: input.content, context: input.context },
  })
}

export function controlGoal(projectId: string, goalId: string, control: GoalControl) {
  return apiRequest<GoalDetail>(`${goalPath(projectId, goalId)}/${control}`, { method: 'POST' })
}

export function startPreview(projectId: string) {
  return apiRequest<PreviewStartResult>(
    `/api/projects/${encodeURIComponent(projectId)}/preview/start`,
    { method: 'POST' },
  )
}

export function stopPreview(projectId: string) {
  return apiRequest<{ session: unknown }>(
    `/api/projects/${encodeURIComponent(projectId)}/preview/stop`,
    { method: 'POST' },
  )
}

export function requestPreviewRepair(context: { projectId: string; goalId?: string }) {
  return apiRequest<{ eventId: string }>('/api/preview/repair', {
    method: 'POST',
    body: { context },
  })
}

function goalPath(projectId: string, goalId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/goals/${encodeURIComponent(goalId)}`
}

function attemptPath(projectId: string, goalId: string, workId: string) {
  return `${goalPath(projectId, goalId)}/works/${encodeURIComponent(workId)}/attempts`
}

function withPage(path: string, input: CursorPageRequest, projectId?: string) {
  const query = new URLSearchParams()
  if (input.before) query.set('before', input.before)
  if (input.after) query.set('after', input.after)
  if (input.limit !== undefined) query.set('limit', String(input.limit))
  if (projectId) query.set('projectId', projectId)
  const suffix = query.toString()
  return suffix ? `${path}?${suffix}` : path
}
