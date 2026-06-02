import { expect, test } from 'bun:test'
import {
  AnswerInterpretationError,
  createInterpretedSourceResponseState,
  materializeInterpretedDecisionAnswerBatch,
  materializeInterpretedDecisionAnswers,
  materializeInterpretedDecisionFollowThrough,
} from '../src/runtime/answerInterpretation'

test('materializes decision and planner answers from named answer sources', () => {
  const answerSources = [
    {
      answerSourceKey: 'auth-strategy-answer',
      answer: 'Use Bun-native auth.',
    },
    {
      answerSourceKey: 'rollout-strategy-answer',
      answer: 'Use a staged rollout.',
    },
    {
      answerSourceKey: 'pilot-scope-answer',
      answer: 'Start with five enterprise customers before broader rollout.',
    },
  ]

  expect(
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          answerSourceKey: 'auth-strategy-answer',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          answerSourceKey: 'rollout-strategy-answer',
        },
      ],
      undefined,
      answerSources,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout.',
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'workflow_batch',
        answers: [
          {
            summary: 'Pilot scope',
            answerSourceKey: 'pilot-scope-answer',
          },
        ],
        workflows: [
          {
            kind: 'planning',
            workflowTaskKey: 'rollout-review',
            title: 'Review rollout readiness',
            description: 'Capture the rollout readiness review.',
            acceptanceCriteria: ['The rollout review is visible.'],
            answers: [
              {
                summary: 'Rollout decision',
                answerSourceKey: 'rollout-strategy-answer',
              },
            ],
            requestedUpdates: ['design.md'],
          },
        ],
      },
      undefined,
      answerSources,
    ),
  ).toEqual({
    kind: 'workflow_batch',
    workflowKey: undefined,
    reuseTaskRef: undefined,
    reuseGroupKey: undefined,
    answers: [
      {
        summary: 'Pilot scope',
        answer: 'Start with five enterprise customers before broader rollout.',
      },
    ],
    workflows: [
      {
        kind: 'planning',
        workflowTaskKey: 'rollout-review',
        title: 'Review rollout readiness',
        description: 'Capture the rollout readiness review.',
        acceptanceCriteria: ['The rollout review is visible.'],
        answers: [
          {
            summary: 'Rollout decision',
            answer: 'Use a staged rollout.',
          },
        ],
        requestedUpdates: ['design.md'],
      },
    ],
  })
})

test('materializes named answer sources from source excerpts inside one shared response', () => {
  const sourceResponse =
    'Use Bun-native auth with a staged rollout to five enterprise customers before broader launch.'

  expect(
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          answerSourceKey: 'auth-strategy-answer',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          answerSourceKey: 'rollout-strategy-answer',
        },
      ],
      sourceResponse,
      [
        {
          answerSourceKey: 'auth-strategy-answer',
          sourceExcerpt: 'Use Bun-native auth',
        },
        {
          answerSourceKey: 'rollout-strategy-answer',
          sourceExcerpt: 'a staged rollout',
        },
        {
          answerSourceKey: 'pilot-scope-answer',
          sourceExcerpt: 'five enterprise customers before broader launch.',
        },
      ],
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'a staged rollout',
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
            answerSourceKey: 'pilot-scope-answer',
          },
        ],
        requests: [
          {
            taskKey: 'goal-docs',
            title: 'Capture auth rollout goal context',
            description: 'Record the auth and rollout answers across Goal docs.',
            acceptanceCriteria: ['The auth and rollout answers are durable.'],
            requestedUpdates: ['goal.md', 'design.md'],
          },
        ],
      },
      sourceResponse,
      [
        {
          answerSourceKey: 'pilot-scope-answer',
          sourceExcerpt: 'five enterprise customers before broader launch.',
        },
      ],
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        answer: 'five enterprise customers before broader launch.',
      },
    ],
    requests: [
      {
        taskKey: 'goal-docs',
        title: 'Capture auth rollout goal context',
        description: 'Record the auth and rollout answers across Goal docs.',
        acceptanceCriteria: ['The auth and rollout answers are durable.'],
        requestedUpdates: ['goal.md', 'design.md'],
      },
    ],
  })
})

test('materializes direct item source excerpts from one shared response without named answer sources', () => {
  const sourceResponse =
    'Use Bun-native auth with a staged rollout to five enterprise customers before broader launch.'

  expect(
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          sourceExcerpt: 'Use Bun-native auth',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          sourceExcerpt: 'a staged rollout',
        },
      ],
      sourceResponse,
      [],
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'a staged rollout',
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
            sourceExcerpt: 'five enterprise customers before broader launch.',
          },
        ],
        requests: [
          {
            taskKey: 'goal-docs',
            title: 'Capture auth rollout goal context',
            description: 'Record the auth and rollout answers across Goal docs.',
            acceptanceCriteria: ['The auth and rollout answers are durable.'],
            requestedUpdates: ['goal.md', 'design.md'],
          },
        ],
      },
      sourceResponse,
      [],
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        answer: 'five enterprise customers before broader launch.',
      },
    ],
    requests: [
      {
        taskKey: 'goal-docs',
        title: 'Capture auth rollout goal context',
        description: 'Record the auth and rollout answers across Goal docs.',
        acceptanceCriteria: ['The auth and rollout answers are durable.'],
        requestedUpdates: ['goal.md', 'design.md'],
      },
    ],
  })
})

test('materializes labeled sections from one shared response without per-topic mapping', () => {
  const sourceResponse = [
    'Auth strategy: Use Bun-native auth',
    'Rollout strategy: Use a staged rollout',
    'Pilot scope: Start with five enterprise customers before broader launch.',
  ].join('\n')

  expect(
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      sourceResponse,
      [],
      'labeled_sections',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout',
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
          },
        ],
        requests: [
          {
            taskKey: 'goal-docs',
            title: 'Capture auth rollout goal context',
            description: 'Record the auth and rollout answers across Goal docs.',
            acceptanceCriteria: ['The auth and rollout answers are durable.'],
            requestedUpdates: ['goal.md', 'design.md'],
          },
        ],
      },
      sourceResponse,
      [],
      'labeled_sections',
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        answer: 'Start with five enterprise customers before broader launch.',
      },
    ],
    requests: [
      {
        taskKey: 'goal-docs',
        title: 'Capture auth rollout goal context',
        description: 'Record the auth and rollout answers across Goal docs.',
        acceptanceCriteria: ['The auth and rollout answers are durable.'],
        requestedUpdates: ['goal.md', 'design.md'],
      },
    ],
  })
})

test('materializes matching open decisions from labeled sections without repeating per-decision entries', () => {
  const sourceResponse = [
    'Auth strategy: Use Bun-native auth',
    'Rollout strategy: Use a staged rollout',
    'Pilot scope: Start with five enterprise customers before broader launch.',
  ].join('\n')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      true,
      sourceResponse,
      [],
      'labeled_sections',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout',
    },
  ])
})

test('materializes new decision topics from remaining labeled sections while reserving planner summaries', () => {
  const sourceResponse = [
    'Auth strategy: Use Bun-native auth',
    'Rollout strategy: Use a staged rollout',
    'Pilot scope: Start with five enterprise customers before broader launch.',
  ].join('\n')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'labeled_sections',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      decisionKey: undefined,
      summary: 'Auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth',
    },
    {
      decisionKey: undefined,
      summary: 'Rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout',
    },
  ])
})

test('materializes inline topic clauses across decision and planner answers without sections or ordered lists', () => {
  const sourceResponse = [
    'Auth strategy should use Bun-native auth;',
    'rollout strategy should use a staged rollout;',
    'pilot scope should start with five enterprise customers before broader launch.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      sourceResponse,
      [],
      'inline_topics',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout',
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
          },
        ],
        requests: [
          {
            taskKey: 'goal-docs',
            title: 'Capture auth rollout goal context',
            description: 'Record the auth and rollout answers across Goal docs.',
            acceptanceCriteria: ['The auth and rollout answers are durable.'],
            requestedUpdates: ['goal.md', 'design.md'],
          },
        ],
      },
      sourceResponse,
      [],
      'inline_topics',
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        answer: 'Start with five enterprise customers before broader launch.',
      },
    ],
    requests: [
      {
        taskKey: 'goal-docs',
        title: 'Capture auth rollout goal context',
        description: 'Record the auth and rollout answers across Goal docs.',
        acceptanceCriteria: ['The auth and rollout answers are durable.'],
        requestedUpdates: ['goal.md', 'design.md'],
      },
    ],
  })
})

test('materializes matching open decisions from inline topic clauses without per-topic mapping', () => {
  const sourceResponse = [
    'Auth strategy should use Bun-native auth;',
    'rollout strategy should use a staged rollout.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      true,
      sourceResponse,
      [],
      'inline_topics',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout.',
    },
  ])
})

test('materializes new decision topics from remaining inline topic clauses while reserving planner summaries', () => {
  const sourceResponse = [
    'Auth strategy should use Bun-native auth;',
    'rollout strategy should use a staged rollout;',
    'pilot scope should start with five enterprise customers before broader launch.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'inline_topics',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      decisionKey: undefined,
      summary: 'Auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth',
    },
    {
      decisionKey: undefined,
      summary: 'rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout',
    },
  ])
})

test('materializes topic sentences across decision and planner answers without inline labels or ordered lists', () => {
  const sourceResponse = [
    'We should use Bun-native auth for auth strategy.',
    'Use a staged rollout for rollout strategy.',
    'Start with five enterprise customers before broader launch for pilot scope.',
  ].join(' ')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_sentences')

  expect(
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      sourceResponse,
      [],
      'topic_sentences',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'We should use Bun-native auth for auth strategy.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout for rollout strategy.',
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
          },
        ],
        requests: [
          {
            taskKey: 'goal-docs',
            title: 'Capture auth rollout goal context',
            description: 'Record the auth and rollout answers across Goal docs.',
            acceptanceCriteria: ['The auth and rollout answers are durable.'],
            requestedUpdates: ['goal.md', 'design.md'],
          },
        ],
      },
      sourceResponse,
      [],
      'topic_sentences',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        answer: 'Start with five enterprise customers before broader launch for pilot scope.',
      },
    ],
    requests: [
      {
        taskKey: 'goal-docs',
        title: 'Capture auth rollout goal context',
        description: 'Record the auth and rollout answers across Goal docs.',
        acceptanceCriteria: ['The auth and rollout answers are durable.'],
        requestedUpdates: ['goal.md', 'design.md'],
      },
    ],
  })
})

test('materializes matching open decisions from topic sentences without per-topic mapping', () => {
  const sourceResponse = [
    'We should use Bun-native auth for auth strategy.',
    'Use a staged rollout for rollout strategy.',
    'Start with five enterprise customers before broader launch for pilot scope.',
  ].join(' ')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_sentences')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      true,
      sourceResponse,
      [],
      'topic_sentences',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'We should use Bun-native auth for auth strategy.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout for rollout strategy.',
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
          },
        ],
        requests: [
          {
            taskKey: 'goal-docs',
            title: 'Capture auth rollout goal context',
            description: 'Record the auth and rollout answers across Goal docs.',
            acceptanceCriteria: ['The auth and rollout answers are durable.'],
            requestedUpdates: ['goal.md', 'design.md'],
          },
        ],
      },
      sourceResponse,
      [],
      'topic_sentences',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        answer: 'Start with five enterprise customers before broader launch for pilot scope.',
      },
    ],
    requests: [
      {
        taskKey: 'goal-docs',
        title: 'Capture auth rollout goal context',
        description: 'Record the auth and rollout answers across Goal docs.',
        acceptanceCriteria: ['The auth and rollout answers are durable.'],
        requestedUpdates: ['goal.md', 'design.md'],
      },
    ],
  })
})

test('materializes ordered items across decision and planner answers without labels', () => {
  const sourceResponse = [
    '- Use Bun-native auth',
    '- Use a staged rollout',
    '- Start with five enterprise customers before broader launch.',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'ordered_items')

  expect(
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      sourceResponse,
      [],
      'ordered_items',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout',
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
          },
        ],
        requests: [
          {
            taskKey: 'goal-docs',
            title: 'Capture auth rollout goal context',
            description: 'Record the auth and rollout answers across Goal docs.',
            acceptanceCriteria: ['The auth and rollout answers are durable.'],
            requestedUpdates: ['goal.md', 'design.md'],
          },
        ],
      },
      sourceResponse,
      [],
      'ordered_items',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        answer: 'Start with five enterprise customers before broader launch.',
      },
    ],
    requests: [
      {
        taskKey: 'goal-docs',
        title: 'Capture auth rollout goal context',
        description: 'Record the auth and rollout answers across Goal docs.',
        acceptanceCriteria: ['The auth and rollout answers are durable.'],
        requestedUpdates: ['goal.md', 'design.md'],
      },
    ],
  })
})

test('materializes matching open decisions from ordered items without labels', () => {
  const sourceResponse = ['Use Bun-native auth', 'Use a staged rollout'].join('\n')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      true,
      sourceResponse,
      [],
      'ordered_items',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout',
    },
  ])
})

test('rejects inferOpenDecisions when labeled-section interpretation is not enabled', () => {
  expect(() =>
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
      ],
      true,
      'Auth strategy: Use Bun-native auth',
      [],
      undefined,
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'inferOpenDecisions requires sourceResponseFormat "labeled_sections", "ordered_items", "inline_topics", or "topic_sentences".',
    ),
  )
})

test('rejects inferDecisionTopics when labeled-section interpretation is not enabled', () => {
  expect(() =>
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      'Auth strategy: Use Bun-native auth',
      [],
      'ordered_items',
      undefined,
      true,
      [],
      [],
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'inferDecisionTopics requires sourceResponseFormat "labeled_sections" or "inline_topics".',
    ),
  )
})

test('rejects inline-topic interpretation when one requested topic is missing', () => {
  const sourceResponse = 'Auth strategy should use Bun-native auth.'

  expect(() =>
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      sourceResponse,
      [],
      'inline_topics',
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'No inline topic clause matched decision answer rollout-strategy in sourceResponse.',
    ),
  )
})

test('rejects topic-sentence interpretation when one requested topic matches more than one sentence', () => {
  const sourceResponse = [
    'Use Bun-native auth for auth strategy.',
    'Document Bun-native fallback decisions for auth strategy.',
  ].join(' ')

  expect(() =>
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
      ],
      sourceResponse,
      [],
      'topic_sentences',
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'Multiple topic sentences matched decision answer auth-strategy in sourceResponse.',
    ),
  )
})

test('rejects ordered-item interpretation when not enough items remain', () => {
  expect(() =>
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      'Use Bun-native auth',
      [],
      'ordered_items',
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'No ordered item remained for decision answer rollout-strategy in sourceResponse.',
    ),
  )
})

test('rejects unknown answer source keys deterministically', () => {
  expect(() =>
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          answerSourceKey: 'missing-source',
        },
      ],
      undefined,
      [],
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'Unknown answerSourceKey "missing-source" for decision answer auth-strategy.',
    ),
  )
})

test('rejects duplicate answer source keys deterministically', () => {
  expect(() =>
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          answerSourceKey: 'shared-answer',
        },
      ],
      undefined,
      [
        {
          answerSourceKey: 'shared-answer',
          answer: 'Use Bun-native auth.',
        },
        {
          answerSourceKey: 'shared-answer',
          answer: 'Use a staged rollout.',
        },
      ],
    ),
  ).toThrowError(new AnswerInterpretationError('Duplicate answerSourceKey: shared-answer'))
})

test('rejects excerpt-backed answer sources when the excerpt is not present in sourceResponse', () => {
  expect(() =>
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          answerSourceKey: 'auth-strategy-answer',
        },
      ],
      'Use Bun-native auth with a staged rollout.',
      [
        {
          answerSourceKey: 'auth-strategy-answer',
          sourceExcerpt: 'Use OAuth device flow',
        },
      ],
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'sourceExcerpt for answerSourceKey "auth-strategy-answer" was not found in sourceResponse.',
    ),
  )
})

test('rejects excerpt-backed answer sources when sourceResponse is missing', () => {
  expect(() =>
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          answerSourceKey: 'auth-strategy-answer',
        },
      ],
      undefined,
      [
        {
          answerSourceKey: 'auth-strategy-answer',
          sourceExcerpt: 'Use Bun-native auth',
        },
      ],
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'sourceExcerpt for answerSourceKey "auth-strategy-answer" requires sourceResponse.',
    ),
  )
})

test('rejects direct item source excerpts when sourceResponse is missing', () => {
  expect(() =>
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          sourceExcerpt: 'Use Bun-native auth',
        },
      ],
      undefined,
      [],
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'sourceExcerpt for decision answer auth-strategy requires sourceResponse.',
    ),
  )
})

test('rejects labeled-section interpretation when one requested topic is missing', () => {
  const sourceResponse = [
    'Auth strategy: Use Bun-native auth',
    'Pilot scope: Start with five enterprise customers before broader launch.',
  ].join('\n')

  expect(() =>
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      sourceResponse,
      [],
      'labeled_sections',
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'No labeled section matched decision answer rollout-strategy in sourceResponse.',
    ),
  )
})
