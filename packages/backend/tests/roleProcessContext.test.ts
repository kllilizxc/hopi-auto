import { afterEach, describe, expect, test } from 'bun:test'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createRoleProcessContextBuilder } from '../src/runtime/roleProcessContext'
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
    expect(context).toContain('.hopi/preference.md')
    expect(context).toContain('## Goal Docs Status')
    expect(context).toContain('goal.md status: bootstrapped')
    expect(context).toContain('design.md status: bootstrapped')
    expect(context).toContain('Choose the rollout strategy')
    expect(context).toContain('Prefer incremental rollouts.')
    expect(prompt).toContain('## Planner Design Policy')
    expect(prompt).toContain(
      'If design.md is still bootstrapped, replace placeholder sections with durable design detail before returning success.',
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

    expect(context).toContain('## Relevant Write Traces')
    expect(context).toContain('No durable write traces were recorded yet for this task.')
    expect(prompt).toContain(
      'Merger must not return success blindly when engineering write-trace evidence is missing.',
    )
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
