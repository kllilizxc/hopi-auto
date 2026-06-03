import { describe, expect, test } from 'bun:test'
import { formatAssistantActionResultDetails } from '../src/ui/assistantActionResultDetails'

describe('formatAssistantActionResultDetails', () => {
  test('surfaces the resolved source-response format for interpreted assistant actions', () => {
    expect(
      formatAssistantActionResultDetails({
        kind: 'record_answers',
        summary: 'Captured shared answers.',
        createdDecisionKeys: ['D-1'],
        blockerRemoved: true,
        resolvedSourceResponseFormat: 'topic_closing_blocks',
        followThrough: {
          kind: 'planning_batch',
          groupKey: 'auth-rollout-follow-through',
          requestKeys: ['PR-1', 'PR-2'],
          taskRefs: ['P-1', 'P-2'],
          blockerTaskRefs: ['P-2'],
        },
      }),
    ).toEqual([
      'Created decision keys: D-1',
      'Decision blocker removed: yes',
      'Resolved source-response format: topic_closing_blocks',
      'Follow-through kind: planning_batch',
      'Follow-through group key: auth-rollout-follow-through',
      'Follow-through requests: PR-1, PR-2',
      'Follow-through tasks: P-1, P-2',
      'Follow-through blockers: P-2',
    ])
  })
})
