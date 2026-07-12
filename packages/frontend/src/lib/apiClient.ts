import type {
  AssistantFeedEntry,
  AppSnapshot,
  CursorPage,
  GoalDetail,
  PreviewStartResult,
  ProjectCodingDefaults,
  ReflectionRunSummary,
  RunAttemptDetail,
  RunAttemptEvent,
  RunAttemptSummary,
} from './apiTypes'

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH'
  body?: unknown
}

export type GoalControl = 'pause' | 'resume' | 'cancel' | 'reopen'

export interface CursorPageRequest {
  before?: string
  after?: string
  limit?: number
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const formData = options.body instanceof FormData
  const response = await fetch(path, {
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
  const payload = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`)
  return payload
}

export function readState() {
  return apiRequest<AppSnapshot>('/api/state')
}

export function readAssistantFeed(input: CursorPageRequest = {}) {
  return apiRequest<CursorPage<AssistantFeedEntry>>(withPage('/api/assistant/feed', input))
}

export function readReflectionRuns(input: CursorPageRequest = {}) {
  return apiRequest<CursorPage<ReflectionRunSummary>>(
    withPage('/api/debug/reflections', input),
  )
}

export function readReflectionRunEvents(
  reflectionId: string,
  input: CursorPageRequest = {},
) {
  return apiRequest<CursorPage<RunAttemptEvent>>(
    withPage(`/api/debug/reflections/${encodeURIComponent(reflectionId)}/events`, input),
  )
}

export function readGoal(projectId: string, goalId: string) {
  return apiRequest<GoalDetail>(goalPath(projectId, goalId))
}

export function readWorkAttempts(projectId: string, goalId: string, workId: string) {
  return apiRequest<{ attempts: RunAttemptSummary[] }>(attemptPath(projectId, goalId, workId))
}

export function readWorkAttempt(
  projectId: string,
  goalId: string,
  workId: string,
  runId: string,
) {
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

export function createProject(input: { projectId?: string; repoPath: string; repoId?: string }) {
  return apiRequest<AppSnapshot>('/api/projects', { method: 'POST', body: input })
}

export function linkProjectRepo(
  projectId: string,
  input: { repoId: string; repoPath: string },
) {
  return apiRequest<AppSnapshot>(`/api/projects/${encodeURIComponent(projectId)}/repos`, {
    method: 'POST',
    body: input,
  })
}

export function rebindProject(projectId: string, repoPath: string) {
  return apiRequest<AppSnapshot>(`/api/projects/${encodeURIComponent(projectId)}/rebind`, {
    method: 'POST',
    body: { repoPath },
  })
}

export function rebindProjectRepo(projectId: string, repoId: string, repoPath: string) {
  return apiRequest<AppSnapshot>(
    `/api/projects/${encodeURIComponent(projectId)}/repos/${encodeURIComponent(repoId)}/rebind`,
    { method: 'POST', body: { repoPath } },
  )
}

export function updateProjectSettings(
  projectId: string,
  codingDefaults: ProjectCodingDefaults | null,
) {
  return apiRequest<AppSnapshot>(`/api/projects/${encodeURIComponent(projectId)}/settings`, {
    method: 'PATCH',
    body: { codingDefaults },
  })
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
  context?: { projectId: string; goalId: string; attentionId?: string }
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

export function requestPreviewRepair(prompt: string) {
  return apiRequest<{ eventId: string }>('/api/preview/repair', {
    method: 'POST',
    body: { prompt },
  })
}

function goalPath(projectId: string, goalId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/goals/${encodeURIComponent(goalId)}`
}

function attemptPath(projectId: string, goalId: string, workId: string) {
  return `${goalPath(projectId, goalId)}/works/${encodeURIComponent(workId)}/attempts`
}

function withPage(path: string, input: CursorPageRequest) {
  const query = new URLSearchParams()
  if (input.before) query.set('before', input.before)
  if (input.after) query.set('after', input.after)
  if (input.limit !== undefined) query.set('limit', String(input.limit))
  const suffix = query.toString()
  return suffix ? `${path}?${suffix}` : path
}
