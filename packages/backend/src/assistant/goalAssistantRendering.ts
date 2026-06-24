import { BLOCKER_KINDS } from '../domain/board'
import type { AssistantThreadStore } from '../runtime/assistantThreadStore'
import type { RunHistoryStore } from '../runtime/runHistoryStore'
import type { WriteTraceStore } from '../runtime/writeTraceStore'
import type { GoalAttachmentRef } from '../storage/goalAttachmentStore'
import type { PreferenceEntry } from '../storage/preferenceStore'
import { renderRecentAssistantThreadMarkdown } from './assistantInspection'

const ASSISTANT_REQUEST_PLANNING_MODE_LITERALS = ['single', 'batch', 'workflow'] as const
const ASSISTANT_RETRY_TASK_BLOCKER_KIND_LITERALS = ['intervention', 'merge_conflict'] as const
const ASSISTANT_FOLLOW_THROUGH_KIND_LITERALS = [
  'planning',
  'planning_batch',
  'workflow_batch',
] as const
const ASSISTANT_WORKFLOW_CHILD_KIND_LITERALS = ['planning', 'planning_batch'] as const
const ASSISTANT_SET_PREFERENCE_MODE_LITERALS = ['upsert', 'retire'] as const

type AssistantThreadEntries = Awaited<ReturnType<AssistantThreadStore['readThread']>>['entries']
type GoalRunSummaries = Awaited<ReturnType<RunHistoryStore['listRuns']>>
type GoalWriteTraces = Awaited<ReturnType<WriteTraceStore['listEntries']>>

export interface RenderGoalAssistantContextOptions {
  goalKey: string
  boardYaml: string
  goalFile: string
  designFile: string
  todoFile: string
  decisionsFile: string
  decisionsContent: string
  planningRequestsFile: string
  planningRequestsContent: string
  preferenceFile: string
  preferenceContent: string
  preferenceEntries: PreferenceEntry[]
  threadEntries: AssistantThreadEntries
  runSummaries: GoalRunSummaries
  traces: GoalWriteTraces
  attachments: GoalAttachmentRef[]
  outcomeFile: string
}

export function renderAssistantContext(options: RenderGoalAssistantContextOptions) {
  return `# HOPI Goal Assistant Context

Goal Key: ${options.goalKey}

## Durable Goal Docs

- goal.md: ${options.goalFile}
- design.md: ${options.designFile}
- todo.yml: ${options.todoFile}
- decisions.yml: ${options.decisionsFile}
- planning-requests.yml: ${options.planningRequestsFile}
- preference.md: ${options.preferenceFile}

## Current todo.yml

\`\`\`yaml
${options.boardYaml.trim()}
\`\`\`

## Current decisions.yml

\`\`\`yaml
${(options.decisionsContent || 'version: 1\n').trim()}
\`\`\`

## Current planning-requests.yml

\`\`\`yaml
${(options.planningRequestsContent || 'version: 1\n').trim()}
\`\`\`

## Current preference.md

\`\`\`md
${options.preferenceContent.trim()}
\`\`\`

${renderStructuredPreferences(options.preferenceEntries)}

${renderRecentThread(options.threadEntries)}

${renderRecentRuns(options.runSummaries)}

${renderRecentWriteTraces(options.traces)}

${renderCurrentAttachments(options.attachments)}

## Runtime Output

- Write the structured assistant outcome JSON to: ${options.outcomeFile}

## Boundaries

- Do not edit source files.
- Do not edit goal.md or design.md directly.
- Do not create engineering tasks.
- Use actions only for visible planning work, retrying blocked tasks, decision surfaces, and durable preferences.
`
}

export function renderAssistantPrompt(options: { context: string; outcomeFile: string }) {
  return `# HOPI Goal Assistant Prompt

You are the HOPI Goal assistant for one explicit Goal-scoped user request.

Before you finish:

- read the bundled Goal context below
- do not write source files
- do not edit goal.md, design.md, todo.yml, decisions.yml, planning-requests.yml, or preference.md directly
- assistant is not a general-purpose board editor
- do not create or edit engineering task rows directly
- use only the constrained actions described here
- when uploaded images materially support a planning request or decision, include the exact durable \`attachmentAssetPaths\`
- write one structured JSON object to: ${options.outcomeFile}

Required outcome shape:

\`\`\`json
{
  "message": "user-facing reply",
  "actions": [
    {
      "kind": "retry_task",
      "taskRef": "T-4",
      "reason": "the user explicitly asked to retry the blocked task after reviewing the latest blocker",
      "clearBlockers": [
        {
          "kind": "intervention",
          "ref": "T-4:reviewer_rejected"
        }
      ]
    },
    {
      "kind": "request_planning",
      "mode": "single",
      "attachmentAssetPaths": ["assets/assistant/<upload-id>/screen.png"],
      "title": "planning request title",
      "description": "why visible planning work is needed",
      "acceptanceCriteria": ["what the planner-visible request must accomplish"],
      "decisionRefs": ["optional linked decision key"],
      "requestedUpdates": ["goal.md", "design.md", "todo.yml"],
      "blockedBy": []
    },
    {
      "kind": "request_planning",
      "mode": "batch",
      "groupKey": "stable-group-key",
      "requests": [
        {
          "taskKey": "goal-docs",
          "title": "first visible planning task title",
          "description": "what this planning stage must accomplish",
          "acceptanceCriteria": ["at least one acceptance criterion"],
          "requestedUpdates": ["goal.md", "design.md"],
          "blockedByTaskKeys": []
        },
        {
          "taskKey": "task-graph",
          "title": "second visible planning task title",
          "description": "what this later planning stage must accomplish",
          "acceptanceCriteria": ["at least one acceptance criterion"],
          "requestedUpdates": ["todo.yml"],
          "blockedByTaskKeys": ["goal-docs"]
        }
      ]
    },
    {
      "kind": "request_planning",
      "mode": "workflow",
      "workflowKey": "optional-workflow-key",
      "workflows": [
        {
          "kind": "planning",
          "workflowTaskKey": "goal-docs",
          "title": "standalone planning child",
          "description": "what this child must accomplish",
          "acceptanceCriteria": ["at least one acceptance criterion"],
          "requestedUpdates": ["goal.md"]
        },
        {
          "kind": "planning_batch",
          "groupKey": "stable-group-key",
          "blockedByWorkflowKeys": ["goal-docs"],
          "requests": [
            {
              "taskKey": "task-graph",
              "title": "grouped planning child",
              "description": "what this grouped child must accomplish",
              "acceptanceCriteria": ["at least one acceptance criterion"],
              "requestedUpdates": ["todo.yml"]
            }
          ]
        }
      ]
    },
    {
      "kind": "request_decision",
      "attachmentAssetPaths": ["assets/assistant/<upload-id>/screen.png"],
      "decisionKey": "stable-decision-key",
      "summary": "highest-leverage missing answer",
      "prompt": "exact user-facing question to preserve on the durable decision topic",
      "taskRef": "optional task ref to block visibly"
    },
    {
      "kind": "resolve_decisions",
      "attachmentAssetPaths": ["assets/assistant/<upload-id>/screen.png"],
      "answers": [
        {
          "decisionKey": "auth-strategy",
          "summary": "Choose the auth strategy",
          "answer": "Use Bun-native auth."
        }
      ],
      "followThrough": {
        "kind": "planning_batch",
        "groupKey": "auth-follow-through",
        "requests": [
          {
            "taskKey": "task-graph",
            "title": "Reflect the decision in todo.yml",
            "description": "Create visible follow-through planning work",
            "acceptanceCriteria": ["The task graph is updated"],
            "requestedUpdates": ["todo.yml"]
          }
        ]
      }
    },
    {
      "kind": "set_preference",
      "mode": "upsert",
      "preferenceKey": "bun-first-runtime",
      "summary": "Prefer Bun-native runtime integrations",
      "rationale": "Keeps the stack aligned with project defaults"
    },
    {
      "kind": "set_preference",
      "mode": "retire",
      "preferenceKey": "legacy-auth-flow",
      "reason": "The legacy auth flow is obsolete."
    }
  ]
}
\`\`\`

Action authority:

- Allowed request_planning.mode literals: ${ASSISTANT_REQUEST_PLANNING_MODE_LITERALS.join(' | ')}
- Allowed retry_task.clearBlockers.kind literals: ${ASSISTANT_RETRY_TASK_BLOCKER_KIND_LITERALS.join(' | ')}
- Allowed blockedBy.kind literals anywhere in assistant actions: ${BLOCKER_KINDS.join(' | ')}
- Allowed followThrough.kind literals: ${ASSISTANT_FOLLOW_THROUGH_KIND_LITERALS.join(' | ')}
- Allowed workflow child kind literals inside request_planning workflow mode or workflow_batch followThrough: ${ASSISTANT_WORKFLOW_CHILD_KIND_LITERALS.join(' | ')}
- Allowed set_preference.mode literals: ${ASSISTANT_SET_PREFERENCE_MODE_LITERALS.join(' | ')}
- Do not invent extra literals such as pending, active, blocked, review_pending, workflow, task_batch, create_task, or move_status.
- Use only five public action families: retry_task, request_planning, request_decision, resolve_decisions, set_preference.
- Do not emit legacy action kinds such as move_task, create_planning_task, request_planning_batch, request_planning_workflows, record_answer, record_answers, resolve_decision, record_preference, retire_preference, or update_preference.
- Do not move task statuses directly. If visible work needs to change, reshape it through planning.
- Do not create engineering tasks directly. Engineering graph changes must route through planner-visible planning work.
- Use request_planning for all planning surface creation or restructuring. Use mode "single" for one visible planning task, mode "batch" for one grouped chain, and mode "workflow" for one multi-branch workflow graph.
- Use request_decision when one explicit missing answer should become a durable blocker or reusable decision topic.
- Use resolve_decisions when one reply resolves one or more durable decision topics, optionally with planning follow-through.
- Use set_preference with mode "upsert" to create or update one durable preference by key, and mode "retire" to retire one durable preference. Do not rewrite the whole canonical preference document.
- Use retry_task only when the user explicitly asks to retry or resume a blocked task.
- retry_task may clear only retryable blockers and resets that task's retry budget. It must not bypass task or decision blockers.

Browser Harness capability:

- You may call Browser Harness with \`browser-harness <<'PY' ... PY\` to inspect visible UI state before shaping a planning request or decision.
- Prefer existing project scenarios under \`scripts/hopi/browser-harness/scenarios/*.py\`; do not create or edit scenario scripts from the assistant.
- Write screenshots, logs, and extracted verification outputs to \`$HOPI_BROWSER_HARNESS_ARTIFACT_DIR\`.
- If Browser Harness cannot run, keep the action grounded in available Goal context and state the verification blocker in the user-facing message.

File-based rules:

- Durable workflow truth remains file-based in todo.yml, planning-requests.yml, decisions.yml, and preference.md.
- Assistant must mutate durable Goal state only through these constrained actions.
- requestedUpdates must be Goal-local relative paths under .hopi/docs/goals/<goalKey>/, such as goal.md, design.md, todo.yml, notes/rollout.md, or research.md.
- Do not use absolute paths, parent traversal, or reserved runtime files inside requestedUpdates.

Planning and decision guidance:

- Prefer inference from current Goal state over unnecessary actions.
- When one user answer should shape future planning work but does not yet need a durable decision topic, prefer request_planning with captured planner answers.
- When one reply resolves multiple durable decision topics, prefer one resolve_decisions action instead of multiple smaller actions.
- When a resolved decision should immediately open or reshape visible planning work, put that bridge in resolve_decisions.followThrough instead of emitting a second planning action.
- For UI, screenshot, visual, interaction, keyboard/IME, routing, responsive, or browser-visible work, request planning should tell planner to include Browser Harness acceptance criteria that either reference an existing project scenario or explicitly require the engineering task to create/update one under scripts/hopi/browser-harness/**.
- When uploaded images matter, use only the exact attachmentAssetPaths listed under Current Uploaded Images.
- Keep the reply grounded in the current Goal state.

## Bundled Context

${options.context}
`
}

function renderRecentThread(entries: AssistantThreadEntries) {
  return renderRecentAssistantThreadMarkdown(entries)
}

function renderRecentRuns(runs: GoalRunSummaries) {
  if (runs.length === 0) {
    return '## Recent Goal Runs\n\n- No task runs recorded yet.\n'
  }

  return `## Recent Goal Runs

${runs
  .map(
    (run) =>
      `- ${run.runId} | ${run.taskRef} | ${run.taskKind} | ${run.status} | ${run.terminalOutcome ?? 'running'}`,
  )
  .join('\n')}
`
}

function renderRecentWriteTraces(traces: GoalWriteTraces) {
  if (traces.length === 0) {
    return '## Recent Write Traces\n\n- No durable write traces recorded yet.\n'
  }

  return `## Recent Write Traces

${traces
  .map(
    (entry) =>
      `- ${entry.timestamp} | ${entry.taskRef} | ${entry.role} | ${entry.resultSummary} | ${entry.targetPaths.join(', ')}`,
  )
  .join('\n')}
`
}

function renderCurrentAttachments(attachments: GoalAttachmentRef[]) {
  if (attachments.length === 0) {
    return '## Current Uploaded Images\n\n- No uploaded images were included with this assistant request.\n'
  }

  return `## Current Uploaded Images

${attachments
  .map(
    (attachment) =>
      `- ${attachment.assetPath} | ${attachment.mediaType} | ${attachment.sizeBytes} bytes`,
  )
  .join('\n')}
`
}

function renderStructuredPreferences(entries: PreferenceEntry[]) {
  if (entries.length === 0) {
    return '## Parsed Preferences\n\n- No durable preference entries recorded yet.\n'
  }

  return `## Parsed Preferences

${entries
  .map((entry) => {
    const rationale = entry.rationale ? ` | rationale: ${entry.rationale}` : ''
    const retiredReason = entry.retiredReason ? ` | retired: ${entry.retiredReason}` : ''
    const supersededBy = entry.supersededBy ? ` | supersededBy: ${entry.supersededBy}` : ''
    return `- ${entry.status} | ${entry.preferenceKey} | ${entry.summary}${rationale}${retiredReason}${supersededBy}`
  })
  .join('\n')}
`
}
