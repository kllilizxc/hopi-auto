import { afterEach, describe, expect, test } from 'bun:test'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createRoleProcessContextBuilder } from '../src/runtime/roleProcessContext'
import { createRunHistoryStore } from '../src/runtime/runHistoryStore'
import { createWriteTraceStore } from '../src/runtime/writeTraceStore'
import { createDecisionStore } from '../src/storage/decisionStore'
import { createPreferenceStore } from '../src/storage/preferenceStore'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'role-process-context')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createRoleProcessContextBuilder', () => {
  test('bootstraps goal docs and writes a context bundle for generator work', async () => {
    const rootDir = testRoot()
    const builder = createRoleProcessContextBuilder(rootDir)

    const bundle = await builder.prepareBundle({
      goalKey: 'goal-1',
      goalTitle: 'Goal One',
      runId: 'run-1',
      stepId: 'step-1',
      role: 'generator',
      task: {
        ref: 'T-1',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement adapter context',
        description: 'Create the first real role adapter context bundle.',
        acceptanceCriteria: ['Context file contains task details.'],
        blockedBy: [],
      },
    })

    expect(bundle.goalFile).toContain('.hopi/docs/goals/goal-1/goal.md')
    expect(bundle.designFile).toContain('.hopi/docs/goals/goal-1/design.md')
    expect(bundle.contextFile).toContain('.hopi/runtime/goals/goal-1/runs/run-1/step-1/context.md')
    expect(bundle.promptFile).toContain('.hopi/runtime/goals/goal-1/runs/run-1/step-1/prompt.md')
    expect(bundle.outcomeFile).toContain(
      '.hopi/runtime/goals/goal-1/runs/run-1/step-1/outcome.json',
    )

    await expect(Bun.file(bundle.goalFile).text()).resolves.toContain('# Goal One')
    await expect(Bun.file(bundle.designFile).text()).resolves.toContain('# Design: Goal One')

    const context = await readFile(bundle.contextFile, 'utf8')
    expect(context).toContain('Role: generator')
    expect(context).toContain('Task Ref: T-1')
    expect(context).toContain('Implement adapter context')
    expect(context).toContain('Context file contains task details.')
    expect(context).toContain('Do not edit .hopi/docs/**')
    expect(context).toContain(bundle.goalFile)
    expect(context).toContain(bundle.designFile)
    expect(context).toContain(bundle.outcomeFile)

    const prompt = await readFile(bundle.promptFile, 'utf8')
    expect(prompt).toContain('You are the HOPI generator agent')
    expect(prompt).toContain(bundle.outcomeFile)
    expect(prompt).toContain('## Bundled Context')
    expect(prompt).toContain('Role: generator')
    expect(prompt).toContain('Task Ref: T-1')
  })

  test('gives planner work the durable goal-doc write boundary', async () => {
    const rootDir = testRoot()
    await createDecisionStore(rootDir).createDecision('goal-2', {
      summary: 'Choose the rollout strategy',
      taskRef: 'P-1',
    })
    await Bun.write(
      join(rootDir, '.hopi', 'docs', 'goals', 'goal-2', 'planning-requests.yml'),
      `version: 1
goalKey: goal-2
requests:
  - requestKey: PR-1
    title: Plan rollout follow-through
    description: Turn the rollout decision into durable planning follow-through.
    acceptanceCriteria:
      - The rollout design follow-through is visible.
    taskRef: P-1
    decisionRefs:
      - rollout-strategy
    answers:
      - summary: Rollout guardrail
        answer: Start with five enterprise pilots before broad rollout.
    requestedUpdates:
      - goal.md
      - design.md
      - todo.yml
    status: open
    createdAt: 2026-06-01T00:00:00.000Z
`,
    )
    await createPreferenceStore(rootDir).writePreferences(
      '# Preferences\n\n- Prefer incremental rollouts.\n',
    )
    const builder = createRoleProcessContextBuilder(rootDir)

    const bundle = await builder.prepareBundle({
      goalKey: 'goal-2',
      goalTitle: 'Goal Two',
      runId: 'run-2',
      stepId: 'step-2',
      role: 'planner',
      task: {
        ref: 'P-1',
        kind: 'planning',
        status: 'planned',
        title: 'Define rollout plan',
        description: 'Capture the first durable design.',
        acceptanceCriteria: ['Goal docs are available to the planner.'],
        blockedBy: [],
      },
    })

    const context = await readFile(bundle.contextFile, 'utf8')
    const prompt = await readFile(bundle.promptFile, 'utf8')
    expect(context).toContain('Role: planner')
    expect(context).toContain('Planner may edit goal.md and design.md')
    expect(context).not.toContain('Do not edit .hopi/docs/**')
    expect(context).toContain('.hopi/docs/goals/goal-2/todo.yml')
    expect(context).toContain('.hopi/docs/goals/goal-2/decisions.yml')
    expect(context).toContain('.hopi/docs/goals/goal-2/planning-requests.yml')
    expect(context).toContain('.hopi/preference.md')
    expect(context).toContain('## Goal Docs Status')
    expect(context).toContain('goal.md status: bootstrapped')
    expect(context).toContain('design.md status: bootstrapped')
    expect(context).toContain('Choose the rollout strategy')
    expect(context).toContain('Plan rollout follow-through')
    expect(context).toContain('Linked decisions: rollout-strategy')
    expect(context).toContain('Captured answers:')
    expect(context).toContain(
      'Rollout guardrail: Start with five enterprise pilots before broad rollout.',
    )
    expect(context).toContain('Requested durable updates: goal.md, design.md, todo.yml')
    expect(context).toContain('Prefer incremental rollouts.')
    expect(prompt).toContain('## Planner Design Policy')
    expect(prompt).toContain(
      'If design.md is still bootstrapped, replace placeholder sections with durable design detail before returning success.',
    )
    expect(prompt).toContain(
      'If a relevant planning request targets goal.md, update durable Goal context before returning success.',
    )
    expect(prompt).toContain(
      'Address open planning requests linked to this task before returning success.',
    )
    expect(prompt).toContain(
      'If a relevant planning request targets design.md, update durable design rationale before returning success.',
    )
    expect(prompt).toContain(
      'If a relevant planning request targets todo.yml, reshape the visible task graph before returning success.',
    )
  })

  test('shows Goal-local requested update roots and generic planner guidance for extra doc paths', async () => {
    const rootDir = testRoot()
    await Bun.write(
      join(rootDir, '.hopi', 'docs', 'goals', 'goal-2b', 'planning-requests.yml'),
      `version: 1
goalKey: goal-2b
requests:
  - requestKey: PR-1
    title: Capture rollout notes
    description: Record rollout details before more planning work continues.
    acceptanceCriteria:
      - Rollout notes are durable.
    taskRef: P-1
    decisionRefs:
      - rollout-strategy
    requestedUpdates:
      - goal.md
      - notes/rollout.md
      - research.md
    status: open
    createdAt: 2026-06-01T00:00:00.000Z
`,
    )
    const builder = createRoleProcessContextBuilder(rootDir)

    const bundle = await builder.prepareBundle({
      goalKey: 'goal-2b',
      goalTitle: 'Goal Two B',
      runId: 'run-2b',
      stepId: 'step-2b',
      role: 'planner',
      task: {
        ref: 'P-1',
        kind: 'planning',
        status: 'planned',
        title: 'Capture rollout notes',
        description: 'Record rollout details before more planning work continues.',
        acceptanceCriteria: ['Rollout notes are durable.'],
        blockedBy: [],
      },
    })

    const context = await readFile(bundle.contextFile, 'utf8')
    const prompt = await readFile(bundle.promptFile, 'utf8')
    expect(context).toContain('Goal-local durable docs under .hopi/docs/goals/<goalKey>/')
    expect(context).toContain('Goal-local requested update root:')
    expect(context).toContain('.hopi/docs/goals/goal-2b')
    expect(context).toContain('Requested durable updates: goal.md, notes/rollout.md, research.md')
    expect(prompt).toContain(
      'Requested update paths are relative to the Goal docs directory from the bundled context.',
    )
    expect(prompt).toContain(
      'If a relevant planning request targets another Goal-local path, create or update that durable document before returning success.',
    )
  })

  test('includes relevant earlier write traces in the context bundle', async () => {
    const rootDir = testRoot()
    const traces = createWriteTraceStore(rootDir)
    await traces.appendEntry('goal-3', {
      runId: 'run-3',
      stepId: 'step-generator',
      taskRef: 'T-3',
      role: 'generator',
      agent: 'process_runner',
      cwd: '/tmp/worktree',
      toolName: 'process',
      callId: 'step-generator',
      targetPaths: ['src/feature.ts', 'src/view.ts'],
      changes: [{ path: 'src/feature.ts', kind: 'modified' }],
      argumentSummary: 'bun run generator',
      resultSummary: 'exit 0 (1 changed file)',
    })
    await traces.appendEntry('goal-3', {
      runId: 'run-other',
      stepId: 'step-other',
      taskRef: 'T-other',
      role: 'generator',
      agent: 'process_runner',
      cwd: '/tmp/worktree',
      toolName: 'process',
      callId: 'step-other',
      targetPaths: ['src/other.ts'],
      changes: [{ path: 'src/other.ts', kind: 'added' }],
      argumentSummary: 'bun run other',
      resultSummary: 'exit 0 (1 changed file)',
    })

    const builder = createRoleProcessContextBuilder(rootDir)
    const bundle = await builder.prepareBundle({
      goalKey: 'goal-3',
      goalTitle: 'Goal Three',
      runId: 'run-3',
      stepId: 'step-reviewer',
      role: 'reviewer',
      task: {
        ref: 'T-3',
        kind: 'engineering',
        status: 'in_review',
        title: 'Review the implementation',
        description: 'Review generated changes.',
        acceptanceCriteria: ['Reviewer sees prior changed files.'],
        blockedBy: [],
      },
    })

    const context = await readFile(bundle.contextFile, 'utf8')
    expect(context).toContain('## Relevant Write Traces')
    expect(context).toContain('generator')
    expect(context).toContain('exit 0 (1 changed file)')
    expect(context).toContain('src/feature.ts')
    expect(context).toContain('src/view.ts')
    expect(context).not.toContain('src/other.ts')
  })

  test('shows sibling open planning requests from the same planning group', async () => {
    const rootDir = testRoot()
    await Bun.write(
      join(rootDir, '.hopi', 'docs', 'goals', 'goal-3b', 'planning-requests.yml'),
      `version: 1
goalKey: goal-3b
requests:
  - requestKey: PR-1
    groupKey: auth-follow-through
    groupTaskKey: goal-docs
    title: Clarify auth goal context
    description: Refresh durable Goal context first.
    acceptanceCriteria:
      - Goal context is durable.
    taskRef: P-1
    decisionRefs:
      - auth-strategy
    requestedUpdates:
      - goal.md
      - design.md
    status: open
    createdAt: 2026-06-01T00:00:00.000Z
  - requestKey: PR-2
    groupKey: auth-follow-through
    groupTaskKey: task-graph
    title: Decompose auth task graph
    description: Reshape todo.yml after the goal context is ready.
    acceptanceCriteria:
      - The auth task graph is visible.
    taskRef: P-2
    decisionRefs:
      - auth-strategy
    requestedUpdates:
      - todo.yml
    status: open
    createdAt: 2026-06-01T00:01:00.000Z
`,
    )

    const builder = createRoleProcessContextBuilder(rootDir)
    const bundle = await builder.prepareBundle({
      goalKey: 'goal-3b',
      goalTitle: 'Goal Three B',
      runId: 'run-3b',
      stepId: 'step-3b',
      role: 'planner',
      task: {
        ref: 'P-1',
        kind: 'planning',
        status: 'planned',
        title: 'Clarify auth goal context',
        description: 'Refresh durable Goal context first.',
        acceptanceCriteria: ['Goal context is durable.'],
        blockedBy: [],
      },
    })

    const context = await readFile(bundle.contextFile, 'utf8')
    expect(context).toContain('### Related Open Planning Group')
    expect(context).toContain('Group key: auth-follow-through')
    expect(context).toContain('PR-2 | P-2 | Decompose auth task graph')
    expect(context).toContain('Grouped task key: task-graph')
    expect(context).toContain('Requested durable updates: todo.yml')
    expect(context).toContain('Linked decisions: auth-strategy')
  })

  test('gives reviewer prompts explicit write-trace evidence policy for engineering review', async () => {
    const rootDir = testRoot()
    const traces = createWriteTraceStore(rootDir)
    await traces.appendEntry('goal-4', {
      runId: 'run-4',
      stepId: 'step-generator',
      taskRef: 'T-4',
      role: 'generator',
      agent: 'process_runner',
      cwd: '/tmp/worktree',
      toolName: 'process',
      callId: 'step-generator',
      targetPaths: ['src/auth.ts', 'src/session.ts'],
      changes: [
        { path: 'src/auth.ts', kind: 'modified' },
        { path: 'src/session.ts', kind: 'added' },
      ],
      argumentSummary: 'bun run generator',
      resultSummary: 'exit 0 (2 changed files)',
    })

    const builder = createRoleProcessContextBuilder(rootDir)
    const bundle = await builder.prepareBundle({
      goalKey: 'goal-4',
      goalTitle: 'Goal Four',
      runId: 'run-4',
      stepId: 'step-reviewer',
      role: 'reviewer',
      task: {
        ref: 'T-4',
        kind: 'engineering',
        status: 'in_review',
        title: 'Review auth implementation',
        description: 'Review the generated auth changes.',
        acceptanceCriteria: ['Reviewer uses execution evidence before accepting.'],
        blockedBy: [],
      },
    })

    const context = await readFile(bundle.contextFile, 'utf8')
    const prompt = await readFile(bundle.promptFile, 'utf8')

    expect(context).toContain('## Relevant Write Traces')
    expect(context).toContain('Changes: modified src/auth.ts, added src/session.ts')
    expect(prompt).toContain('## Role Evidence Policy')
    expect(prompt).toContain('Reviewer must use relevant write traces as execution evidence.')
    expect(prompt).toContain(
      'If there are no relevant traces or the traces do not support the claimed work, prefer reject or fail over blind acceptance.',
    )
  })

  test('includes prior run history artifacts and transcript evidence for engineering review', async () => {
    const rootDir = testRoot()
    const history = createRunHistoryStore(rootDir)
    const runRef = await history.startStep({
      goalKey: 'goal-6',
      taskRef: 'T-6',
      taskKind: 'engineering',
      role: 'generator',
      statusBefore: 'planned',
      message: {
        kind: 'system',
        role: 'system',
        content: 'generator dispatched for T-6',
      },
    })
    await history.recordStepEvent({
      goalKey: 'goal-6',
      runId: runRef.runId,
      stepId: runRef.stepId,
      event: {
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'tool_call',
        summary: 'Tool call: Bash',
        toolName: 'Bash',
      },
    })
    await history.recordStepEvent({
      goalKey: 'goal-6',
      runId: runRef.runId,
      stepId: runRef.stepId,
      event: {
        kind: 'artifact',
        ref: 'patch:T-6',
        label: 'Generated patch',
      },
    })
    await history.finishStep({
      goalKey: 'goal-6',
      runId: runRef.runId,
      stepId: runRef.stepId,
      statusAfter: 'in_review',
      outcome: 'success',
      message: {
        kind: 'system',
        role: 'system',
        content: 'T-6 advanced to in_review',
      },
    })

    const builder = createRoleProcessContextBuilder(rootDir)
    const bundle = await builder.prepareBundle({
      goalKey: 'goal-6',
      goalTitle: 'Goal Six',
      runId: runRef.runId,
      stepId: 'step-reviewer',
      role: 'reviewer',
      task: {
        ref: 'T-6',
        kind: 'engineering',
        status: 'in_review',
        title: 'Review auth implementation',
        description: 'Review the generated auth changes.',
        acceptanceCriteria: ['Reviewer sees prior runtime evidence.'],
        blockedBy: [],
      },
    })

    const context = await readFile(bundle.contextFile, 'utf8')
    const prompt = await readFile(bundle.promptFile, 'utf8')

    expect(context).toContain('## Relevant Run Evidence')
    expect(context).toContain(runRef.runId)
    expect(context).toContain('generator | success')
    expect(context).toContain('patch:T-6')
    expect(context).toContain('Generated patch')
    expect(context).toContain('Tool call: Bash')
    expect(prompt).toContain(
      'Correlate artifact refs and prior run history with the claimed work before accepting.',
    )
  })

  test('gives planning reviewer prompt explicit durable follow-through policy', async () => {
    const rootDir = testRoot()
    await Bun.write(
      join(rootDir, '.hopi', 'docs', 'goals', 'goal-7', 'planning-requests.yml'),
      `version: 1
goalKey: goal-7
requests:
  - requestKey: PR-1
    title: Plan rollout follow-through
    description: Turn the rollout answer into durable planning work.
    acceptanceCriteria:
      - The rollout follow-through is visible.
    taskRef: P-7
    decisionRefs:
      - rollout-strategy
    requestedUpdates:
      - goal.md
      - design.md
      - todo.yml
    status: open
    createdAt: 2026-06-01T00:00:00.000Z
`,
    )
    const traces = createWriteTraceStore(rootDir)
    await traces.appendEntry('goal-7', {
      runId: 'run-7',
      stepId: 'step-planner',
      taskRef: 'P-7',
      role: 'planner',
      agent: 'process_runner',
      cwd: '/tmp/root',
      toolName: 'process',
      callId: 'step-planner',
      targetPaths: [
        '.hopi/docs/goals/goal-7/goal.md',
        '.hopi/docs/goals/goal-7/design.md',
        '.hopi/docs/goals/goal-7/todo.yml',
      ],
      changes: [
        { path: '.hopi/docs/goals/goal-7/goal.md', kind: 'modified' },
        { path: '.hopi/docs/goals/goal-7/design.md', kind: 'modified' },
        { path: '.hopi/docs/goals/goal-7/todo.yml', kind: 'modified' },
      ],
      argumentSummary: 'bun run planner',
      resultSummary: 'exit 0 (3 changed files)',
    })

    const builder = createRoleProcessContextBuilder(rootDir)
    const bundle = await builder.prepareBundle({
      goalKey: 'goal-7',
      goalTitle: 'Goal Seven',
      runId: 'run-7',
      stepId: 'step-reviewer',
      role: 'reviewer',
      task: {
        ref: 'P-7',
        kind: 'planning',
        status: 'in_review',
        title: 'Review rollout planning follow-through',
        description: 'Review the planner follow-through before accepting.',
        acceptanceCriteria: ['Planning reviewer verifies durable follow-through.'],
        blockedBy: [],
      },
    })

    const context = await readFile(bundle.contextFile, 'utf8')
    const prompt = await readFile(bundle.promptFile, 'utf8')

    expect(context).toContain('## Planner Durable Inputs')
    expect(context).toContain('.hopi/docs/goals/goal-7/planning-requests.yml')
    expect(context).toContain('Plan rollout follow-through')
    expect(context).toContain('### Relevant Open Planning Requests For This Task')
    expect(context).toContain('Linked decisions: rollout-strategy')
    expect(context).toContain('Requested durable updates: goal.md, design.md, todo.yml')
    expect(context).toContain('### Requested Planning Update Coverage')
    expect(context).toContain('Observed requested durable updates: goal.md, design.md, todo.yml')
    expect(context).toContain('Missing requested durable updates: none')
    expect(context).toContain('.hopi/docs/goals/goal-7/goal.md')
    expect(context).toContain('.hopi/docs/goals/goal-7/design.md')
    expect(prompt).toContain(
      'Planning reviewer must verify durable planning follow-through against open planning requests before accepting.',
    )
    expect(prompt).toContain(
      'If there is no durable planning evidence or the docs and task graph do not reflect the requested follow-through, prefer reject or fail over blind acceptance.',
    )
  })

  test('warns merger when engineering work has no durable write-trace evidence', async () => {
    const rootDir = testRoot()
    const builder = createRoleProcessContextBuilder(rootDir)

    const bundle = await builder.prepareBundle({
      goalKey: 'goal-5',
      goalTitle: 'Goal Five',
      runId: 'run-5',
      stepId: 'step-merger',
      role: 'merger',
      task: {
        ref: 'T-5',
        kind: 'engineering',
        status: 'merging',
        title: 'Merge auth implementation',
        description: 'Merge only if there is execution evidence.',
        acceptanceCriteria: ['Merger sees the evidence gap.'],
        blockedBy: [],
      },
    })

    const context = await readFile(bundle.contextFile, 'utf8')
    const prompt = await readFile(bundle.promptFile, 'utf8')

    expect(context).toContain('## Relevant Run Evidence')
    expect(context).toContain('No prior run-history evidence was recorded yet for this task.')
    expect(context).toContain('## Relevant Write Traces')
    expect(context).toContain('No durable write traces were recorded yet for this task.')
    expect(prompt).toContain(
      'Merger must inspect relevant run history and artifact evidence before returning success.',
    )
    expect(prompt).toContain(
      'Merger must not return success blindly when engineering write-trace evidence is missing.',
    )
  })

  test('warns planning merger when durable planning follow-through evidence is missing', async () => {
    const rootDir = testRoot()
    await Bun.write(
      join(rootDir, '.hopi', 'docs', 'goals', 'goal-8', 'planning-requests.yml'),
      `version: 1
goalKey: goal-8
requests:
  - requestKey: PR-1
    title: Plan auth follow-through
    description: Turn the auth answer into durable planning work.
    acceptanceCriteria:
      - The auth follow-through is visible.
    taskRef: P-8
    requestedUpdates:
      - design.md
      - todo.yml
    status: open
    createdAt: 2026-06-01T00:00:00.000Z
`,
    )

    const builder = createRoleProcessContextBuilder(rootDir)
    const bundle = await builder.prepareBundle({
      goalKey: 'goal-8',
      goalTitle: 'Goal Eight',
      runId: 'run-8',
      stepId: 'step-merger',
      role: 'merger',
      task: {
        ref: 'P-8',
        kind: 'planning',
        status: 'merging',
        title: 'Merge planning follow-through',
        description: 'Merge only if durable planning evidence exists.',
        acceptanceCriteria: ['Planning merger sees the evidence gap.'],
        blockedBy: [],
      },
    })

    const context = await readFile(bundle.contextFile, 'utf8')
    const prompt = await readFile(bundle.promptFile, 'utf8')

    expect(context).toContain('## Relevant Run Evidence')
    expect(context).toContain('No prior run-history evidence was recorded yet for this task.')
    expect(context).toContain('## Relevant Write Traces')
    expect(context).toContain('No durable planning write traces were recorded yet for this task.')
    expect(context).toContain('Plan auth follow-through')
    expect(context).toContain('### Requested Planning Update Coverage')
    expect(context).toContain('Missing requested durable updates: design.md, todo.yml')
    expect(prompt).toContain(
      'Planning merger must inspect durable planning evidence before returning success.',
    )
    expect(prompt).toContain(
      'Planning merger must not return success blindly when durable planning follow-through evidence is missing.',
    )
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
