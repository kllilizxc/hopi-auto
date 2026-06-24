import {
  escapeAttribute,
  escapeHtml,
  renderAssistantRunDetail,
  renderAssistantRunSummary,
  renderAssistantThreadEntry,
  renderDecision,
  renderGoalDocCard,
  renderGoalDocsSummary,
  renderLane,
  renderMessage,
  renderPlanningRequest,
  renderPlanningWorkflow,
  renderPreferenceEntries,
  renderRunSummary,
  renderStepEvidence,
  renderStepSummary,
  renderStepTranscript,
  renderStepWriteTraces,
  selectedStep,
} from './renderSupport'
import { type AppState, STATUS_COLUMNS } from './types'

export function renderApp(state: AppState) {
  const currentSelectedStep = selectedStep(state.selectedRun, state.selectedStepId)
  const currentSelectedAssistantRun = state.selectedAssistantRun
  const currentSelectedAssistantBundle = state.selectedAssistantBundle

  return `
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
            ${STATUS_COLUMNS.map((column) => renderLane(state.board, column.status, column.label)).join('')}
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
                ${state.runs.map((run) => renderRunSummary(run, state.selectedRunId)).join('')}
              </div>
            </div>

            <div class="runtime-column">
              <h3>Steps</h3>
              ${state.loadingRun ? '<div class="ghost-card">Loading run...</div>' : ''}
              <div class="stack-list">
                ${
                  state.selectedRun
                    ? state.selectedRun.steps
                        .map((step, index) => renderStepSummary(step, index, state.selectedStepId))
                        .join('')
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
                    ${renderStepWriteTraces(currentSelectedStep, state.selectedRunWriteTraces)}
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
                <div class="evidence-list">${renderPreferenceEntries(state.preferenceEntries)}</div>
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
                        : state.assistantRuns
                            .map((run) =>
                              renderAssistantRunSummary(run, state.selectedAssistantRunId),
                            )
                            .join('')
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
