import './index.css'
import { renderApp } from './renderApp'
import type {
  AppState,
  AssistantRunBundle,
  AssistantRunDetail,
  AssistantRunSummary,
  AssistantThreadEntry,
  BlockerRef,
  GoalDecision,
  GoalDocsSnapshot,
  GoalPlanningRequest,
  GoalPlanningWorkflowState,
  PreferenceDocument,
  RunDetail,
  RunSummary,
  TaskStatus,
  TodoBoard,
  WriteTraceEntry,
} from './types'

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
  root.innerHTML = renderApp(state)
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
