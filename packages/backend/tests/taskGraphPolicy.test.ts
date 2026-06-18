import { describe, expect, test } from 'bun:test'
import {
  inspectBrowserHarnessAcceptanceCriteria,
  inspectEngineeringTaskDecomposition,
} from '../src/runtime/taskGraphPolicy'

describe('inspectEngineeringTaskDecomposition', () => {
  test('flags unordered engineering tasks that share a primary surface hint', () => {
    const issues = inspectEngineeringTaskDecomposition({
      version: 1,
      goal: {
        goalKey: 'goal-1',
        title: 'Goal One',
      },
      items: [
        {
          ref: 'T-1',
          kind: 'engineering',
          status: 'planned',
          title: 'Reshape deck editor shell',
          description:
            'Rebuild the main editor around `DeckManagementPanel` and keep the panel dense.',
          acceptanceCriteria: ['`DeckManagementPanel` exposes the split-pane shell.'],
          blockedBy: [],
        },
        {
          ref: 'T-2',
          kind: 'engineering',
          status: 'planned',
          title: 'Preserve utility interactions',
          description:
            'Keep keyboard and IME behaviors inside `DeckManagementPanel` while the shell changes.',
          acceptanceCriteria: ['`DeckManagementPanel` keeps rename/search flows intact.'],
          blockedBy: [],
        },
      ],
    })

    expect(issues).toEqual([
      expect.objectContaining({
        taskRefs: ['T-1', 'T-2'],
        sharedSurfaceHints: ['deckmanagementpanel'],
      }),
    ])
  })

  test('allows overlapping surfaces when tasks are explicitly ordered with blockedBy.task', () => {
    const issues = inspectEngineeringTaskDecomposition({
      version: 1,
      goal: {
        goalKey: 'goal-1',
        title: 'Goal One',
      },
      items: [
        {
          ref: 'T-1',
          kind: 'engineering',
          status: 'planned',
          title: 'Reshape deck editor shell',
          description: 'Rebuild `DeckManagementPanel`.',
          acceptanceCriteria: ['`DeckManagementPanel` exposes the new shell.'],
          blockedBy: [],
        },
        {
          ref: 'T-2',
          kind: 'engineering',
          status: 'planned',
          title: 'Harden utility interactions',
          description: 'Polish keyboard handling inside `DeckManagementPanel`.',
          acceptanceCriteria: ['`DeckManagementPanel` keeps keyboard flows intact.'],
          blockedBy: [{ kind: 'task', ref: 'T-1' }],
        },
      ],
    })

    expect(issues).toEqual([])
  })
})

describe('inspectBrowserHarnessAcceptanceCriteria', () => {
  test('flags UI engineering tasks without Browser Harness acceptance', () => {
    const issues = inspectBrowserHarnessAcceptanceCriteria({
      version: 1,
      goal: {
        goalKey: 'goal-1',
        title: 'Goal One',
      },
      items: [
        {
          ref: 'T-1',
          kind: 'engineering',
          status: 'planned',
          title: 'Polish deck manager layout',
          description: 'Adjust the browser panel and visible buttons.',
          acceptanceCriteria: ['The deck manager pane balance is improved.'],
          blockedBy: [],
        },
      ],
    })

    expect(issues).toEqual([
      {
        taskRef: 'T-1',
        message:
          'UI/e2e task T-1 must include a Browser harness: acceptance criterion naming the scenario path or a credible not-applicable reason.',
      },
    ])
  })

  test('allows UI engineering tasks with Browser Harness acceptance', () => {
    const issues = inspectBrowserHarnessAcceptanceCriteria({
      version: 1,
      goal: {
        goalKey: 'goal-1',
        title: 'Goal One',
      },
      items: [
        {
          ref: 'T-1',
          kind: 'engineering',
          status: 'planned',
          title: 'Polish deck manager layout',
          description: 'Adjust the browser panel and visible buttons.',
          acceptanceCriteria: [
            'Browser harness: create or update scripts/hopi/browser-harness/scenarios/deck-manager-layout.py and verify the browser panel remains visible.',
          ],
          blockedBy: [],
        },
      ],
    })

    expect(issues).toEqual([])
  })

  test('does not require Browser Harness acceptance for non-UI tasks', () => {
    const issues = inspectBrowserHarnessAcceptanceCriteria({
      version: 1,
      goal: {
        goalKey: 'goal-1',
        title: 'Goal One',
      },
      items: [
        {
          ref: 'T-1',
          kind: 'engineering',
          status: 'planned',
          title: 'Normalize deck persistence records',
          description: 'Refactor saved deck serialization.',
          acceptanceCriteria: ['Saved deck data remains round-trippable.'],
          blockedBy: [],
        },
      ],
    })

    expect(issues).toEqual([])
  })

  test('allows explicit not-applicable Browser Harness rationale', () => {
    const issues = inspectBrowserHarnessAcceptanceCriteria({
      version: 1,
      goal: {
        goalKey: 'goal-1',
        title: 'Goal One',
      },
      items: [
        {
          ref: 'T-1',
          kind: 'engineering',
          status: 'planned',
          title: 'Rename browser state constants',
          description: 'Rename constants without browser-visible behavior.',
          acceptanceCriteria: [
            'Browser harness: not applicable because this only renames internal constants and has no browser-visible behavior.',
          ],
          blockedBy: [],
        },
      ],
    })

    expect(issues).toEqual([])
  })
})
