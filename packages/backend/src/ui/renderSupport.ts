import {
  formatAssistantActionPresentation,
  formatAssistantActionResultDetails,
  formatAssistantEventPresentation,
  formatAssistantThreadEntryPresentation,
} from '../assistant/assistantInspection'
import type {
  AssistantAction,
  AssistantActionResult,
  AssistantEvent,
  AssistantRunBundle,
  AssistantRunBundleFile,
  AssistantRunDetail,
  AssistantRunSummary,
  AssistantThreadEntry,
  CapturedAnswer,
  GoalDecision,
  GoalDocSnapshot,
  GoalDocsSnapshot,
  GoalPlanningRequest,
  GoalPlanningWorkflowLeafState,
  GoalPlanningWorkflowState,
  PreferenceEntry,
  RunDetail,
  RunStep,
  RunStepMessage,
  RunSummary,
  TaskItem,
  TaskStatus,
  TodoBoard,
  WriteTraceEntry,
} from './types'

export function renderLane(board: TodoBoard | null, status: TaskStatus, label: string) {
  const items = (board?.items ?? []).filter((item) => item.status === status)

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

export function renderGoalDocCard(label: string, doc?: GoalDocSnapshot) {
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

export function renderGoalDocsSummary(docs: GoalDocsSnapshot | null) {
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

export function renderPreferenceEntries(entries: PreferenceEntry[]) {
  if (entries.length === 0) {
    return '<span class="assistant-note">No durable preference entries recorded yet.</span>'
  }

  return entries
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
          ${detail ? `<p class="assistant-note">${escapeHtml(detail)}</p>` : ''}
        </article>
      `
    })
    .join('')
}

export function renderRunSummary(run: RunSummary, selectedRunId: string | null) {
  return `
    <button
      type="button"
      class="stack-card ${run.runId === selectedRunId ? 'selected' : ''}"
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

export function renderDecision(decision: GoalDecision) {
  return `
    <article class="assistant-entry">
      <div class="assistant-entry-top">
        <span class="assistant-kind kind-${escapeAttribute(decision.status)}">${escapeHtml(decision.status)}</span>
        <time>${escapeHtml(formatTimestamp(decision.createdAt))}</time>
      </div>
      <strong>${escapeHtml(decision.decisionKey)}</strong>
      <p>${escapeHtml(decision.summary)}</p>
      ${
        decision.summaryKey
          ? `<div class="assistant-summary">Summary key: ${escapeHtml(decision.summaryKey)}</div>`
          : ''
      }
      ${
        decision.prompt
          ? `<div class="assistant-summary">Prompt: ${escapeHtml(decision.prompt)}</div>`
          : ''
      }
      ${
        decision.matchHints && decision.matchHints.length > 0
          ? `<div class="assistant-summary">Match hints: ${escapeHtml(decision.matchHints.join(', '))}</div>`
          : ''
      }
      ${decision.taskRef ? `<div class="assistant-summary">Task: ${escapeHtml(decision.taskRef)}</div>` : ''}
      ${
        decision.captureFormat
          ? `<div class="assistant-summary">Answer capture format: ${escapeHtml(decision.captureFormat)}</div>`
          : ''
      }
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

export function renderPlanningRequest(request: GoalPlanningRequest) {
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
        request.workflowSharedDecisionRefs && request.workflowSharedDecisionRefs.length > 0
          ? `<div class="assistant-summary">Workflow-shared decisions: ${escapeHtml(request.workflowSharedDecisionRefs.join(', '))}</div>`
          : ''
      }
      ${
        request.workflowSharedAnswers && request.workflowSharedAnswers.length > 0
          ? `<div class="assistant-summary">Workflow-shared answers: ${escapeHtml(request.workflowSharedAnswers.map((entry) => formatPlanningAnswerSummary(entry)).join(' | '))}</div>`
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

export function renderPlanningWorkflow(workflow: GoalPlanningWorkflowState) {
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

export function renderAssistantThreadEntry(entry: AssistantThreadEntry) {
  const { body, details } = formatAssistantThreadEntryPresentation(entry)

  return `
    <article class="assistant-entry">
      <div class="assistant-entry-top">
        <span class="assistant-kind kind-${escapeAttribute(entry.kind)}">${escapeHtml(entry.kind)}</span>
        <time>${escapeHtml(formatTimestamp(entry.createdAt))}</time>
      </div>
      <p>${escapeHtml(body)}</p>
      ${details.map((detail) => `<div class="assistant-summary">${escapeHtml(detail)}</div>`).join('')}
    </article>
  `
}

export function renderAssistantRunSummary(
  run: AssistantRunSummary,
  selectedAssistantRunId: string | null,
) {
  return `
    <button
      type="button"
      class="stack-card ${run.assistantRunId === selectedAssistantRunId ? 'selected' : ''}"
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

export function renderAssistantRunDetail(
  run: AssistantRunDetail,
  bundle: AssistantRunBundle | null,
) {
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
      <h4>Actions</h4>
      <div class="assistant-list">
        ${
          run.actions.length === 0
            ? '<div class="ghost-card">No structured actions recorded</div>'
            : run.actions.map(renderAssistantRunAction).join('')
        }
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

export function renderStepSummary(step: RunStep, index: number, selectedStepId: string | null) {
  return `
    <button
      type="button"
      class="stack-card ${step.stepId === selectedStepId ? 'selected' : ''}"
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

export function renderMessage(message: RunStepMessage) {
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

export function renderStepEvidence(step: RunStep) {
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

export function renderStepWriteTraces(step: RunStep, selectedRunWriteTraces: WriteTraceEntry[]) {
  const traces = selectedRunWriteTraces.filter((entry) => entry.stepId === step.stepId)
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

export function renderStepTranscript(step: RunStep) {
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

export function selectedStep(selectedRun: RunDetail | null, selectedStepId: string | null) {
  return selectedRun?.steps.find((step) => step.stepId === selectedStepId) ?? null
}

export function formatTimestamp(value: string) {
  return new Date(value).toLocaleString([], {
    hour12: false,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function escapeAttribute(value: string) {
  return escapeHtml(value)
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

function formatPlanningAnswerSummary(entry: CapturedAnswer) {
  const prefix = entry.prompt ? `${entry.summary} [${entry.prompt}]` : entry.summary
  const metadata = [
    entry.summaryKey ? `summaryKey=${entry.summaryKey}` : null,
    entry.answerKey ? `answerKey=${entry.answerKey}` : null,
    entry.matchHints && entry.matchHints.length > 0
      ? `matchHints=${entry.matchHints.join('|')}`
      : null,
    entry.captureFormat ? `captureFormat=${entry.captureFormat}` : null,
  ]
    .filter(Boolean)
    .map((value) => ` [${value}]`)
    .join('')
  return `${prefix}${metadata}: ${entry.answer}`
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

function renderAssistantRunAction(action: AssistantAction) {
  const { body, details } = formatAssistantActionPresentation(action)

  return `
    <article class="assistant-entry">
      <div class="assistant-entry-top">
        <span class="assistant-kind kind-${escapeAttribute(action.kind)}">${escapeHtml(action.kind)}</span>
      </div>
      <p>${escapeHtml(body)}</p>
      ${details.map((detail) => `<div class="assistant-summary">${escapeHtml(detail)}</div>`).join('')}
    </article>
  `
}

function renderAssistantActionResultDetails(result: AssistantActionResult) {
  const lines = formatAssistantActionResultDetails(result)
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
  const { body, details } = formatAssistantEventPresentation(event)

  return `
    <article class="assistant-entry">
      <div class="assistant-entry-top">
        <span class="assistant-kind kind-${escapeAttribute(event.kind)}">${escapeHtml(event.kind)}</span>
      </div>
      <p>${escapeHtml(body)}</p>
      ${details.map((detail) => `<div class="assistant-summary">${escapeHtml(detail)}</div>`).join('')}
    </article>
  `
}
