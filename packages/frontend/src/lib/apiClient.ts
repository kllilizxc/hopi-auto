import type {
  TodoBoard,
  GoalAttachmentRef,
  AssistantThreadEntry,
  GoalAssistantThread,
  GoalAssistantAttachmentUploadResult,
  AssistantRunSummary,
  MessageFeedPage,
  AgentRole,
  GoalWriteTraceEntry,
  GoalRunSummary,
  GoalRunDetail,
  GoalRunStepBundle,
  GoalAssistantRunDetail,
  GoalAssistantRunBundle,
  GoalDocsSnapshot,
  ProjectCodingDefaults,
  ProjectRecord,
  ProjectGoalSummary,
  LaneParallelism,
  AutomationStatus,
  ReconcileResult,
} from './apiTypes'

const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''
function apiUrl(path: string) {
  return configuredApiBase ? `${configuredApiBase}${path}` : path
}

function goalApiPath(goalKey: string, projectKey: string | undefined, suffix: string) {
  if (projectKey) {
    return `/api/projects/${encodeURIComponent(projectKey)}/goals/${encodeURIComponent(goalKey)}${suffix}`
  }

  return `/api/goals/${encodeURIComponent(goalKey)}${suffix}`
}

export function goalAssetUrl(goalKey: string, assetPath: string, projectKey?: string) {
  const normalized = assetPath.startsWith('assets/') ? assetPath.slice('assets/'.length) : assetPath
  const encodedPath = normalized
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return apiUrl(goalApiPath(goalKey, projectKey, `/assets/${encodedPath}`))
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init)
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(errorBody?.error ?? `Request failed with ${response.status}`)
  }

  return (await response.json()) as T
}

export function openGoalEventStream() {
  return new EventSource(apiUrl('/api/events'))
}

export function openGoalAssistantFeedStream(goalKey: string, projectKey?: string, after?: string) {
  const query = new URLSearchParams()
  if (after) {
    query.set('after', after)
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return new EventSource(
    apiUrl(`${goalApiPath(goalKey, projectKey, '/assistant/feed/stream')}${suffix}`),
  )
}

export function openGoalRunFeedStream(
  goalKey: string,
  runId: string,
  options?: {
    projectKey?: string
    stepId?: string | null
    after?: string
  },
) {
  const query = new URLSearchParams()
  if (options?.stepId) {
    query.set('stepId', options.stepId)
  }
  if (options?.after) {
    query.set('after', options.after)
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return new EventSource(
    apiUrl(
      `${goalApiPath(goalKey, options?.projectKey, `/runs/${encodeURIComponent(runId)}/feed/stream`)}${suffix}`,
    ),
  )
}

export function readProjects() {
  return apiRequest<{ projects: ProjectRecord[] }>('/api/projects')
}

export function createProject(input: {
  projectKey?: string
  name?: string
  rootDir: string
  codingDefaults?: ProjectCodingDefaults
}) {
  return apiRequest<ProjectRecord>('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function updateProjectSettings(
  projectKey: string,
  input: {
    codingDefaults?: ProjectCodingDefaults
  },
) {
  return apiRequest<ProjectRecord>(`/api/projects/${encodeURIComponent(projectKey)}/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function readProjectGoals(projectKey: string) {
  return apiRequest<{ projectKey: string; goals: ProjectGoalSummary[] }>(
    `/api/projects/${encodeURIComponent(projectKey)}/goals`,
  )
}

export function createProjectGoal(
  projectKey: string,
  input: {
    goalKey: string
    title: string
    objective: string
    successCriteria?: string[]
  },
) {
  return apiRequest<ProjectGoalSummary>(`/api/projects/${encodeURIComponent(projectKey)}/goals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function readGoalAutomation(projectKey: string, goalKey: string) {
  return apiRequest<{ status: AutomationStatus }>(
    `/api/projects/${encodeURIComponent(projectKey)}/goals/${encodeURIComponent(goalKey)}/automation`,
  )
}

export function startGoalAutomation(
  projectKey: string,
  goalKey: string,
  input: {
    maxSteps?: number
    maxParallel?: number
    laneParallelism?: Partial<LaneParallelism>
  } = {},
) {
  return apiRequest<{ status: AutomationStatus; alreadyRunning: boolean }>(
    `/api/projects/${encodeURIComponent(projectKey)}/goals/${encodeURIComponent(goalKey)}/start`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export function stopGoalAutomation(projectKey: string, goalKey: string) {
  return apiRequest<{ status: AutomationStatus }>(
    `/api/projects/${encodeURIComponent(projectKey)}/goals/${encodeURIComponent(goalKey)}/stop`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    },
  )
}

export function readGoalBoard(goalKey: string, projectKey?: string) {
  return apiRequest<TodoBoard>(goalApiPath(goalKey, projectKey, '/board'))
}

export function readGoalDocs(goalKey: string, projectKey?: string) {
  return apiRequest<GoalDocsSnapshot>(goalApiPath(goalKey, projectKey, '/docs'))
}

export async function readGoalAssistantThread(goalKey: string, projectKey?: string) {
  return apiRequest<GoalAssistantThread>(goalApiPath(goalKey, projectKey, '/assistant/thread'))
}

export async function readGoalAssistantFeed(
  goalKey: string,
  options?: {
    before?: string
    limit?: number
    projectKey?: string
  },
) {
  const query = new URLSearchParams()
  if (options?.before) {
    query.set('before', options.before)
  }
  if (typeof options?.limit === 'number') {
    query.set('limit', String(options.limit))
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return apiRequest<MessageFeedPage>(
    `${goalApiPath(goalKey, options?.projectKey, '/assistant/feed')}${suffix}`,
  )
}

export async function readGoalAssistantRuns(goalKey: string, projectKey?: string) {
  return apiRequest<{ goalKey: string; runs: AssistantRunSummary[] }>(
    goalApiPath(goalKey, projectKey, '/assistant/runs'),
  )
}

export async function readGoalRuns(goalKey: string, projectKey?: string) {
  return apiRequest<{ goalKey: string; runs: GoalRunSummary[] }>(
    goalApiPath(goalKey, projectKey, '/runs'),
  )
}

export async function readGoalRun(goalKey: string, runId: string, projectKey?: string) {
  return apiRequest<GoalRunDetail>(
    goalApiPath(goalKey, projectKey, `/runs/${encodeURIComponent(runId)}`),
  )
}

export async function readGoalRunStepBundle(
  goalKey: string,
  runId: string,
  stepId: string,
  projectKey?: string,
) {
  return apiRequest<GoalRunStepBundle>(
    goalApiPath(
      goalKey,
      projectKey,
      `/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/bundle`,
    ),
  )
}

export async function readGoalRunFeed(
  goalKey: string,
  runId: string,
  options?: {
    before?: string
    limit?: number
    stepId?: string | null
    projectKey?: string
  },
) {
  const query = new URLSearchParams()
  if (options?.before) {
    query.set('before', options.before)
  }
  if (typeof options?.limit === 'number') {
    query.set('limit', String(options.limit))
  }
  if (options?.stepId) {
    query.set('stepId', options.stepId)
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return apiRequest<MessageFeedPage>(
    `${goalApiPath(goalKey, options?.projectKey, `/runs/${encodeURIComponent(runId)}/feed`)}${suffix}`,
  )
}

export async function readGoalWriteTraces(
  goalKey: string,
  filters?: {
    taskRef?: string
    runId?: string
    stepId?: string
    role?: AgentRole
    limit?: number
  },
  projectKey?: string,
) {
  const query = new URLSearchParams()
  if (filters?.taskRef) {
    query.set('taskRef', filters.taskRef)
  }
  if (filters?.runId) {
    query.set('runId', filters.runId)
  }
  if (filters?.stepId) {
    query.set('stepId', filters.stepId)
  }
  if (filters?.role) {
    query.set('role', filters.role)
  }
  if (typeof filters?.limit === 'number') {
    query.set('limit', String(filters.limit))
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : ''

  return apiRequest<{ goalKey: string; entries: GoalWriteTraceEntry[] }>(
    `${goalApiPath(goalKey, projectKey, '/write-traces')}${suffix}`,
  )
}

export async function readGoalAssistantRun(
  goalKey: string,
  assistantRunId: string,
  projectKey?: string,
) {
  return apiRequest<GoalAssistantRunDetail>(
    goalApiPath(goalKey, projectKey, `/assistant/runs/${encodeURIComponent(assistantRunId)}`),
  )
}

export async function readGoalAssistantRunBundle(
  goalKey: string,
  assistantRunId: string,
  projectKey?: string,
) {
  return apiRequest<GoalAssistantRunBundle>(
    goalApiPath(
      goalKey,
      projectKey,
      `/assistant/runs/${encodeURIComponent(assistantRunId)}/bundle`,
    ),
  )
}

export async function appendGoalAssistantMessage(
  goalKey: string,
  input: { content: string; attachments?: GoalAttachmentRef[] },
  projectKey?: string,
) {
  return apiRequest<AssistantThreadEntry>(goalApiPath(goalKey, projectKey, '/assistant/messages'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      content: input.content,
      attachments: input.attachments ?? [],
    }),
  })
}

export async function runGoalAssistant(
  goalKey: string,
  input: {
    content: string
    images?: File[]
    attachments?: GoalAttachmentRef[]
    appendUserMessage?: boolean
  },
  projectKey?: string,
) {
  const path = goalApiPath(goalKey, projectKey, '/assistant/run')
  if (!input.images || input.images.length === 0) {
    return apiRequest<GoalAssistantRunDetail>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: input.content,
        attachments: input.attachments ?? [],
        appendUserMessage: input.appendUserMessage ?? true,
      }),
    })
  }

  const formData = new FormData()
  formData.set('content', input.content)
  formData.set('appendUserMessage', String(input.appendUserMessage ?? true))
  for (const image of input.images) {
    formData.append('images[]', image)
  }

  const response = await fetch(apiUrl(path), {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(errorBody?.error ?? `Request failed with ${response.status}`)
  }

  return (await response.json()) as GoalAssistantRunDetail
}

export async function uploadGoalAssistantImages(
  goalKey: string,
  images: File[],
  projectKey?: string,
) {
  const formData = new FormData()
  for (const image of images) {
    formData.append('images[]', image)
  }

  const response = await fetch(apiUrl(goalApiPath(goalKey, projectKey, '/assistant/attachments')), {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(errorBody?.error ?? `Request failed with ${response.status}`)
  }

  return (await response.json()) as GoalAssistantAttachmentUploadResult
}

export async function reconcileGoal(goalKey: string, projectKey?: string) {
  return apiRequest<ReconcileResult>(goalApiPath(goalKey, projectKey, '/reconcile'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
}
