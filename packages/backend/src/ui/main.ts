import './index.css'

type TaskStatus = 'planned' | 'in_progress' | 'in_review' | 'merging' | 'done'
type RunStatus = 'active' | 'retryable' | 'completed' | 'blocked' | 'system_error'
type StepOutcome =
  | 'running'
  | 'success'
  | 'reject'
  | 'fail'
  | 'timeout'
  | 'merge_conflict'
  | 'system_error'

interface BlockerRef {
  kind: string
  ref: string
}

interface TaskItem {
  ref: string
  kind: 'planning' | 'engineering'
  status: TaskStatus
  title: string
  description: string
  acceptanceCriteria: string[]
  blockedBy: BlockerRef[]
}

interface TodoBoard {
  version: 1
  goal: {
    goalKey: string
    title: string
  }
  items: TaskItem[]
}

interface GoalDecision {
  decisionKey: string
  summary: string
  summaryKey?: string
  prompt?: string
  captureFormat?: string
  status: 'open' | 'resolved'
  taskRef?: string
  answer?: string
  createdAt: string
  resolvedAt?: string
}

interface CapturedAnswer {
  summary: string
  answerKey?: string
  summaryKey?: string
  prompt?: string
  captureFormat?: string
  answer: string
}

interface GoalPlanningRequest {
  requestKey: string
  workflowKey?: string
  workflowSharedDecisionRefs?: string[]
  workflowSharedAnswers?: CapturedAnswer[]
  workflowTaskKey?: string
  blockedByWorkflowKeys: string[]
  groupKey?: string
  groupTaskKey?: string
  title: string
  description: string
  acceptanceCriteria: string[]
  taskRef: string
  decisionRefs: string[]
  answers: CapturedAnswer[]
  requestedUpdates: string[]
  status: 'open' | 'resolved'
  createdAt: string
  resolvedAt?: string
  resolution?: string
}

interface GoalPlanningWorkflowPlanningState {
  kind: 'planning'
  workflowTaskKey?: string
  groupKey?: string
  blockedByWorkflowKeys: string[]
  request: GoalPlanningRequest
  blockerTaskRefs: string[]
}

interface GoalPlanningWorkflowPlanningBatchState {
  kind: 'planning_batch'
  groupKey: string
  blockedByWorkflowKeys: string[]
  requests: GoalPlanningRequest[]
  blockerTaskRefs: string[]
}

type GoalPlanningWorkflowLeafState =
  | GoalPlanningWorkflowPlanningState
  | GoalPlanningWorkflowPlanningBatchState

interface GoalPlanningWorkflowState {
  kind: 'workflow_batch'
  workflowKey: string
  workflowSharedDecisionRefs: string[]
  workflowSharedAnswers: CapturedAnswer[]
  workflows: GoalPlanningWorkflowLeafState[]
  groupKeys: string[]
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
}

interface GoalDocSnapshot {
  path: string
  content: string
  status: 'bootstrapped' | 'curated'
}

interface GoalDocsSnapshot {
  goalKey: string
  goal: GoalDocSnapshot
  design: GoalDocSnapshot
}

interface PreferenceEntry {
  preferenceKey: string
  status: 'active' | 'retired'
  summary: string
  rationale?: string
  retiredReason?: string
  supersededBy?: string
}

interface PreferenceDocument {
  path: string
  content: string
  entries: PreferenceEntry[]
}

interface RunSummary {
  runId: string
  taskRef: string
  taskKind: 'planning' | 'engineering'
  startedAt: string
  endedAt?: string
  status: RunStatus
  finalTaskStatus?: TaskStatus
  terminalOutcome?: StepOutcome
  stepCount: number
}

interface RunStepMessage {
  messageId: string
  createdAt: string
  kind: 'system' | 'info' | 'error'
  role: string
  content: string
}

interface RunTranscriptEntry {
  entryId: string
  createdAt: string
  transport: 'process' | 'codex' | 'claude' | 'opencode'
  kind: 'status' | 'assistant' | 'tool_call' | 'tool_result' | 'error'
  summary: string
  toolName?: string
  toolInvocationKey?: string
  vendorEventType?: string
}

interface RunArtifactRef {
  ref: string
  label: string
}

interface RunWorktreeRef {
  path: string
  branch?: string
  baseBranch?: string
}

interface RunStepExecution {
  worktree?: RunWorktreeRef
  artifacts: RunArtifactRef[]
}

interface WriteTraceChange {
  path: string
  kind: 'added' | 'modified' | 'deleted'
}

interface WriteTraceEntry {
  id: string
  timestamp: string
  goalKey: string
  runId: string
  stepId: string
  taskRef: string
  role: 'planner' | 'generator' | 'reviewer' | 'merger'
  agent: string
  cwd: string
  toolName: string
  callId: string
  targetPaths: string[]
  changes: WriteTraceChange[]
  argumentSummary: string
  resultSummary: string
}

interface RunStep {
  stepId: string
  role: 'planner' | 'generator' | 'reviewer' | 'merger'
  statusBefore: TaskStatus
  statusAfter?: TaskStatus
  startedAt: string
  endedAt?: string
  outcome: StepOutcome
  transcript: RunTranscriptEntry[]
  messages: RunStepMessage[]
  execution?: RunStepExecution
}

interface RunDetail {
  runId: string
  taskRef: string
  taskKind: 'planning' | 'engineering'
  startedAt: string
  endedAt?: string
  status: RunStatus
  finalTaskStatus?: TaskStatus
  terminalOutcome?: StepOutcome
  steps: RunStep[]
}

interface AssistantThreadEntry {
  entryId: string
  createdAt: string
  kind: 'user_message' | 'assistant_message' | 'action' | 'action_result'
  content?: string
  actionType?: string
  summary?: string
}

interface AssistantRunSummary {
  assistantRunId: string
  startedAt: string
  endedAt: string
  status: 'completed' | 'failed'
  message: string
  actionCount: number
}

interface AssistantAction {
  kind:
    | 'move_task'
    | 'create_planning_task'
    | 'request_planning'
    | 'request_planning_batch'
    | 'request_planning_workflows'
    | 'request_decision'
    | 'record_answer'
    | 'record_answers'
    | 'resolve_decision'
    | 'record_preference'
    | 'retire_preference'
    | 'update_preference'
  taskRef?: string
  status?: TaskStatus
  reason?: string
  title?: string
  description?: string
  acceptanceCriteria?: string[]
  decisionRefs?: string[]
  requestedUpdates?: string[]
  groupKey?: string
  groupTaskKey?: string
  workflowTaskKey?: string
  blockedByWorkflowKeys?: string[]
  requests?: Array<{
    taskKey: string
    requestKey?: string
    title: string
    description: string
    acceptanceCriteria: string[]
    requestedUpdates?: string[]
    blockedByTaskKeys?: string[]
  }>
  workflowKey?: string
  followThrough?: unknown
  decisionKey?: string
  decisionKeys?: string[]
  answers?: Array<{
    summary: string
    decisionKey?: string
    taskRef?: string
    answer?: string
  }>
  sourceResponse?: string
  summary?: string
  answer?: string
  content?: string
  reuseTaskRef?: string
  reuseGroupKey?: string
  preferenceKey?: string
  rationale?: string
  supersedes?: string[]
  supersededBy?: string
}

interface AssistantActionResult {
  kind:
    | 'move_task'
    | 'create_planning_task'
    | 'request_planning'
    | 'request_planning_batch'
    | 'request_planning_workflows'
    | 'request_decision'
    | 'record_answer'
    | 'record_answers'
    | 'resolve_decision'
    | 'record_preference'
    | 'retire_preference'
    | 'update_preference'
  taskRef?: string
  requestKey?: string
  taskRefs?: string[]
  requestKeys?: string[]
  groupKeys?: string[]
  workflowKey?: string
  workflowTaskKey?: string
  workflows?: Array<{
    kind: 'planning' | 'planning_batch'
    workflowTaskKey?: string
    groupKey?: string
    requestKeys: string[]
    taskRefs: string[]
    blockerTaskRefs: string[]
  }>
  blockerTaskRefs?: string[]
  groupKey?: string
  groupTaskKey?: string
  created?: boolean
  createdDecisionKeys?: string[]
  blockerRemoved?: boolean
  followThrough?: {
    kind: 'planning' | 'planning_batch' | 'workflow_batch'
    workflowKey?: string
    workflowTaskKey?: string
    groupKey?: string
    workflows?: Array<{
      kind: 'planning' | 'planning_batch'
      workflowTaskKey?: string
      groupKey?: string
      requestKeys: string[]
      taskRefs: string[]
      blockerTaskRefs: string[]
    }>
    groupKeys?: string[]
    requestKeys: string[]
    taskRefs: string[]
    blockerTaskRefs: string[]
  }
  status?: TaskStatus
  decisionKey?: string
  decisionKeys?: string[]
  preferenceKey?: string
  retiredPreferenceKeys?: string[]
  summary: string
}

interface AssistantEvent {
  kind: 'message' | 'transcript' | 'worktree_prepared' | 'artifact'
  level?: 'info' | 'error'
  role?: string
  content?: string
  summary?: string
  transport?: 'process' | 'codex' | 'claude' | 'opencode'
  entryKind?: 'status' | 'assistant' | 'tool_call' | 'tool_result' | 'error'
  path?: string
  branch?: string
  baseBranch?: string
  ref?: string
  label?: string
}

interface AssistantRunDetail {
  goalKey: string
  assistantRunId: string
  startedAt: string
  endedAt: string
  requestContent: string
  status: 'completed' | 'failed'
  message: string
  actions: AssistantAction[]
  actionResults: AssistantActionResult[]
  events: AssistantEvent[]
  error?: string
}

interface AssistantRunBundleFile {
  path: string
  content: string | null
}

interface AssistantRunBundle {
  goalKey: string
  assistantRunId: string
  context: AssistantRunBundleFile
  prompt: AssistantRunBundleFile
  outcome: AssistantRunBundleFile
  result: AssistantRunBundleFile
}

interface AppState {
  goalKey: string
  goalKeyInput: string
  assistantInput: string
  preferenceEditor: string
  preferenceContent: string
  preferenceEntries: PreferenceEntry[]
  preferenceDirty: boolean
  goalDocs: GoalDocsSnapshot | null
  planningWorkflows: GoalPlanningWorkflowState[]
  planningRequests: GoalPlanningRequest[]
  board: TodoBoard | null
  decisions: GoalDecision[]
  assistantThread: AssistantThreadEntry[]
  assistantRuns: AssistantRunSummary[]
  runs: RunSummary[]
  selectedRunId: string | null
  selectedRun: RunDetail | null
  selectedStepId: string | null
  selectedAssistantRunId: string | null
  selectedAssistantRun: AssistantRunDetail | null
  selectedAssistantBundle: AssistantRunBundle | null
  selectedRunWriteTraces: WriteTraceEntry[]
  loadingBoard: boolean
  loadingRun: boolean
  loadingAssistantRun: boolean
  runningAssistant: boolean
  savingPreferences: boolean
  reconcilingGoal: boolean
  lastReconcileSummary: string | null
  error: string | null
}

const STATUS_COLUMNS: Array<{ status: TaskStatus; label: string }> = [
  { status: 'planned', label: 'Planned' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'in_review', label: 'In Review' },
  { status: 'merging', label: 'Merging' },
  { status: 'done', label: 'Done' },
]

const rootElement = document.getElementById('app')

if (!rootElement) {
  throw new Error('Missing app root')
}

const root = rootElement

const params = new URLSearchParams(window.location.search)
const initialGoalKey = params.get('goal') ?? 'math-feature'

const state: AppState = {
  goalKey: initialGoalKey,
  goalKeyInput: initialGoalKey,
  assistantInput: '',
  preferenceEditor: '',
  preferenceContent: '',
  preferenceEntries: [],
  preferenceDirty: false,
  goalDocs: null,
  planningWorkflows: [],
  planningRequests: [],
  board: null,
  decisions: [],
  assistantThread: [],
  assistantRuns: [],
  runs: [],
  selectedRunId: null,
  selectedRun: null,
  selectedStepId: null,
  selectedAssistantRunId: null,
  selectedAssistantRun: null,
  selectedAssistantBundle: null,
  selectedRunWriteTraces: [],
  loadingBoard: true,
  loadingRun: false,
  loadingAssistantRun: false,
  runningAssistant: false,
  savingPreferences: false,
  reconcilingGoal: false,
  lastReconcileSummary: null,
  error: null,
}

let boardRequestId = 0
let runRequestId = 0
let assistantRunRequestId = 0

root.addEventListener('input', (event: Event) => {
  const target = event.target
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
    return
  }

  if (target.dataset.role === 'goal-key-input') {
    state.goalKeyInput = target.value
  }

  if (target.dataset.role === 'assistant-input') {
    state.assistantInput = target.value
  }

  if (target.dataset.role === 'preference-input') {
    state.preferenceEditor = target.value
    state.preferenceDirty = target.value !== state.preferenceContent
  }
})

root.addEventListener('submit', (event: SubmitEvent) => {
  const form = event.target
  if (!(form instanceof HTMLFormElement)) {
    return
  }

  if (form.dataset.role === 'assistant-form') {
    event.preventDefault()
    const trimmed = state.assistantInput.trim()
    if (!trimmed || state.runningAssistant) {
      return
    }

    state.runningAssistant = true
    state.error = null
    render()
    void runAssistant(trimmed)
    return
  }

  if (form.dataset.role === 'preference-form') {
    event.preventDefault()
    if (state.savingPreferences) {
      return
    }

    state.savingPreferences = true
    state.error = null
    render()
    void savePreferences(state.preferenceEditor)
    return
  }

  if (form.dataset.role === 'decision-create-form') {
    event.preventDefault()
    const formData = new FormData(form)
    const summary = `${formData.get('summary') ?? ''}`.trim()
    if (!summary) {
      return
    }

    state.error = null
    render()
    void createDecision(
      {
        decisionKey: `${formData.get('decisionKey') ?? ''}`.trim(),
        summary,
        prompt: `${formData.get('prompt') ?? ''}`.trim(),
        taskRef: `${formData.get('taskRef') ?? ''}`.trim(),
      },
      form,
    )
    return
  }

  if (form.dataset.role === 'planning-request-form') {
    event.preventDefault()
    const formData = new FormData(form)
    const groupKey = `${formData.get('groupKey') ?? ''}`.trim()
    const groupTaskKey = `${formData.get('groupTaskKey') ?? ''}`.trim()
    const title = `${formData.get('title') ?? ''}`.trim()
    const acceptanceCriteria = `${formData.get('acceptanceCriteria') ?? ''}`
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
    const decisionRefs = `${formData.get('decisionRefs') ?? ''}`
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
    const requestedUpdates = `${formData.get('requestedUpdates') ?? ''}`
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
    if (!title || acceptanceCriteria.length === 0) {
      return
    }

    state.error = null
    render()
    void createPlanningRequest(
      {
        requestKey: `${formData.get('requestKey') ?? ''}`.trim(),
        groupKey,
        groupTaskKey,
        title,
        description: `${formData.get('description') ?? ''}`.trim(),
        acceptanceCriteria,
        decisionRefs,
        requestedUpdates,
      },
      form,
    )
    return
  }

  if (form.dataset.role === 'decision-resolve-form') {
    event.preventDefault()
    const formData = new FormData(form)
    const decisionKey = `${formData.get('decisionKey') ?? ''}`.trim()
    const answer = `${formData.get('answer') ?? ''}`.trim()
    if (!decisionKey || !answer) {
      return
    }

    state.error = null
    render()
    void resolveDecision(decisionKey, answer, form)
    return
  }

  if (form.dataset.role !== 'goal-form') {
    return
  }

  event.preventDefault()
  const trimmed = state.goalKeyInput.trim()
  if (!trimmed) {
    return
  }

  const nextUrl = new URL(window.location.href)
  nextUrl.searchParams.set('goal', trimmed)
  window.history.replaceState({}, '', nextUrl)

  state.goalKey = trimmed
  state.board = null
  state.goalDocs = null
  state.planningRequests = []
  state.preferenceContent = ''
  state.preferenceEditor = ''
  state.preferenceDirty = false
  state.decisions = []
  state.assistantThread = []
  state.assistantRuns = []
  state.runs = []
  state.selectedRunId = null
  state.selectedRun = null
  state.selectedStepId = null
  state.selectedAssistantRunId = null
  state.selectedAssistantRun = null
  state.selectedAssistantBundle = null
  state.selectedRunWriteTraces = []
  state.error = null
  state.loadingBoard = true
  state.loadingRun = false
  state.loadingAssistantRun = false
  state.runningAssistant = false
  state.savingPreferences = false
  state.reconcilingGoal = false
  state.lastReconcileSummary = null
  render()
  void loadGoalData()
})

root.addEventListener('click', (event: MouseEvent) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) {
    return
  }

  const actionTarget = target.closest('[data-action]')
  if (!(actionTarget instanceof HTMLElement)) {
    return
  }

  if (!actionTarget) {
    return
  }

  if (actionTarget.dataset.action === 'select-run') {
    const runId = actionTarget.dataset.runId
    if (!runId || runId === state.selectedRunId) {
      return
    }

    state.selectedRunId = runId
    state.selectedStepId = null
    state.selectedRun = null
    state.loadingRun = true
    render()
    void loadSelectedRun()
  }

  if (actionTarget.dataset.action === 'select-step') {
    const stepId = actionTarget.dataset.stepId
    if (!stepId) {
      return
    }

    state.selectedStepId = stepId
    render()
  }

  if (actionTarget.dataset.action === 'select-assistant-run') {
    const assistantRunId = actionTarget.dataset.assistantRunId
    if (!assistantRunId || assistantRunId === state.selectedAssistantRunId) {
      return
    }

    state.selectedAssistantRunId = assistantRunId
    state.selectedAssistantRun = null
    state.selectedAssistantBundle = null
    state.loadingAssistantRun = true
    render()
    void loadSelectedAssistantRun()
  }

  if (actionTarget.dataset.action === 'reconcile-goal') {
    if (state.reconcilingGoal) {
      return
    }

    state.reconcilingGoal = true
    state.error = null
    render()
    void reconcileGoal()
  }
})

const eventSource = new EventSource('/api/events')
eventSource.onmessage = (event) => {
  const payload = JSON.parse(event.data) as { type?: string; goalKey?: string }
  if (
    (payload.type === 'board_changed' || payload.type === 'assistant_changed') &&
    payload.goalKey === state.goalKey
  ) {
    void loadGoalData()
    return
  }

  if (payload.type === 'decisions_changed' && payload.goalKey === state.goalKey) {
    void loadGoalData()
    return
  }

  if (payload.type === 'planning_requests_changed' && payload.goalKey === state.goalKey) {
    void loadGoalData()
    return
  }

  if (payload.type === 'preferences_changed') {
    void loadGoalData()
  }
}

window.addEventListener('beforeunload', () => {
  eventSource.close()
})

render()
void loadGoalData()

async function loadGoalData() {
  const requestId = ++boardRequestId
  state.loadingBoard = true
  state.error = null
  render()

  try {
    const [
      boardResponse,
      docsResponse,
      planningWorkflowsResponse,
      planningRequestsResponse,
      runsResponse,
      decisionsResponse,
      threadResponse,
      assistantRunsResponse,
      preferencesResponse,
    ] = await Promise.all([
      fetch(`/api/goals/${state.goalKey}/board`),
      fetch(`/api/goals/${state.goalKey}/docs`),
      fetch(`/api/goals/${state.goalKey}/planning-requests/workflows`),
      fetch(`/api/goals/${state.goalKey}/planning-requests`),
      fetch(`/api/goals/${state.goalKey}/runs`),
      fetch(`/api/goals/${state.goalKey}/decisions`),
      fetch(`/api/goals/${state.goalKey}/assistant/thread`),
      fetch(`/api/goals/${state.goalKey}/assistant/runs`),
      fetch('/api/preferences'),
    ])

    if (!boardResponse.ok) {
      throw new Error(`Board request failed with ${boardResponse.status}`)
    }
    if (!docsResponse.ok) {
      throw new Error(`Docs request failed with ${docsResponse.status}`)
    }
    if (!planningWorkflowsResponse.ok) {
      throw new Error(`Planning workflows failed with ${planningWorkflowsResponse.status}`)
    }
    if (!planningRequestsResponse.ok) {
      throw new Error(`Planning requests failed with ${planningRequestsResponse.status}`)
    }

    if (!runsResponse.ok) {
      throw new Error(`Runs request failed with ${runsResponse.status}`)
    }
    if (!decisionsResponse.ok) {
      throw new Error(`Decisions request failed with ${decisionsResponse.status}`)
    }
    if (!threadResponse.ok) {
      throw new Error(`Assistant thread request failed with ${threadResponse.status}`)
    }
    if (!assistantRunsResponse.ok) {
      throw new Error(`Assistant runs request failed with ${assistantRunsResponse.status}`)
    }
    if (!preferencesResponse.ok) {
      throw new Error(`Preferences request failed with ${preferencesResponse.status}`)
    }

    if (requestId !== boardRequestId) {
      return
    }

    state.board = (await boardResponse.json()) as TodoBoard
    state.goalDocs = (await docsResponse.json()) as GoalDocsSnapshot
    state.planningWorkflows = (
      (await planningWorkflowsResponse.json()) as { workflows: GoalPlanningWorkflowState[] }
    ).workflows
    state.planningRequests = (
      (await planningRequestsResponse.json()) as { requests: GoalPlanningRequest[] }
    ).requests
    state.runs = ((await runsResponse.json()) as { runs: RunSummary[] }).runs
    state.decisions = ((await decisionsResponse.json()) as { decisions: GoalDecision[] }).decisions
    state.assistantThread = (
      (await threadResponse.json()) as { entries: AssistantThreadEntry[] }
    ).entries
    state.assistantRuns = (
      (await assistantRunsResponse.json()) as { runs: AssistantRunSummary[] }
    ).runs
    const preferences = (await preferencesResponse.json()) as PreferenceDocument
    const canReplacePreferenceEditor =
      !state.preferenceDirty || state.preferenceEditor === state.preferenceContent
    state.preferenceContent = preferences.content
    state.preferenceEntries = preferences.entries
    if (canReplacePreferenceEditor) {
      state.preferenceEditor = preferences.content
      state.preferenceDirty = false
    }
    state.selectedRunId =
      state.runs.find((run) => run.runId === state.selectedRunId)?.runId ??
      state.runs[0]?.runId ??
      null
    state.selectedAssistantRunId =
      state.assistantRuns.find((run) => run.assistantRunId === state.selectedAssistantRunId)
        ?.assistantRunId ??
      state.assistantRuns[0]?.assistantRunId ??
      null
    state.loadingBoard = false

    if (state.selectedRunId || state.selectedAssistantRunId) {
      state.loadingRun = Boolean(state.selectedRunId)
      state.loadingAssistantRun = Boolean(state.selectedAssistantRunId)
      render()
      await Promise.all([loadSelectedRun(), loadSelectedAssistantRun()])
      return
    }

    state.selectedRun = null
    state.selectedStepId = null
    state.selectedAssistantRun = null
    state.selectedAssistantBundle = null
    state.selectedRunWriteTraces = []
    render()
  } catch (error) {
    if (requestId !== boardRequestId) {
      return
    }

    state.loadingBoard = false
    state.board = null
    state.goalDocs = null
    state.planningWorkflows = []
    state.planningRequests = []
    state.preferenceContent = ''
    state.preferenceEditor = ''
    state.preferenceEntries = []
    state.preferenceDirty = false
    state.decisions = []
    state.assistantThread = []
    state.assistantRuns = []
    state.runs = []
    state.selectedRun = null
    state.selectedRunId = null
    state.selectedStepId = null
    state.selectedAssistantRun = null
    state.selectedAssistantRunId = null
    state.selectedAssistantBundle = null
    state.selectedRunWriteTraces = []
    state.error = error instanceof Error ? error.message : String(error)
    render()
  }
}

async function loadSelectedRun() {
  if (!state.selectedRunId) {
    state.loadingRun = false
    state.selectedRun = null
    state.selectedStepId = null
    state.selectedRunWriteTraces = []
    render()
    return
  }

  const requestId = ++runRequestId

  try {
    const [runResponse, traceResponse] = await Promise.all([
      fetch(`/api/goals/${state.goalKey}/runs/${state.selectedRunId}`),
      fetch(
        `/api/goals/${state.goalKey}/write-traces?runId=${encodeURIComponent(state.selectedRunId)}`,
      ),
    ])
    if (!runResponse.ok) {
      throw new Error(`Run request failed with ${runResponse.status}`)
    }
    if (!traceResponse.ok) {
      throw new Error(`Write trace request failed with ${traceResponse.status}`)
    }

    if (requestId !== runRequestId) {
      return
    }

    state.selectedRun = (await runResponse.json()) as RunDetail
    state.selectedRunWriteTraces = (
      (await traceResponse.json()) as { entries: WriteTraceEntry[] }
    ).entries
    state.selectedStepId =
      state.selectedRun.steps.find((step) => step.stepId === state.selectedStepId)?.stepId ??
      state.selectedRun.steps.at(-1)?.stepId ??
      null
    state.loadingRun = false
    render()
  } catch (error) {
    if (requestId !== runRequestId) {
      return
    }

    state.loadingRun = false
    state.selectedRun = null
    state.selectedStepId = null
    state.selectedRunWriteTraces = []
    state.error = error instanceof Error ? error.message : String(error)
    render()
  }
}

async function loadSelectedAssistantRun() {
  if (!state.selectedAssistantRunId) {
    state.loadingAssistantRun = false
    state.selectedAssistantRun = null
    state.selectedAssistantBundle = null
    render()
    return
  }

  const requestId = ++assistantRunRequestId

  try {
    const [runResponse, bundleResponse] = await Promise.all([
      fetch(`/api/goals/${state.goalKey}/assistant/runs/${state.selectedAssistantRunId}`),
      fetch(`/api/goals/${state.goalKey}/assistant/runs/${state.selectedAssistantRunId}/bundle`),
    ])
    if (!runResponse.ok) {
      throw new Error(`Assistant run request failed with ${runResponse.status}`)
    }
    if (!bundleResponse.ok) {
      throw new Error(`Assistant bundle request failed with ${bundleResponse.status}`)
    }

    if (requestId !== assistantRunRequestId) {
      return
    }

    state.selectedAssistantRun = (await runResponse.json()) as AssistantRunDetail
    state.selectedAssistantBundle = (await bundleResponse.json()) as AssistantRunBundle
    state.loadingAssistantRun = false
    render()
  } catch (error) {
    if (requestId !== assistantRunRequestId) {
      return
    }

    state.loadingAssistantRun = false
    state.selectedAssistantRun = null
    state.selectedAssistantBundle = null
    state.error = error instanceof Error ? error.message : String(error)
    render()
  }
}

async function runAssistant(content: string) {
  try {
    const response = await fetch(`/api/goals/${state.goalKey}/assistant/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(errorBody?.error ?? `Assistant request failed with ${response.status}`)
    }

    const result = (await response.json()) as AssistantRunDetail
    state.assistantInput = ''
    state.selectedAssistantRunId = result.assistantRunId
    await loadGoalData()
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
    render()
  } finally {
    state.runningAssistant = false
    render()
  }
}

async function savePreferences(content: string) {
  try {
    const response = await fetch('/api/preferences', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(errorBody?.error ?? `Preference update failed with ${response.status}`)
    }

    const result = (await response.json()) as PreferenceDocument
    state.preferenceContent = result.content
    state.preferenceEditor = result.content
    state.preferenceEntries = result.entries
    state.preferenceDirty = false
    render()
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
    render()
  } finally {
    state.savingPreferences = false
    render()
  }
}

async function createDecision(
  input: {
    decisionKey: string
    summary: string
    prompt: string
    taskRef: string
  },
  form: HTMLFormElement,
) {
  try {
    const response = await fetch(`/api/goals/${state.goalKey}/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        decisionKey: input.decisionKey || undefined,
        summary: input.summary,
        prompt: input.prompt || undefined,
        taskRef: input.taskRef || undefined,
      }),
    })
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(errorBody?.error ?? `Decision create failed with ${response.status}`)
    }

    form.reset()
    await loadGoalData()
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
    render()
  }
}

async function createPlanningRequest(
  input: {
    requestKey: string
    groupKey: string
    groupTaskKey: string
    title: string
    description: string
    acceptanceCriteria: string[]
    decisionRefs: string[]
    requestedUpdates: string[]
  },
  form: HTMLFormElement,
) {
  try {
    const response = await fetch(`/api/goals/${state.goalKey}/planning-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestKey: input.requestKey || undefined,
        groupKey: input.groupKey || undefined,
        groupTaskKey: input.groupTaskKey || undefined,
        title: input.title,
        description: input.description,
        acceptanceCriteria: input.acceptanceCriteria,
        decisionRefs: input.decisionRefs,
        requestedUpdates: input.requestedUpdates,
      }),
    })
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(errorBody?.error ?? `Planning request create failed with ${response.status}`)
    }

    form.reset()
    await loadGoalData()
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
    render()
  }
}

async function resolveDecision(decisionKey: string, answer: string, form: HTMLFormElement) {
  try {
    const response = await fetch(`/api/goals/${state.goalKey}/decisions/${decisionKey}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer }),
    })
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(errorBody?.error ?? `Decision resolve failed with ${response.status}`)
    }

    form.reset()
    await loadGoalData()
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
    render()
  }
}

async function reconcileGoal() {
  try {
    const response = await fetch(`/api/goals/${state.goalKey}/reconcile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(errorBody?.error ?? `Reconcile failed with ${response.status}`)
    }

    const result = (await response.json()) as
      | { kind: 'idle' }
      | { kind: 'advanced'; taskRef: string; from: TaskStatus; to: TaskStatus }
      | { kind: 'blocked'; taskRef: string; blocker: BlockerRef }
    state.lastReconcileSummary = summarizeReconcileResult(result)
    await loadGoalData()
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
    render()
  } finally {
    state.reconcilingGoal = false
    render()
  }
}

function render() {
  const currentSelectedStep = selectedStep()
  const currentSelectedAssistantRun = state.selectedAssistantRun
  const currentSelectedAssistantBundle = state.selectedAssistantBundle

  root.innerHTML = `
    <div class="app-shell">
      <header class="hero">
        <div>
          <p class="eyebrow">Goal-native runtime overlay</p>
          <h1>HOPI</h1>
          <p class="hero-copy">
            Board state stays file-native. Runtime history stays inspectable. This UI only reads the current Bun API surface.
          </p>
        </div>

        <form class="goal-form" data-role="goal-form">
          <label for="goal-key">Goal key</label>
          <div class="goal-form-row">
            <input
              id="goal-key"
              data-role="goal-key-input"
              value="${escapeAttribute(state.goalKeyInput)}"
              placeholder="math-feature"
            />
            <button type="submit">Open Goal</button>
          </div>
        </form>
      </header>

      ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}

      <main class="workspace">
        <section class="panel board-panel">
          <div class="panel-heading">
            <div>
              <p class="kicker">Workflow truth</p>
              <h2>${escapeHtml(state.board?.goal.title ?? 'Loading goal board')}</h2>
            </div>
            <div class="panel-actions">
              <button
                type="button"
                class="secondary-button"
                data-action="reconcile-goal"
                ${state.reconcilingGoal ? 'disabled' : ''}
              >
                ${state.reconcilingGoal ? 'Reconciling...' : 'Reconcile Once'}
              </button>
              <span class="goal-chip">${escapeHtml(state.goalKey)}</span>
            </div>
          </div>

          ${
            state.lastReconcileSummary
              ? `<div class="assistant-note reconcile-note">${escapeHtml(state.lastReconcileSummary)}</div>`
              : ''
          }

          ${state.loadingBoard ? '<div class="empty-state">Loading board and runs...</div>' : ''}

          <div class="board-grid">
            ${STATUS_COLUMNS.map((column) => renderLane(column.status, column.label)).join('')}
          </div>
        </section>

        <section class="panel docs-panel">
          <div class="panel-heading">
            <div>
              <p class="kicker">Durable Goal Docs</p>
              <h2>Goal and design context</h2>
            </div>
            <span class="goal-chip soft">${escapeHtml(renderGoalDocsSummary(state.goalDocs))}</span>
          </div>

          <div class="docs-grid">
            ${renderGoalDocCard('goal.md', state.goalDocs?.goal)}
            ${renderGoalDocCard('design.md', state.goalDocs?.design)}
          </div>
        </section>

        <section class="panel runtime-panel">
          <div class="panel-heading">
            <div>
              <p class="kicker">Runtime overlay</p>
              <h2>Runs, steps, and messages</h2>
            </div>
            <span class="goal-chip soft">${state.runs.length} runs</span>
          </div>

          <div class="runtime-layout">
            <div class="runtime-column">
              <h3>Runs</h3>
              <div class="stack-list">
                ${state.runs.length === 0 ? '<div class="ghost-card">No runs yet</div>' : ''}
                ${state.runs.map(renderRunSummary).join('')}
              </div>
            </div>

            <div class="runtime-column">
              <h3>Steps</h3>
              ${state.loadingRun ? '<div class="ghost-card">Loading run...</div>' : ''}
              <div class="stack-list">
                ${
                  state.selectedRun
                    ? state.selectedRun.steps.map(renderStepSummary).join('')
                    : !state.loadingRun
                      ? '<div class="ghost-card">Select a run</div>'
                      : ''
                }
              </div>
            </div>

            <div class="runtime-column messages-column">
              <h3>Step Detail</h3>
              ${
                currentSelectedStep
                  ? `
                    ${renderStepEvidence(currentSelectedStep)}
                    ${renderStepTranscript(currentSelectedStep)}
                    ${renderStepWriteTraces(currentSelectedStep)}
                    <div class="message-stream">${currentSelectedStep.messages.map(renderMessage).join('')}</div>
                  `
                  : '<div class="ghost-card">Select a step to inspect its history</div>'
              }
            </div>
          </div>
        </section>

        <section class="panel assistant-panel">
          <div class="panel-heading">
            <div>
              <p class="kicker">Goal assistant</p>
              <h2>Decisions, thread, and explicit assistant runs</h2>
            </div>
            <span class="goal-chip soft">${state.assistantRuns.length} assistant runs</span>
          </div>

          <div class="assistant-layout">
            <div class="assistant-column">
              <form class="assistant-form" data-role="assistant-form">
                <label for="assistant-input">Ask the Goal assistant</label>
                <textarea
                  id="assistant-input"
                  data-role="assistant-input"
                  placeholder="Explain blockers, resolve a decision, or create visible planning work."
                >${escapeHtml(state.assistantInput)}</textarea>
                <button type="submit" ${state.runningAssistant ? 'disabled' : ''}>
                  ${state.runningAssistant ? 'Running assistant...' : 'Run Assistant'}
                </button>
              </form>

              <section class="assistant-card">
                <div class="assistant-card-header">
                  <h3>Preferences</h3>
                  <span class="goal-chip soft">repo</span>
                </div>
                <p class="assistant-note">
                  Durable repo guidance feeds planner and assistant context. The canonical file keeps stable keys plus active or retired lifecycle state inside .hopi/preference.md.
                </p>
                <div class="evidence-list">
                  ${
                    state.preferenceEntries.length === 0
                      ? '<span class="assistant-note">No durable preference entries recorded yet.</span>'
                      : state.preferenceEntries
                          .map((entry) => {
                            const detail = [
                              entry.rationale ? `rationale: ${entry.rationale}` : null,
                              entry.retiredReason ? `retired: ${entry.retiredReason}` : null,
                              entry.supersededBy ? `supersededBy: ${entry.supersededBy}` : null,
                            ]
                              .filter(Boolean)
                              .join(' | ')
                            return `
                              <article class="evidence-card">
                                <div class="trace-entry-top">
                                  <span class="evidence-pill">${escapeHtml(entry.status)}</span>
                                  <span class="evidence-pill soft">${escapeHtml(entry.preferenceKey)}</span>
                                </div>
                                <p class="trace-summary">${escapeHtml(entry.summary)}</p>
                                ${
                                  detail
                                    ? `<p class="assistant-note">${escapeHtml(detail)}</p>`
                                    : ''
                                }
                              </article>
                            `
                          })
                          .join('')
                  }
                </div>
                <form class="preference-form" data-role="preference-form">
                  <textarea
                    id="preference-input"
                    data-role="preference-input"
                    placeholder="# Preferences"
                  >${escapeHtml(state.preferenceEditor)}</textarea>
                  <div class="assistant-actions-row">
                    <button
                      type="submit"
                      ${state.savingPreferences ? 'disabled' : ''}
                    >
                      ${state.savingPreferences ? 'Saving preferences...' : 'Save Preferences'}
                    </button>
                    ${
                      state.preferenceDirty
                        ? '<span class="assistant-note">Unsaved changes</span>'
                        : '<span class="assistant-note">Synced to `.hopi/preference.md`</span>'
                    }
                  </div>
                </form>
              </section>

              <section class="assistant-card">
                <div class="assistant-card-header">
                  <h3>Planning Workflows</h3>
                  <span class="goal-chip soft">${state.planningWorkflows.length}</span>
                </div>
                <p class="assistant-note">
                  Durable workflow graphs reconstruct from planning-requests.yml plus current open planning tasks. Use this to inspect one reusable multi-workflow surface without manually correlating request ids.
                </p>
                <div class="assistant-list">
                  ${
                    state.planningWorkflows.length === 0
                      ? '<div class="ghost-card">No durable planning workflow graphs yet</div>'
                      : state.planningWorkflows.map(renderPlanningWorkflow).join('')
                  }
                </div>
              </section>

              <section class="assistant-card">
                <div class="assistant-card-header">
                  <h3>Planning Requests</h3>
                  <span class="goal-chip soft">${state.planningRequests.length}</span>
                </div>
                <p class="assistant-note">
                  Durable planner follow-through requests stay file-native and linked to visible planning work. Use this when the planner needs explicit next-step intent, not just another loose note.
                </p>
                <form class="decision-form planning-request-form" data-role="planning-request-form">
                  <input name="title" placeholder="Planner follow-through title" />
                  <input name="requestKey" placeholder="request key (optional)" />
                  <input
                    name="decisionRefs"
                    placeholder="linked decision refs (comma separated)"
                  />
                  <input name="groupKey" type="text" placeholder="optional planning group key" />
                  <input
                    name="groupTaskKey"
                    type="text"
                    placeholder="optional grouped task key"
                  />
                  <textarea
                    name="description"
                    placeholder="Why this planning follow-through is needed"
                  ></textarea>
                  <textarea
                    name="acceptanceCriteria"
                    placeholder="One acceptance criterion per line"
                  ></textarea>
                  <div class="planning-update-targets">
                    <span class="assistant-note">Requested durable updates</span>
                    <textarea
                      name="requestedUpdates"
                      placeholder="One Goal-local relative path per line or comma.&#10;goal.md&#10;design.md&#10;notes/rollout.md"
                    ></textarea>
                  </div>
                  <div class="assistant-actions-row">
                    <button type="submit">Create Planning Request</button>
                    <span class="assistant-note">Use Goal-local relative paths under .hopi/docs/goals/&lt;goalKey&gt;/. A visible planning task will be reused or created deterministically.</span>
                  </div>
                </form>
                <div class="assistant-list">
                  ${
                    state.planningRequests.length === 0
                      ? '<div class="ghost-card">No planning follow-through requests yet</div>'
                      : state.planningRequests.map(renderPlanningRequest).join('')
                  }
                </div>
              </section>

              <section class="assistant-card">
                <div class="assistant-card-header">
                  <h3>Decisions</h3>
                  <span class="goal-chip soft">${state.decisions.length}</span>
                </div>
                <form class="decision-form" data-role="decision-create-form">
                  <input name="summary" placeholder="Open one visible decision topic" />
                  <input name="prompt" placeholder="exact question to ask (optional)" />
                  <input name="decisionKey" placeholder="decision key (optional)" />
                  <input name="taskRef" placeholder="task ref to block (optional)" />
                  <div class="assistant-actions-row">
                    <button type="submit">Create Decision</button>
                    <span class="assistant-note">Link a task ref to make the blocker visible on the board.</span>
                  </div>
                </form>
                <div class="assistant-list">
                  ${
                    state.decisions.length === 0
                      ? '<div class="ghost-card">No decision topics yet</div>'
                      : state.decisions.map(renderDecision).join('')
                  }
                </div>
              </section>
            </div>

            <div class="assistant-column">
              <section class="assistant-card">
                <div class="assistant-card-header">
                  <h3>Assistant Thread</h3>
                  <span class="goal-chip soft">${state.assistantThread.length} entries</span>
                </div>
                <div class="assistant-list">
                  ${
                    state.assistantThread.length === 0
                      ? '<div class="ghost-card">No assistant thread entries yet</div>'
                      : state.assistantThread.toReversed().map(renderAssistantThreadEntry).join('')
                  }
                </div>
              </section>
            </div>

            <div class="assistant-column">
              <section class="assistant-card">
                <div class="assistant-card-header">
                  <h3>Assistant Runs</h3>
                  <span class="goal-chip soft">${state.assistantRuns.length}</span>
                </div>
                <div class="assistant-run-layout">
                  <div class="assistant-list">
                    ${
                      state.assistantRuns.length === 0
                        ? '<div class="ghost-card">No assistant runs yet</div>'
                        : state.assistantRuns.map(renderAssistantRunSummary).join('')
                    }
                  </div>

                  <div class="assistant-run-detail">
                    ${
                      state.loadingAssistantRun
                        ? '<div class="ghost-card">Loading assistant run...</div>'
                        : currentSelectedAssistantRun
                          ? renderAssistantRunDetail(
                              currentSelectedAssistantRun,
                              currentSelectedAssistantBundle,
                            )
                          : '<div class="ghost-card">Select an assistant run to inspect its durable bundle and runtime evidence.</div>'
                    }
                  </div>
                </div>
              </section>
            </div>
          </div>
        </section>
      </main>
    </div>
  `
}

function renderLane(status: TaskStatus, label: string) {
  const items = (state.board?.items ?? []).filter((item) => item.status === status)

  return `
    <article class="lane">
      <div class="lane-header">
        <span>${escapeHtml(label)}</span>
        <strong>${items.length}</strong>
      </div>

      <div class="lane-cards">
        ${items.length === 0 ? '<div class="ghost-card">No tasks</div>' : ''}
        ${items.map(renderTaskCard).join('')}
      </div>
    </article>
  `
}

function renderGoalDocCard(label: string, doc?: GoalDocSnapshot) {
  if (!doc) {
    return '<div class="ghost-card">Loading durable Goal docs...</div>'
  }

  return `
    <article class="assistant-card doc-card">
      <div class="assistant-card-header">
        <h3>${escapeHtml(label)}</h3>
        <span class="assistant-kind kind-${escapeAttribute(doc.status)}">${escapeHtml(doc.status)}</span>
      </div>
      <div class="assistant-summary">${escapeHtml(doc.path)}</div>
      <pre class="doc-preview">${escapeHtml(doc.content)}</pre>
    </article>
  `
}

function renderGoalDocsSummary(docs: GoalDocsSnapshot | null) {
  if (!docs) {
    return 'loading'
  }

  const curatedCount = [docs.goal.status, docs.design.status].filter(
    (status) => status === 'curated',
  ).length
  if (curatedCount === 2) {
    return 'all curated'
  }
  if (curatedCount === 0) {
    return 'all bootstrapped'
  }
  return `${curatedCount}/2 curated`
}

function renderTaskCard(item: TaskItem) {
  return `
    <div class="task-card">
      <div class="task-card-top">
        <span class="task-ref">${escapeHtml(item.ref)}</span>
        <span class="kind-tag kind-${escapeAttribute(item.kind)}">${escapeHtml(item.kind)}</span>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.description)}</p>
      <div class="criteria-list">
        ${item.acceptanceCriteria.map((criterion) => `<span>${escapeHtml(criterion)}</span>`).join('')}
      </div>
      ${
        item.blockedBy.length > 0
          ? `<div class="blocker-list">${item.blockedBy
              .map(
                (blocker) => `<span>${escapeHtml(blocker.kind)}: ${escapeHtml(blocker.ref)}</span>`,
              )
              .join('')}</div>`
          : ''
      }
    </div>
  `
}

function renderRunSummary(run: RunSummary) {
  return `
    <button
      type="button"
      class="stack-card ${run.runId === state.selectedRunId ? 'selected' : ''}"
      data-action="select-run"
      data-run-id="${escapeAttribute(run.runId)}"
    >
      <div class="stack-card-top">
        <span>${escapeHtml(run.taskRef)}</span>
        <span class="status-pill status-${escapeAttribute(run.status)}">${escapeHtml(run.status)}</span>
      </div>
      <p>${escapeHtml(run.taskKind)}</p>
      <small>${run.stepCount} steps</small>
    </button>
  `
}

function renderDecision(decision: GoalDecision) {
  return `
    <article class="assistant-entry">
      <div class="assistant-entry-top">
        <span class="assistant-kind kind-${escapeAttribute(decision.status)}">${escapeHtml(decision.status)}</span>
        <time>${escapeHtml(formatTimestamp(decision.createdAt))}</time>
      </div>
      <strong>${escapeHtml(decision.decisionKey)}</strong>
      <p>${escapeHtml(decision.summary)}</p>
      ${
        decision.prompt
          ? `<div class="assistant-summary">Prompt: ${escapeHtml(decision.prompt)}</div>`
          : ''
      }
      ${
        decision.captureFormat
          ? `<div class="assistant-summary">Answer capture format: ${escapeHtml(decision.captureFormat)}</div>`
          : ''
      }
      ${decision.taskRef ? `<div class="assistant-summary">Task: ${escapeHtml(decision.taskRef)}</div>` : ''}
      ${
        decision.answer
          ? `<div class="assistant-summary">Answer: ${escapeHtml(decision.answer)}</div>`
          : `
              <div class="assistant-summary">Open decision topic</div>
              <form class="decision-resolve-form" data-role="decision-resolve-form">
                <input type="hidden" name="decisionKey" value="${escapeAttribute(decision.decisionKey)}" />
                <textarea name="answer" placeholder="Record the explicit answer"></textarea>
                <button type="submit">Resolve Decision</button>
              </form>
            `
      }
    </article>
  `
}

function formatPlanningAnswerSummary(entry: CapturedAnswer) {
  const prefix = entry.prompt ? `${entry.summary} [${entry.prompt}]` : entry.summary
  const capture = entry.captureFormat ? ` [captureFormat=${entry.captureFormat}]` : ''
  return `${prefix}${capture}: ${entry.answer}`
}

function renderPlanningRequest(request: GoalPlanningRequest) {
  return `
    <article class="assistant-entry">
      <div class="assistant-entry-top">
        <span class="assistant-kind kind-${escapeAttribute(request.status)}">${escapeHtml(request.status)}</span>
        <time>${escapeHtml(formatTimestamp(request.createdAt))}</time>
      </div>
      <strong>${escapeHtml(request.requestKey)}</strong>
      <p>${escapeHtml(request.title)}</p>
      <div class="assistant-summary">Task: ${escapeHtml(request.taskRef)}</div>
      ${
        request.groupKey
          ? `<div class="assistant-summary">Planning group: ${escapeHtml(request.groupKey)}</div>`
          : ''
      }
      ${
        request.workflowKey
          ? `<div class="assistant-summary">Workflow key: ${escapeHtml(request.workflowKey)}</div>`
          : ''
      }
      ${
        request.workflowTaskKey
          ? `<div class="assistant-summary">Workflow task key: ${escapeHtml(request.workflowTaskKey)}</div>`
          : ''
      }
      ${
        request.blockedByWorkflowKeys.length > 0
          ? `<div class="assistant-summary">Workflow dependencies: ${escapeHtml(request.blockedByWorkflowKeys.join(', '))}</div>`
          : ''
      }
      ${
        request.groupTaskKey
          ? `<div class="assistant-summary">Grouped task key: ${escapeHtml(request.groupTaskKey)}</div>`
          : ''
      }
      ${
        request.decisionRefs.length > 0
          ? `<div class="assistant-summary">Linked decisions: ${escapeHtml(request.decisionRefs.join(', '))}</div>`
          : ''
      }
      ${
        request.answers.length > 0
          ? `<div class="assistant-summary">Captured answers: ${escapeHtml(request.answers.map((entry) => formatPlanningAnswerSummary(entry)).join(' | '))}</div>`
          : ''
      }
      ${
        request.requestedUpdates.length > 0
          ? `<div class="assistant-summary">Requested durable updates: ${escapeHtml(request.requestedUpdates.join(', '))}</div>`
          : ''
      }
      ${request.description ? `<div class="assistant-summary">${escapeHtml(request.description)}</div>` : ''}
      ${
        request.acceptanceCriteria.length > 0
          ? `<div class="criteria-list">${request.acceptanceCriteria
              .map((criterion) => `<span>${escapeHtml(criterion)}</span>`)
              .join('')}</div>`
          : ''
      }
      ${
        request.resolution
          ? `<div class="assistant-summary">Resolution: ${escapeHtml(request.resolution)}</div>`
          : ''
      }
    </article>
  `
}

function renderPlanningWorkflow(workflow: GoalPlanningWorkflowState) {
  return `
    <article class="assistant-entry">
      <div class="assistant-entry-top">
        <span class="assistant-kind kind-open">workflow</span>
        <span>${escapeHtml(workflow.workflowKey)}</span>
      </div>
      ${
        workflow.workflowSharedDecisionRefs.length > 0
          ? `<div class="assistant-summary">Workflow-shared decisions: ${escapeHtml(workflow.workflowSharedDecisionRefs.join(', '))}</div>`
          : ''
      }
      ${
        workflow.workflowSharedAnswers.length > 0
          ? `<div class="assistant-summary">Workflow-shared answers: ${escapeHtml(workflow.workflowSharedAnswers.map((entry) => formatPlanningAnswerSummary(entry)).join(' | '))}</div>`
          : ''
      }
      ${
        workflow.groupKeys.length > 0
          ? `<div class="assistant-summary">Grouped children: ${escapeHtml(workflow.groupKeys.join(', '))}</div>`
          : ''
      }
      <div class="assistant-summary">Current tail blockers: ${escapeHtml(workflow.blockerTaskRefs.join(', '))}</div>
      ${workflow.workflows.map(renderPlanningWorkflowLeaf).join('')}
    </article>
  `
}

function renderPlanningWorkflowLeaf(workflow: GoalPlanningWorkflowLeafState) {
  if (workflow.kind === 'planning_batch') {
    return `
      <div class="assistant-summary">
        Grouped child ${escapeHtml(workflow.groupKey)} -> tail ${escapeHtml(workflow.blockerTaskRefs.join(', '))}
      </div>
      ${
        workflow.blockedByWorkflowKeys.length > 0
          ? `<div class="assistant-summary">Depends on workflow children: ${escapeHtml(workflow.blockedByWorkflowKeys.join(', '))}</div>`
          : ''
      }
      <div class="criteria-list">${workflow.requests
        .map(
          (request) =>
            `<span>${escapeHtml(`${request.groupTaskKey ?? request.requestKey}: ${request.title}`)}</span>`,
        )
        .join('')}</div>
    `
  }

  return `
    <div class="assistant-summary">
      Planning child ${escapeHtml(workflow.workflowTaskKey ?? workflow.request.requestKey)} -> ${escapeHtml(workflow.request.title)} -> tail ${escapeHtml(workflow.blockerTaskRefs.join(', '))}
    </div>
    ${
      workflow.blockedByWorkflowKeys.length > 0
        ? `<div class="assistant-summary">Depends on workflow children: ${escapeHtml(workflow.blockedByWorkflowKeys.join(', '))}</div>`
        : ''
    }
  `
}

function renderAssistantThreadEntry(entry: AssistantThreadEntry) {
  const body =
    entry.kind === 'user_message' || entry.kind === 'assistant_message'
      ? (entry.content ?? '')
      : `${entry.actionType ?? 'action'} | ${entry.summary ?? ''}`

  return `
    <article class="assistant-entry">
      <div class="assistant-entry-top">
        <span class="assistant-kind kind-${escapeAttribute(entry.kind)}">${escapeHtml(entry.kind)}</span>
        <time>${escapeHtml(formatTimestamp(entry.createdAt))}</time>
      </div>
      <p>${escapeHtml(body)}</p>
    </article>
  `
}

function renderAssistantRunSummary(run: AssistantRunSummary) {
  return `
    <button
      type="button"
      class="stack-card ${run.assistantRunId === state.selectedAssistantRunId ? 'selected' : ''}"
      data-action="select-assistant-run"
      data-assistant-run-id="${escapeAttribute(run.assistantRunId)}"
    >
      <div class="stack-card-top">
        <span>${escapeHtml(formatTimestamp(run.startedAt))}</span>
        <span class="status-pill status-${escapeAttribute(run.status)}">${escapeHtml(run.status)}</span>
      </div>
      <p>${escapeHtml(run.message || 'Assistant run')}</p>
      <small>${run.actionCount} action${run.actionCount === 1 ? '' : 's'}</small>
    </button>
  `
}

function renderAssistantRunDetail(run: AssistantRunDetail, bundle: AssistantRunBundle | null) {
  return `
    <div class="assistant-run-card">
      <div class="assistant-run-meta">
        <span class="status-pill status-${escapeAttribute(run.status)}">${escapeHtml(run.status)}</span>
        <time>${escapeHtml(formatTimestamp(run.startedAt))}</time>
      </div>
      <h4>Request</h4>
      <p class="assistant-run-copy">${escapeHtml(run.requestContent)}</p>
      <h4>Reply</h4>
      <p class="assistant-run-copy">${escapeHtml(run.message || 'No assistant reply recorded.')}</p>
      ${run.error ? `<div class="error-banner inline-error">${escapeHtml(run.error)}</div>` : ''}
      <h4>Bundle Files</h4>
      <div class="assistant-bundle-grid">
        ${renderAssistantBundleFile('context.md', bundle?.context)}
        ${renderAssistantBundleFile('prompt.md', bundle?.prompt)}
        ${renderAssistantBundleFile('outcome.json', bundle?.outcome)}
        ${renderAssistantBundleFile('result.json', bundle?.result)}
      </div>
      <h4>Action Results</h4>
      <div class="assistant-list">
        ${
          run.actionResults.length === 0
            ? '<div class="ghost-card">No durable actions</div>'
            : run.actionResults
                .map(
                  (result) => `
                    <article class="assistant-entry">
                      <div class="assistant-entry-top">
                        <span class="assistant-kind kind-${escapeAttribute(result.kind)}">${escapeHtml(result.kind)}</span>
                      </div>
                      <p>${escapeHtml(result.summary)}</p>
                      ${renderAssistantActionResultDetails(result)}
                    </article>
                  `,
                )
                .join('')
        }
      </div>
      <h4>Runtime Events</h4>
      <div class="assistant-list">
        ${
          run.events.length === 0
            ? '<div class="ghost-card">No runtime events</div>'
            : run.events.map(renderAssistantEvent).join('')
        }
      </div>
    </div>
  `
}

function renderAssistantActionResultDetails(result: AssistantActionResult) {
  const lines: string[] = []

  if (typeof result.created === 'boolean') {
    lines.push(`Created decision topic: ${result.created ? 'yes' : 'no'}`)
  }
  if (result.createdDecisionKeys && result.createdDecisionKeys.length > 0) {
    lines.push(`Created decision keys: ${result.createdDecisionKeys.join(', ')}`)
  }
  if (typeof result.blockerRemoved === 'boolean') {
    lines.push(`Decision blocker removed: ${result.blockerRemoved ? 'yes' : 'no'}`)
  }
  if (result.followThrough) {
    lines.push(`Follow-through kind: ${result.followThrough.kind}`)
    if (result.followThrough.workflowKey) {
      lines.push(`Follow-through workflow key: ${result.followThrough.workflowKey}`)
    }
    if (result.followThrough.groupKey) {
      lines.push(`Follow-through group key: ${result.followThrough.groupKey}`)
    }
    if (result.followThrough.groupKeys && result.followThrough.groupKeys.length > 0) {
      lines.push(`Follow-through group keys: ${result.followThrough.groupKeys.join(', ')}`)
    }
    lines.push(`Follow-through requests: ${result.followThrough.requestKeys.join(', ')}`)
    lines.push(`Follow-through tasks: ${result.followThrough.taskRefs.join(', ')}`)
    lines.push(`Follow-through blockers: ${result.followThrough.blockerTaskRefs.join(', ')}`)
  }

  return lines.map((line) => `<div class="assistant-summary">${escapeHtml(line)}</div>`).join('')
}

function renderAssistantBundleFile(label: string, file?: AssistantRunBundleFile) {
  if (!file) {
    return `
      <article class="assistant-bundle-card">
        <div class="assistant-entry-top">
          <strong>${escapeHtml(label)}</strong>
        </div>
        <div class="ghost-card">Bundle file is unavailable for this run.</div>
      </article>
    `
  }

  return `
    <article class="assistant-bundle-card">
      <div class="assistant-entry-top">
        <strong>${escapeHtml(label)}</strong>
      </div>
      <div class="assistant-summary">${escapeHtml(file.path)}</div>
      <pre class="assistant-bundle-preview">${escapeHtml(file.content ?? 'Bundle file was not recorded for this run.')}</pre>
    </article>
  `
}

function renderAssistantEvent(event: AssistantEvent) {
  return `
    <article class="assistant-entry">
      <div class="assistant-entry-top">
        <span class="assistant-kind kind-${escapeAttribute(event.kind)}">${escapeHtml(event.kind)}</span>
      </div>
      <p>${escapeHtml(summarizeAssistantEvent(event))}</p>
    </article>
  `
}

function summarizeReconcileResult(
  result:
    | { kind: 'idle' }
    | { kind: 'advanced'; taskRef: string; from: TaskStatus; to: TaskStatus }
    | { kind: 'blocked'; taskRef: string; blocker: BlockerRef },
) {
  if (result.kind === 'idle') {
    return 'Reconcile found no dispatchable work.'
  }
  if (result.kind === 'advanced') {
    return `${result.taskRef} advanced from ${result.from} to ${result.to}.`
  }
  return `${result.taskRef} is blocked by ${result.blocker.kind}:${result.blocker.ref}.`
}

function renderStepSummary(step: RunStep, index: number) {
  return `
    <button
      type="button"
      class="stack-card ${step.stepId === state.selectedStepId ? 'selected' : ''}"
      data-action="select-step"
      data-step-id="${escapeAttribute(step.stepId)}"
    >
      <div class="stack-card-top">
        <span>${index + 1}. ${escapeHtml(step.role)}</span>
        <span class="status-pill status-${escapeAttribute(step.outcome)}">${escapeHtml(step.outcome)}</span>
      </div>
      <p>${escapeHtml(step.statusBefore)} -&gt; ${escapeHtml(step.statusAfter ?? 'running')}</p>
      <small>${escapeHtml(formatTimestamp(step.startedAt))}</small>
    </button>
  `
}

function renderMessage(message: RunStepMessage) {
  return `
    <article class="message-bubble kind-${escapeAttribute(message.kind)}">
      <div class="message-meta">
        <span>${escapeHtml(message.role)}</span>
        <time>${escapeHtml(formatTimestamp(message.createdAt))}</time>
      </div>
      <p>${escapeHtml(message.content)}</p>
    </article>
  `
}

function renderStepEvidence(step: RunStep) {
  if (!step.execution?.worktree && (step.execution?.artifacts.length ?? 0) === 0) {
    return ''
  }

  return `
    <section class="evidence-card">
      <h4>Execution Evidence</h4>
      ${
        step.execution?.worktree
          ? `
            <div class="evidence-block">
              <strong>Worktree</strong>
              <span class="evidence-pill">${escapeHtml(step.execution.worktree.path)}</span>
              ${
                step.execution.worktree.branch
                  ? `<span class="evidence-pill soft">branch: ${escapeHtml(step.execution.worktree.branch)}</span>`
                  : ''
              }
              ${
                step.execution.worktree.baseBranch
                  ? `<span class="evidence-pill soft">base: ${escapeHtml(step.execution.worktree.baseBranch)}</span>`
                  : ''
              }
            </div>
          `
          : ''
      }
      ${
        step.execution?.artifacts.length
          ? `
            <div class="evidence-block">
              <strong>Artifacts</strong>
              <div class="evidence-list">
                ${step.execution.artifacts
                  .map(
                    (artifact) => `
                      <span class="evidence-pill">
                        ${escapeHtml(artifact.label)}: ${escapeHtml(artifact.ref)}
                      </span>
                    `,
                  )
                  .join('')}
              </div>
            </div>
          `
          : ''
      }
    </section>
  `
}

function renderStepWriteTraces(step: RunStep) {
  const traces = state.selectedRunWriteTraces.filter((entry) => entry.stepId === step.stepId)
  if (traces.length === 0) {
    return ''
  }

  return `
    <section class="evidence-card">
      <h4>Write Trace</h4>
      <div class="evidence-list">
        ${traces
          .map(
            (entry) => `
              <article class="trace-entry">
                <div class="trace-entry-top">
                  <span class="evidence-pill soft">${escapeHtml(entry.role)}</span>
                  <time>${escapeHtml(formatTimestamp(entry.timestamp))}</time>
                </div>
                <p class="trace-summary">${escapeHtml(entry.resultSummary)}</p>
                <div class="evidence-list">
                  ${entry.targetPaths
                    .map(
                      (path) => `
                        <span class="evidence-pill">
                          ${escapeHtml(path)}
                        </span>
                      `,
                    )
                    .join('')}
                </div>
              </article>
            `,
          )
          .join('')}
      </div>
    </section>
  `
}

function renderStepTranscript(step: RunStep) {
  if (step.transcript.length === 0) {
    return ''
  }

  return `
    <section class="evidence-card">
      <h4>Transcript</h4>
      <div class="evidence-list">
        ${step.transcript
          .map(
            (entry) => `
              <article class="transcript-entry transcript-${escapeAttribute(entry.kind)}">
                <div class="trace-entry-top">
                  <span class="evidence-pill soft">${escapeHtml(entry.transport)}</span>
                  <span class="evidence-pill soft">${escapeHtml(entry.kind)}</span>
                  <time>${escapeHtml(formatTimestamp(entry.createdAt))}</time>
                </div>
                <p class="trace-summary">${escapeHtml(entry.summary)}</p>
                ${
                  entry.toolName
                    ? `<div class="evidence-list">
                        <span class="evidence-pill">tool: ${escapeHtml(entry.toolName)}</span>
                        ${
                          entry.toolInvocationKey
                            ? `<span class="evidence-pill soft">tool key: ${escapeHtml(entry.toolInvocationKey)}</span>`
                            : ''
                        }
                      </div>`
                    : ''
                }
              </article>
            `,
          )
          .join('')}
      </div>
    </section>
  `
}

function selectedStep() {
  return state.selectedRun?.steps.find((step) => step.stepId === state.selectedStepId) ?? null
}

function summarizeAssistantEvent(event: AssistantEvent) {
  if (event.kind === 'message') {
    return `${event.role ?? 'assistant'}: ${event.content ?? ''}`.trim()
  }

  if (event.kind === 'transcript') {
    const prefix = event.transport ? `${event.transport} ${event.entryKind ?? 'event'}` : 'event'
    return `${prefix}: ${event.summary ?? ''}`.trim()
  }

  if (event.kind === 'worktree_prepared') {
    return `Worktree prepared: ${event.path ?? ''}`.trim()
  }

  return `${event.label ?? 'artifact'}: ${event.ref ?? ''}`.trim()
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString([], {
    hour12: false,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttribute(value: string) {
  return escapeHtml(value)
}
