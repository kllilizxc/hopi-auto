import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createRoleProcessContextBuilder } from '../src/runtime/roleProcessContext'
import { createRunHistoryStore } from '../src/runtime/runHistoryStore'
import { PROJECT_MERGE_SCRIPT_RELATIVE_PATH, mergeScriptAttemptPath } from '../src/runtime/gitMergeExecutor'
import { createWriteTraceStore } from '../src/runtime/writeTraceStore'
import { createDecisionStore } from '../src/storage/decisionStore'
import { createProjectPaths } from '../src/storage/paths'
import { createPlanningRequestStore } from '../src/storage/planningRequestStore'
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
    expect(bundle.canonicalOutcomeFile).toContain(
      '.hopi/runtime/goals/goal-1/runs/run-1/step-1/outcome.json',
    )
    expect(bundle.outcomeFile).toContain(
      '.hopi/worktrees/goal-1/T-1/run-1/.hopi-runtime/goals/goal-1/runs/run-1/step-1/outcome.json',
    )
    expect(bundle.browserHarnessDir).toBe('scripts/hopi/browser-harness')
    expect(bundle.browserHarnessArtifactDir).toContain(
      '.hopi/worktrees/goal-1/T-1/run-1/.hopi-runtime/goals/goal-1/runs/run-1/step-1/browser-harness',
    )
    expect(bundle.canonicalBrowserHarnessArtifactDir).toContain(
      '.hopi/runtime/goals/goal-1/runs/run-1/step-1/browser-harness',
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
    expect(prompt).toContain('## Role Completion Policy')
    expect(prompt).toContain('## Browser Harness Capability')
    expect(prompt).toContain('browser-harness <<')
    expect(prompt).toContain('$HOPI_BROWSER_HARNESS_ARTIFACT_DIR')
    expect(prompt).toContain(
      'Treat every acceptance criterion and any "Latest Reviewer Findings To Address" prose as a hard completion gate.',
    )
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

    expect(bundle.extraWritableRoots).toEqual([
      join(rootDir, '.hopi', 'docs', 'goals', 'goal-2'),
    ])

    const context = await readFile(bundle.contextFile, 'utf8')
    const prompt = await readFile(bundle.promptFile, 'utf8')
    expect(context).toContain('Role: planner')
    expect(context).toContain('Planner may edit goal.md, design.md, todo.yml')
    expect(context).toContain(
      'Do not edit decisions.yml, planning-requests.yml, events.jsonl, write-trace.jsonl; those files are runtime-owned workflow state.',
    )
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
      'Rollout guardrail [What should the rollout guardrail be?]: Start with five enterprise pilots before broad rollout.',
    )
    expect(context).toContain('Requested durable updates: goal.md, design.md, todo.yml')
    expect(context).toContain('Prefer incremental rollouts.')
    expect(context).toContain('### Parsed Preferences')
    expect(context).toContain('active | prefer-incremental-rollouts | Prefer incremental rollouts.')
    expect(prompt).toContain('## Planner Design Policy')
    expect(prompt).toContain(
      'Do not edit decisions.yml, planning-requests.yml, events.jsonl, write-trace.jsonl; those files are runtime-owned workflow state.',
    )
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
    expect(prompt).toContain('## Planner Task Decomposition Rules')
    expect(prompt).toContain(
      'Default to one engineering task unless there is a clear parallelism or sequencing benefit.',
    )
    expect(prompt).toContain(
      'Every engineering task must name its primary implementation surface in backticks inside the task description',
    )
    expect(prompt).toContain(
      'If two engineering tasks would touch the same primary surface, merge them into one task or add a `blockedBy` task dependency so they do not run in parallel.',
    )
    expect(prompt).toContain(
      'Preserve/no-regression concerns should usually stay in acceptance criteria or a serial hardening pass, not as a parallel task on the same surface.',
    )
    expect(prompt).toContain(
      'For UI, layout, visual, interaction, routing, browser state, keyboard/IME, responsive, screenshot, modal, panel, button, tab/filter, form, or input work, every engineering task must include at least one acceptance criterion beginning with `Browser harness:`.',
    )
    expect(prompt).toContain(
      'Planner must not create or edit `scripts/hopi/browser-harness/**`; those project scripts are engineering assets produced by generator/reviewer/merger worktrees.',
    )
    expect(prompt).toContain(
      'If the repo does not already contain a suitable project scenario, do not require one to pre-exist; make the engineering task say the generator must create or update the scenario under `scripts/hopi/browser-harness/scenarios/`.',
    )
    expect(prompt).toContain('## todo.yml Canonical Literals')
    expect(prompt).toContain('Allowed task kind literals: planning | engineering')
    expect(prompt).toContain(
      'Allowed task status literals: planned | in_progress | in_review | merging | done',
    )
    expect(prompt).toContain(
      'Allowed blockedBy.kind literals: task | decision | merge_conflict | intervention',
    )
    expect(prompt).toContain(
      'If a YAML list item in description or acceptanceCriteria starts with backticks or another YAML-reserved leading character, quote it or write it with `>-`; never start a bare list item with ``.',
    )
    expect(prompt).toContain(
      'Do not invent synonyms such as pending, queued, active, blocked, or review_pending.',
    )
    expect(prompt).toContain(
      'planning-requests.yml is runtime-owned and must not be edited. For reference only, its status literals are open | resolved.',
    )
  })

  test('surfaces durable interpreted-answer provenance in parsed planner context', async () => {
    const rootDir = testRoot()
    const decisionStore = createDecisionStore(rootDir)
    await decisionStore.createDecision('goal-2b', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      summaryKey: 'auth-strategy',
      matchHints: ['login path'],
      taskRef: 'P-2',
    })
    await decisionStore.resolveDecision('goal-2b', 'auth-strategy', {
      answer: 'Use Bun-native auth for the first rollout.',
      captureFormat: 'matching_runs',
    })

    await createPlanningRequestStore(rootDir).createRequest('goal-2b', {
      requestKey: 'PR-1',
      workflowKey: 'auth-follow-through',
      title: 'Capture auth rollout notes',
      description: 'Record the durable auth rollout follow-through.',
      acceptanceCriteria: ['The auth rollout notes are durable.'],
      taskRef: 'P-2',
      decisionRefs: ['auth-strategy'],
      workflowSharedAnswers: [
        {
          summary: 'Pilot scope',
          answerKey: 'pilot-scope',
          summaryKey: 'pilot-scope',
          prompt: 'What should the pilot scope be?',
          matchHints: ['launch cohort'],
          captureFormat: 'question_blocks',
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
      answers: [
        {
          summary: 'Pilot scope',
          answerKey: 'pilot-scope',
          summaryKey: 'pilot-scope',
          prompt: 'What should the pilot scope be?',
          matchHints: ['launch cohort'],
          captureFormat: 'question_blocks',
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
      requestedUpdates: ['design.md', 'todo.yml'],
    })

    const builder = createRoleProcessContextBuilder(rootDir)
    const bundle = await builder.prepareBundle({
      goalKey: 'goal-2b',
      goalTitle: 'Goal Two B',
      runId: 'run-2b',
      stepId: 'step-2b',
      role: 'planner',
      task: {
        ref: 'P-2',
        kind: 'planning',
        status: 'planned',
        title: 'Capture auth rollout notes',
        description: 'Record durable auth rollout context.',
        acceptanceCriteria: ['Durable interpreted-answer provenance is visible in context.'],
        blockedBy: [],
      },
    })

    const context = await readFile(bundle.contextFile, 'utf8')
    expect(context).toContain('### Parsed Decisions')
    expect(context).toContain('resolved | auth-strategy | Choose the auth strategy')
    expect(context).toContain('Summary key: auth-strategy')
    expect(context).toContain('Match hints: login path')
    expect(context).toContain('Answer capture format: matching_runs')
    expect(context).toContain('Workflow-shared answers:')
    expect(context).toContain(
      'Pilot scope [What should the pilot scope be?] [summaryKey=pilot-scope] [answerKey=pilot-scope] [matchHints=launch cohort] [captureFormat=question_blocks]: Start with five enterprise customers before broader launch.',
    )
    expect(context).toContain('Captured answers:')
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

  test('passes referenced Goal images into planner multimodal input and context', async () => {
    const rootDir = testRoot()
    const plannerAttachment = {
      assetPath: 'assets/assistant/upload-1/reference-layout.png',
      fileName: 'reference-layout.png',
      mediaType: 'image/png' as const,
      sizeBytes: 4,
      createdAt: '2026-06-14T00:00:00.000Z',
    }
    const decisionAttachment = {
      assetPath: 'assets/assistant/upload-2/visual-anchor.webp',
      fileName: 'visual-anchor.webp',
      mediaType: 'image/webp' as const,
      sizeBytes: 4,
      createdAt: '2026-06-14T00:01:00.000Z',
    }
    await writeGoalAsset(rootDir, 'goal-2c', plannerAttachment.assetPath)
    await writeGoalAsset(rootDir, 'goal-2c', decisionAttachment.assetPath)
    await createDecisionStore(rootDir).createDecision('goal-2c', {
      decisionKey: 'visual-reference',
      summary: 'Use the reference layout as the visual anchor',
      taskRef: 'P-9',
      attachments: [decisionAttachment],
    })
    await createPlanningRequestStore(rootDir).createRequest('goal-2c', {
      requestKey: 'PR-1',
      title: 'Plan reference-aligned editor',
      description: 'Use the uploaded screenshots to reshape the editor plan.',
      acceptanceCriteria: ['The reference-aligned editor plan is durable.'],
      taskRef: 'P-9',
      decisionRefs: ['visual-reference'],
      attachments: [plannerAttachment],
      requestedUpdates: ['design.md', 'todo.yml'],
    })

    const builder = createRoleProcessContextBuilder(rootDir)
    const bundle = await builder.prepareBundle({
      goalKey: 'goal-2c',
      goalTitle: 'Goal Two C',
      runId: 'run-2c',
      stepId: 'step-2c',
      role: 'planner',
      task: {
        ref: 'P-9',
        kind: 'planning',
        status: 'planned',
        title: 'Plan reference-aligned editor',
        description: 'Reshape the editor docs and tasks around the uploaded images.',
        acceptanceCriteria: ['Planner receives the real image inputs.'],
        blockedBy: [],
      },
    })

    const context = await readFile(bundle.contextFile, 'utf8')
    const prompt = await readFile(bundle.promptFile, 'utf8')

    expect(bundle.imageFiles).toEqual([
      join(rootDir, '.hopi', 'docs', 'goals', 'goal-2c', plannerAttachment.assetPath),
      join(rootDir, '.hopi', 'docs', 'goals', 'goal-2c', decisionAttachment.assetPath),
    ])
    expect(context).toContain('## Relevant Goal Images')
    expect(context).toContain(plannerAttachment.assetPath)
    expect(context).toContain('Sources: planning request PR-1')
    expect(context).toContain(decisionAttachment.assetPath)
    expect(context).toContain('Sources: decision visual-reference')
    expect(context).toContain(
      `Attachment assets: ${plannerAttachment.assetPath}`,
    )
    expect(context).toContain(
      `Attachment assets: ${decisionAttachment.assetPath}`,
    )
    expect(prompt).toContain(
      'When a task materially depends on a referenced Goal image, keep the exact Goal-local asset path(s) under attachmentAssetPaths on that task row.',
    )
    expect(prompt).toContain(
      'attachmentAssetPaths is optional, but when present every value must be an exact Goal-local asset path under assets/.',
    )
  })

  test('passes task attachmentAssetPaths into engineering multimodal input and context', async () => {
    const rootDir = testRoot()
    const assetPath = 'assets/assistant/upload-3/editor-reference.png'
    await writeGoalAsset(rootDir, 'goal-2d', assetPath)

    const builder = createRoleProcessContextBuilder(rootDir)
    const bundle = await builder.prepareBundle({
      goalKey: 'goal-2d',
      goalTitle: 'Goal Two D',
      runId: 'run-2d',
      stepId: 'step-2d',
      role: 'generator',
      task: {
        ref: 'T-2d',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement reference-aligned editor shell',
        description: 'Use the reference image while implementing the new editor shell.',
        acceptanceCriteria: ['Generator receives the real image input.'],
        blockedBy: [],
        attachmentAssetPaths: [assetPath],
      },
    })

    const context = await readFile(bundle.contextFile, 'utf8')

    expect(bundle.imageFiles).toEqual([
      join(rootDir, '.hopi', 'docs', 'goals', 'goal-2d', assetPath),
    ])
    expect(context).toContain('## Relevant Goal Images')
    expect(context).toContain(assetPath)
    expect(context).toContain('Sources: task attachmentAssetPaths')
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
    expect(prompt).toContain(
      'When rejecting generator work, write the reject reason in natural language that the next generator can act on directly.',
    )
    expect(prompt).toContain(
      'State what still exists and what must change next; do not stop at generic wording like "still not aligned" or "needs polish".',
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
        summary: 'Tool call: Bash (bun test packages/backend/tests/server.test.ts)',
        toolName: 'Bash',
        toolInvocationKey: 'shell-1',
      },
    })
    await history.recordStepEvent({
      goalKey: 'goal-6',
      runId: runRef.runId,
      stepId: runRef.stepId,
      event: {
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'tool_result',
        summary: 'Command completed successfully.',
        toolName: 'Bash',
        toolInvocationKey: 'shell-1',
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
    expect(context).toContain(
      'Tool call: Bash (bun test packages/backend/tests/server.test.ts) [shell-1] -> Command completed successfully.',
    )
    expect(prompt).toContain(
      'Correlate artifact refs and prior run history with the claimed work before accepting.',
    )
  })

  test('surfaces latest reviewer reject findings to the next generator prompt', async () => {
    const rootDir = testRoot()
    const history = createRunHistoryStore(rootDir)
    const paths = createProjectPaths(rootDir)

    const rejectedReview = await history.startStep({
      goalKey: 'goal-6b',
      taskRef: 'T-6b',
      taskKind: 'engineering',
      role: 'reviewer',
      statusBefore: 'in_review',
      message: {
        kind: 'system',
        role: 'system',
        content: 'reviewer dispatched for T-6b',
      },
    })
    await history.finishStep({
      goalKey: 'goal-6b',
      runId: rejectedReview.runId,
      stepId: rejectedReview.stepId,
      statusAfter: 'planned',
      outcome: 'reject',
      message: {
        kind: 'system',
        role: 'system',
        content: 'T-6b returned to planned after review rejection',
      },
    })
    await Bun.write(
      paths.runtimeOutcomePath('goal-6b', rejectedReview.runId, rejectedReview.stepId),
      `${JSON.stringify(
        {
          kind: 'reject',
          reason:
            'The saved-deck controls still render as a full-height third pane, and refreshEditor still reserves a persistent summary slab.',
          artifactRef: 'src/game/ui/deckbuilder/DeckManagementPanel.ts',
          artifactLabel: 'DeckManagementPanel review',
        },
        null,
        2,
      )}\n`,
    )

    const builder = createRoleProcessContextBuilder(rootDir)
    const bundle = await builder.prepareBundle({
      goalKey: 'goal-6b',
      goalTitle: 'Goal Six B',
      runId: 'run-generator',
      stepId: 'step-generator',
      role: 'generator',
      task: {
        ref: 'T-6b',
        kind: 'engineering',
        status: 'planned',
        title: 'Refine deck-manager layout',
        description: 'Apply the reviewer-requested deck-manager layout fixes.',
        acceptanceCriteria: ['The latest reviewer findings are visible in the next generator prompt.'],
        blockedBy: [],
      },
    })

    const context = await readFile(bundle.contextFile, 'utf8')
    const prompt = await readFile(bundle.promptFile, 'utf8')

    expect(context).toContain('## Latest Reviewer Findings To Address')
    expect(context).toContain(rejectedReview.runId)
    expect(context).toContain(rejectedReview.stepId)
    expect(context).toContain(
      'The saved-deck controls still render as a full-height third pane, and refreshEditor still reserves a persistent summary slab.',
    )
    expect(context).toContain('Review artifact: src/game/ui/deckbuilder/DeckManagementPanel.ts (DeckManagementPanel review)')
    expect(prompt).toContain('## Latest Reviewer Findings To Address')
    expect(prompt).toContain(
      'If the reviewer called out a specific remaining structure, pane, slab, function, or region, do not return success while it still exists in the code.',
    )
  })

  test('filters runtime and build-artifact noise out of relevant write traces', async () => {
    const rootDir = testRoot()
    const traces = createWriteTraceStore(rootDir)
    await traces.appendEntry('goal-6c', {
      runId: 'run-6c',
      stepId: 'step-generator',
      taskRef: 'T-6c',
      role: 'generator',
      agent: 'process_runner',
      cwd: '/tmp/worktree',
      toolName: 'process',
      callId: 'step-generator',
      targetPaths: [
        'src/game/ui/deckbuilder/DeckManagementPanel.ts',
        '.hopi/runtime/goals/goal-6c/run-history.json',
        '.hopi/worktrees/goal-6c/T-6c/run-6c/dist/index.html',
      ],
      changes: [
        { path: 'src/game/ui/deckbuilder/DeckManagementPanel.ts', kind: 'modified' },
        { path: '.hopi/runtime/goals/goal-6c/run-history.json', kind: 'modified' },
        { path: '.hopi/worktrees/goal-6c/T-6c/run-6c/dist/index.html', kind: 'added' },
      ],
      argumentSummary: 'bun run generator',
      resultSummary: 'exit 0 (3 changed files)',
    })

    const builder = createRoleProcessContextBuilder(rootDir)
    const bundle = await builder.prepareBundle({
      goalKey: 'goal-6c',
      goalTitle: 'Goal Six C',
      runId: 'run-6c',
      stepId: 'step-reviewer',
      role: 'reviewer',
      task: {
        ref: 'T-6c',
        kind: 'engineering',
        status: 'in_review',
        title: 'Review focused source changes',
        description: 'Review only the meaningful source-side write traces.',
        acceptanceCriteria: ['Noise paths are filtered out of relevant write traces.'],
        blockedBy: [],
      },
    })

    const context = await readFile(bundle.contextFile, 'utf8')

    expect(context).toContain('src/game/ui/deckbuilder/DeckManagementPanel.ts')
    expect(context).not.toContain('.hopi/runtime/goals/goal-6c/run-history.json')
    expect(context).not.toContain('.hopi/worktrees/goal-6c/T-6c/run-6c/dist/index.html')
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
    expect(prompt).toContain(
      'When reviewing planning work, accept Browser Harness follow-through when the downstream engineering task clearly names visible verification and either references an existing repo scenario or explicitly requires the generator to create/update one; do not reject planning solely because the scenario asset does not exist yet.',
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

  test('surfaces merge script diagnostics in engineering merger context', async () => {
    const rootDir = testRoot()
    const builder = createRoleProcessContextBuilder(rootDir)
    const scriptPath = join(rootDir, PROJECT_MERGE_SCRIPT_RELATIVE_PATH)
    await mkdir(dirname(scriptPath), { recursive: true })
    await Bun.write(
      scriptPath,
      '#!/usr/bin/env bash\nprintf \'%s\\n\' \'{"kind":"merge_conflict","reason":"root has overlap"}\'\n',
    )
    const attemptPath = mergeScriptAttemptPath(rootDir, {
      goalKey: 'goal-5b',
      runId: 'run-5b',
      stepId: 'step-merger',
    })
    await mkdir(dirname(attemptPath), { recursive: true })
    await Bun.write(
      attemptPath,
      `${JSON.stringify(
        {
          attemptedAt: '2026-06-16T00:00:00.000Z',
          scriptPath,
          command: ['bash', scriptPath, 'goal-5b', 'T-5b'],
          stdout: '{"kind":"merge_conflict","reason":"root has overlap"}\n',
          stderr: 'local changes in DeckManagementPanel.ts\n',
          exitCode: 0,
          result: {
            kind: 'merge_conflict',
            reason: 'root has overlap',
            artifactRef: 'branch:hopi/goal-5b/T-5b/run-5b',
          },
        },
        null,
        2,
      )}\n`,
    )

    const bundle = await builder.prepareBundle({
      goalKey: 'goal-5b',
      goalTitle: 'Goal Five B',
      runId: 'run-5b',
      stepId: 'step-merger',
      role: 'merger',
      task: {
        ref: 'T-5b',
        kind: 'engineering',
        status: 'merging',
        title: 'Merge auth implementation',
        description: 'Merge the task through the project merge script.',
        acceptanceCriteria: ['Merger sees the latest script diagnostics.'],
        blockedBy: [],
      },
    })

    const context = await readFile(bundle.contextFile, 'utf8')
    const prompt = await readFile(bundle.promptFile, 'utf8')

    expect(context).toContain('## Merge Script Attempt To Resolve')
    expect(context).toContain(scriptPath)
    expect(context).toContain('Latest script result: merge_conflict | root has overlap')
    expect(context).toContain('### Current merge script')
    expect(context).toContain('### Latest merge script stdout')
    expect(context).toContain('### Latest merge script stderr')
    expect(prompt).toContain(
      'Merger must let the project merge script attempt the merge first and treat its result as the primary deterministic signal.',
    )
    expect(prompt).toContain(
      'Merger may reconcile worktree product files when necessary, but success is only valid if the merge script succeeds afterward.',
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

async function writeGoalAsset(rootDir: string, goalKey: string, assetPath: string) {
  const absolutePath = join(rootDir, '.hopi', 'docs', 'goals', goalKey, assetPath)
  await mkdir(dirname(absolutePath), { recursive: true })
  await Bun.write(absolutePath, 'img')
}
