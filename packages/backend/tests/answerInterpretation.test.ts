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
    inferRemainingAnswers: undefined,
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
      prompt: 'What should the auth strategy be?',
      taskRef: undefined,
      answer: 'Use Bun-native auth',
    },
    {
      decisionKey: undefined,
      summary: 'Rollout strategy',
      prompt: 'What should the rollout strategy be?',
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
      prompt: 'What should the auth strategy be?',
      taskRef: undefined,
      answer: 'Use Bun-native auth',
    },
    {
      decisionKey: undefined,
      summary: 'rollout strategy',
      prompt: 'What should the rollout strategy be?',
      taskRef: undefined,
      answer: 'Use a staged rollout',
    },
  ])
})

test('materializes topic clauses across decision and planner answers without sentence boundaries', () => {
  const sourceResponse = [
    'Use Bun-native auth for auth strategy,',
    'use a staged rollout for rollout strategy,',
    'start with five enterprise customers before broader launch for pilot scope.',
  ].join(' ')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_clauses')

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
      'topic_clauses',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth for auth strategy',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'use a staged rollout for rollout strategy',
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
      'topic_clauses',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        answer: 'start with five enterprise customers before broader launch for pilot scope.',
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

test('materializes inferred planner answers from remaining topic clauses without explicit follow-through summaries', () => {
  const sourceResponse = [
    'Use Bun-native auth for auth strategy,',
    'use a staged rollout for rollout strategy,',
    'start with five enterprise customers before broader launch for pilot scope.',
  ].join(' ')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_clauses')

  expect(
    materializeInterpretedDecisionAnswerBatch(
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
      [],
      false,
      sourceResponse,
      [],
      'topic_clauses',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth for auth strategy',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'use a staged rollout for rollout strategy',
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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
      'topic_clauses',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    inferRemainingAnswers: true,
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'What should the pilot scope be?',
        answer: 'start with five enterprise customers before broader launch for pilot scope.',
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

test('materializes matching open decisions from topic clauses by durable prompt keyword anchors', () => {
  const sourceResponse = [
    'Adopt the Bun-native auth provider for the Bun-first product path auth provider,',
    'rollout should happen in stages rather than once.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'topic_clauses',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Adopt the Bun-native auth provider for the Bun-first product path auth provider',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'rollout should happen in stages rather than once.',
    },
  ])
})

test('materializes new decision topics from remaining topic clauses while reserving planner summaries', () => {
  const sourceResponse = [
    'Use Bun-native auth for auth strategy,',
    'use a staged rollout for rollout strategy,',
    'start with five enterprise customers before broader launch for pilot scope.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'topic_clauses',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      decisionKey: undefined,
      summary: 'Auth strategy',
      prompt: 'What should the auth strategy be?',
      taskRef: undefined,
      answer: 'Use Bun-native auth for auth strategy',
    },
    {
      decisionKey: undefined,
      summary: 'Rollout strategy',
      prompt: 'What should the rollout strategy be?',
      taskRef: undefined,
      answer: 'use a staged rollout for rollout strategy',
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

test('materializes matching open decisions from topic sentences by durable prompt keyword anchors', () => {
  const sourceResponse = [
    'Adopt the Bun-native auth provider for the Bun-first product path.',
    'Rollout should happen in stages, not once.',
    'Start with five enterprise customers before broader launch for pilot scope.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'topic_sentences',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Adopt the Bun-native auth provider for the Bun-first product path.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Rollout should happen in stages, not once.',
    },
  ])
})

test('materializes new decision topics from remaining topic sentences while reserving planner summaries', () => {
  const sourceResponse = [
    'We should use Bun-native auth for auth strategy.',
    'Use a staged rollout for rollout strategy.',
    'Start with five enterprise customers before broader launch for pilot scope.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'topic_sentences',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      decisionKey: undefined,
      summary: 'Auth strategy',
      prompt: 'What should the auth strategy be?',
      taskRef: undefined,
      answer: 'We should use Bun-native auth for auth strategy.',
    },
    {
      decisionKey: undefined,
      summary: 'Rollout strategy',
      prompt: 'What should the rollout strategy be?',
      taskRef: undefined,
      answer: 'Use a staged rollout for rollout strategy.',
    },
  ])
})

test('materializes new decision topics from remaining leading topic sentences while reserving planner summaries', () => {
  const sourceResponse = [
    'Auth strategy should use Bun-native auth.',
    'Rollout strategy should use a staged rollout.',
    'Pilot scope should start with five enterprise customers before broader launch.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'topic_sentences',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      decisionKey: undefined,
      summary: 'Auth strategy',
      prompt: 'What should the auth strategy be?',
      taskRef: undefined,
      answer: 'Auth strategy should use Bun-native auth.',
    },
    {
      decisionKey: undefined,
      summary: 'Rollout strategy',
      prompt: 'What should the rollout strategy be?',
      taskRef: undefined,
      answer: 'Rollout strategy should use a staged rollout.',
    },
  ])
})

test('materializes new decision topics from remaining prefixed topic sentences while reserving planner summaries', () => {
  const sourceResponse = [
    'For auth strategy, use Bun-native auth.',
    'Regarding rollout strategy, use a staged rollout.',
    'About pilot scope, start with five enterprise customers before broader launch.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'topic_sentences',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      decisionKey: undefined,
      summary: 'Auth strategy',
      prompt: 'What should the auth strategy be?',
      taskRef: undefined,
      answer: 'For auth strategy, use Bun-native auth.',
    },
    {
      decisionKey: undefined,
      summary: 'Rollout strategy',
      prompt: 'What should the rollout strategy be?',
      taskRef: undefined,
      answer: 'Regarding rollout strategy, use a staged rollout.',
    },
  ])
})

test('materializes new decision topics from remaining as-topic sentences while reserving planner summaries', () => {
  const sourceResponse = [
    'Use Bun-native auth as the auth strategy.',
    'Use a staged rollout as the rollout strategy.',
    'Start with five enterprise customers before broader launch as the pilot scope.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'topic_sentences',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      decisionKey: undefined,
      summary: 'Auth strategy',
      prompt: 'What should the auth strategy be?',
      taskRef: undefined,
      answer: 'Use Bun-native auth as the auth strategy.',
    },
    {
      decisionKey: undefined,
      summary: 'Rollout strategy',
      prompt: 'What should the rollout strategy be?',
      taskRef: undefined,
      answer: 'Use a staged rollout as the rollout strategy.',
    },
  ])
})

test('materializes new decision topics from remaining copular topic sentences while reserving planner summaries', () => {
  const sourceResponse = [
    'Bun-native auth should be the auth strategy.',
    'A staged rollout should be the rollout strategy.',
    'Five enterprise customers should be the pilot scope.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'topic_sentences',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      decisionKey: undefined,
      summary: 'Auth strategy',
      prompt: 'What should the auth strategy be?',
      taskRef: undefined,
      answer: 'Bun-native auth should be the auth strategy.',
    },
    {
      decisionKey: undefined,
      summary: 'Rollout strategy',
      prompt: 'What should the rollout strategy be?',
      taskRef: undefined,
      answer: 'A staged rollout should be the rollout strategy.',
    },
  ])
})

test('materializes topic spans across decision and planner answers without block boundaries', () => {
  const sourceResponse = [
    'We should use Bun-native auth for auth strategy.',
    'That keeps the runtime simple.',
    'Use a staged rollout for rollout strategy.',
    'That keeps the launch reversible.',
    'Start with five enterprise customers before broader launch for pilot scope.',
    'That keeps early support manageable.',
  ].join(' ')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_spans')

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
      'topic_spans',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'We should use Bun-native auth for auth strategy. That keeps the runtime simple.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout for rollout strategy. That keeps the launch reversible.',
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
      'topic_spans',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        answer:
          'Start with five enterprise customers before broader launch for pilot scope. That keeps early support manageable.',
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

test('materializes matching open decisions from topic spans by durable prompt keyword anchors', () => {
  const sourceResponse = [
    'Adopt the Bun-native auth provider for the Bun-first product path.',
    'That keeps the runtime simple.',
    'Rollout should happen in stages, not once.',
    'That keeps the launch reversible.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'topic_spans',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer:
        'Adopt the Bun-native auth provider for the Bun-first product path. That keeps the runtime simple.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Rollout should happen in stages, not once. That keeps the launch reversible.',
    },
  ])
})

test('materializes new decision topics from remaining topic spans while reserving planner summaries', () => {
  const sourceResponse = [
    'We should use Bun-native auth for auth strategy.',
    'That keeps the runtime simple.',
    'Use a staged rollout for rollout strategy.',
    'That keeps the launch reversible.',
    'Start with five enterprise customers before broader launch for pilot scope.',
    'That keeps early support manageable.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'topic_spans',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      decisionKey: undefined,
      summary: 'Auth strategy',
      prompt: 'What should the auth strategy be?',
      taskRef: undefined,
      answer: 'We should use Bun-native auth for auth strategy. That keeps the runtime simple.',
    },
    {
      decisionKey: undefined,
      summary: 'Rollout strategy',
      prompt: 'What should the rollout strategy be?',
      taskRef: undefined,
      answer: 'Use a staged rollout for rollout strategy. That keeps the launch reversible.',
    },
  ])
})

test('materializes inferred planner answers from remaining topic spans without explicit follow-through summaries', () => {
  const sourceResponse = [
    'We should use Bun-native auth for auth strategy.',
    'That keeps the runtime simple.',
    'Use a staged rollout for rollout strategy.',
    'That keeps the launch reversible.',
    'Start with five enterprise customers before broader launch for pilot scope.',
    'That keeps early support manageable.',
  ].join(' ')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_spans')

  expect(
    materializeInterpretedDecisionAnswerBatch(
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
      [],
      false,
      sourceResponse,
      [],
      'topic_spans',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'We should use Bun-native auth for auth strategy. That keeps the runtime simple.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout for rollout strategy. That keeps the launch reversible.',
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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
      'topic_spans',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    inferRemainingAnswers: true,
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'What should the pilot scope be?',
        answer:
          'Start with five enterprise customers before broader launch for pilot scope. That keeps early support manageable.',
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

test('materializes topic middle spans across decision and planner answers with anchor sentences in the middle', () => {
  const sourceResponse = [
    'Keep the runtime simple.',
    'We should use Bun-native auth for auth strategy.',
    'That avoids extra infra.',
    'Launch in phases.',
    'Use a staged rollout for rollout strategy.',
    'That keeps the launch reversible.',
    'Keep support load manageable.',
    'Start with five enterprise customers before broader launch for pilot scope.',
    'That keeps the pilot focused.',
  ].join(' ')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_middle_spans')

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
      'topic_middle_spans',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer:
        'Keep the runtime simple. We should use Bun-native auth for auth strategy. That avoids extra infra.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer:
        'Launch in phases. Use a staged rollout for rollout strategy. That keeps the launch reversible.',
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
      'topic_middle_spans',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        answer:
          'Keep support load manageable. Start with five enterprise customers before broader launch for pilot scope. That keeps the pilot focused.',
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

test('materializes new decision topics from remaining topic middle spans while reserving planner summaries', () => {
  const sourceResponse = [
    'Keep the runtime simple.',
    'We should use Bun-native auth for auth strategy.',
    'That avoids extra infra.',
    'Launch in phases.',
    'Use a staged rollout for rollout strategy.',
    'That keeps the launch reversible.',
    'Keep support load manageable.',
    'Start with five enterprise customers before broader launch for pilot scope.',
    'That keeps the pilot focused.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'topic_middle_spans',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      decisionKey: undefined,
      summary: 'Auth strategy',
      prompt: 'What should the auth strategy be?',
      taskRef: undefined,
      answer:
        'Keep the runtime simple. We should use Bun-native auth for auth strategy. That avoids extra infra.',
    },
    {
      decisionKey: undefined,
      summary: 'Rollout strategy',
      prompt: 'What should the rollout strategy be?',
      taskRef: undefined,
      answer:
        'Launch in phases. Use a staged rollout for rollout strategy. That keeps the launch reversible.',
    },
  ])
})

test('rejects topic middle span interpretation when adjacent anchors do not leave both trailing and leading sentences', () => {
  const sourceResponse = [
    'Keep the runtime simple.',
    'We should use Bun-native auth for auth strategy.',
    'Use a staged rollout for rollout strategy.',
    'That keeps the launch reversible.',
  ].join(' ')

  expect(() =>
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'topic_middle_spans',
      undefined,
      true,
      [],
      [],
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'sourceResponseFormat topic_middle_spans requires at least one trailing sentence before the next topic anchor sentence and at least one leading sentence for that next span.',
    ),
  )
})

test('materializes topic closing spans across decision and planner answers without front-loaded topic anchors', () => {
  const sourceResponse = [
    'We should use Bun-native auth.',
    'That keeps the runtime simple for auth strategy.',
    'Use a staged rollout.',
    'That keeps the launch reversible for rollout strategy.',
    'Start with five enterprise customers before broader launch.',
    'That keeps early support manageable for pilot scope.',
  ].join(' ')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_closing_spans')

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
      'topic_closing_spans',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'We should use Bun-native auth. That keeps the runtime simple for auth strategy.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout. That keeps the launch reversible for rollout strategy.',
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
      'topic_closing_spans',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        answer:
          'Start with five enterprise customers before broader launch. That keeps early support manageable for pilot scope.',
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

test('materializes matching open decisions from topic closing spans by durable prompt keyword anchors', () => {
  const sourceResponse = [
    'Use Bun-native auth.',
    'Adopt the Bun-native auth provider for the Bun-first product path.',
    'Use a staged rollout.',
    'Rollout should happen in stages, not once.',
    'Start with five enterprise customers before broader launch.',
    'That keeps early support manageable for pilot scope.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'topic_closing_spans',
      undefined,
      false,
      [],
      [['Pilot scope']],
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer:
        'Use Bun-native auth. Adopt the Bun-native auth provider for the Bun-first product path.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout. Rollout should happen in stages, not once.',
    },
  ])
})

test('materializes new decision topics from remaining topic closing spans while reserving planner summaries', () => {
  const sourceResponse = [
    'We should use Bun-native auth.',
    'That keeps the runtime simple for auth strategy.',
    'Use a staged rollout.',
    'That keeps the launch reversible for rollout strategy.',
    'Start with five enterprise customers before broader launch.',
    'That keeps early support manageable for pilot scope.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'topic_closing_spans',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      decisionKey: undefined,
      summary: 'Auth strategy',
      prompt: 'What should the auth strategy be?',
      taskRef: undefined,
      answer: 'We should use Bun-native auth. That keeps the runtime simple for auth strategy.',
    },
    {
      decisionKey: undefined,
      summary: 'Rollout strategy',
      prompt: 'What should the rollout strategy be?',
      taskRef: undefined,
      answer: 'Use a staged rollout. That keeps the launch reversible for rollout strategy.',
    },
  ])
})

test('materializes inferred planner answers from remaining topic closing spans without explicit follow-through summaries', () => {
  const sourceResponse = [
    'We should use Bun-native auth.',
    'That keeps the runtime simple for auth strategy.',
    'Use a staged rollout.',
    'That keeps the launch reversible for rollout strategy.',
    'Start with five enterprise customers before broader launch.',
    'That keeps early support manageable for pilot scope.',
  ].join(' ')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_closing_spans')

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
      'topic_closing_spans',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'We should use Bun-native auth. That keeps the runtime simple for auth strategy.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout. That keeps the launch reversible for rollout strategy.',
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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
      'topic_closing_spans',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    inferRemainingAnswers: true,
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'What should the pilot scope be?',
        answer:
          'Start with five enterprise customers before broader launch. That keeps early support manageable for pilot scope.',
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

test('materializes topic closing blocks across decision and planner answers without front-loaded topic anchor paragraphs', () => {
  const sourceResponse = [
    'We should use Bun-native auth.',
    '',
    'That keeps the runtime simple for auth strategy.',
    '',
    'Use a staged rollout.',
    '',
    'That keeps the launch reversible for rollout strategy.',
    '',
    'Start with five enterprise customers before broader launch.',
    '',
    'That keeps early support manageable for pilot scope.',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_closing_blocks')

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
      'topic_closing_blocks',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: [
        'We should use Bun-native auth.',
        'That keeps the runtime simple for auth strategy.',
      ].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: [
        'Use a staged rollout.',
        'That keeps the launch reversible for rollout strategy.',
      ].join('\n\n'),
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
      'topic_closing_blocks',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        answer: [
          'Start with five enterprise customers before broader launch.',
          'That keeps early support manageable for pilot scope.',
        ].join('\n\n'),
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

test('materializes matching open decisions from topic closing blocks by durable prompt keyword anchors', () => {
  const sourceResponse = [
    'Use Bun-native auth.',
    '',
    'Adopt the Bun-native auth provider for the Bun-first product path.',
    '',
    'Use a staged rollout.',
    '',
    'Rollout should happen in stages, not once.',
    '',
    'Start with five enterprise customers before broader launch.',
    '',
    'That keeps early support manageable for pilot scope.',
  ].join('\n')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'topic_closing_blocks',
      undefined,
      false,
      [],
      [['Pilot scope']],
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: [
        'Use Bun-native auth.',
        'Adopt the Bun-native auth provider for the Bun-first product path.',
      ].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: ['Use a staged rollout.', 'Rollout should happen in stages, not once.'].join('\n\n'),
    },
  ])
})

test('materializes new decision topics from remaining topic closing blocks while reserving planner summaries', () => {
  const sourceResponse = [
    'We should use Bun-native auth.',
    '',
    'That keeps the runtime simple for auth strategy.',
    '',
    'Use a staged rollout.',
    '',
    'That keeps the launch reversible for rollout strategy.',
    '',
    'Start with five enterprise customers before broader launch.',
    '',
    'That keeps early support manageable for pilot scope.',
  ].join('\n')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'topic_closing_blocks',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      decisionKey: undefined,
      summary: 'Auth strategy',
      prompt: 'What should the auth strategy be?',
      taskRef: undefined,
      answer: [
        'We should use Bun-native auth.',
        'That keeps the runtime simple for auth strategy.',
      ].join('\n\n'),
    },
    {
      decisionKey: undefined,
      summary: 'Rollout strategy',
      prompt: 'What should the rollout strategy be?',
      taskRef: undefined,
      answer: [
        'Use a staged rollout.',
        'That keeps the launch reversible for rollout strategy.',
      ].join('\n\n'),
    },
  ])
})

test('materializes inferred planner answers from remaining topic closing blocks without explicit follow-through summaries', () => {
  const sourceResponse = [
    'We should use Bun-native auth.',
    '',
    'That keeps the runtime simple for auth strategy.',
    '',
    'Use a staged rollout.',
    '',
    'That keeps the launch reversible for rollout strategy.',
    '',
    'Start with five enterprise customers before broader launch.',
    '',
    'That keeps early support manageable for pilot scope.',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_closing_blocks')

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
      'topic_closing_blocks',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: [
        'We should use Bun-native auth.',
        'That keeps the runtime simple for auth strategy.',
      ].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: [
        'Use a staged rollout.',
        'That keeps the launch reversible for rollout strategy.',
      ].join('\n\n'),
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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
      'topic_closing_blocks',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    inferRemainingAnswers: true,
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'What should the pilot scope be?',
        answer: [
          'Start with five enterprise customers before broader launch.',
          'That keeps early support manageable for pilot scope.',
        ].join('\n\n'),
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

test('materializes topic paragraphs across decision and planner answers without per-sentence topic labels', () => {
  const sourceResponse = [
    'We should use Bun-native auth for auth strategy. That keeps the runtime simple.',
    '',
    'Use a staged rollout for rollout strategy. That keeps the launch reversible.',
    '',
    'Start with five enterprise customers before broader launch for pilot scope. That keeps early support manageable.',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_paragraphs')

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
      'topic_paragraphs',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'We should use Bun-native auth for auth strategy. That keeps the runtime simple.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout for rollout strategy. That keeps the launch reversible.',
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
      'topic_paragraphs',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        answer:
          'Start with five enterprise customers before broader launch for pilot scope. That keeps early support manageable.',
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

test('materializes matching open decisions from topic paragraphs by durable prompt keyword anchors', () => {
  const sourceResponse = [
    'Adopt the Bun-native auth provider for the Bun-first product path. That keeps the runtime simple.',
    '',
    'Rollout should happen in stages, not once. That keeps the launch reversible.',
  ].join('\n')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'topic_paragraphs',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer:
        'Adopt the Bun-native auth provider for the Bun-first product path. That keeps the runtime simple.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Rollout should happen in stages, not once. That keeps the launch reversible.',
    },
  ])
})

test('materializes matching open decisions and planner answers from topic paragraphs by durable match hints', () => {
  const sourceResponse = [
    'Login path should use Bun-native auth. That keeps the runtime simple.',
    '',
    'Launch shape should use a staged rollout. That keeps the launch reversible.',
    '',
    'Early customer set should stay limited to five enterprise customers. That keeps early support manageable.',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_paragraphs')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt:
            'Which authentication provider should the Bun-first runtime adopt before coding continues?',
          matchHints: ['login path'],
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should launch happen in waves or all at once after readiness review?',
          matchHints: ['launch shape'],
        },
      ],
      true,
      sourceResponse,
      [],
      'topic_paragraphs',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Login path should use Bun-native auth. That keeps the runtime simple.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Launch shape should use a staged rollout. That keeps the launch reversible.',
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
            prompt: 'Which cohort should we expose first after readiness review?',
            matchHints: ['early customer set'],
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
      'topic_paragraphs',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'Which cohort should we expose first after readiness review?',
        matchHints: ['early customer set'],
        answer:
          'Early customer set should stay limited to five enterprise customers. That keeps early support manageable.',
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

test('materializes new decision topics from remaining topic paragraphs while reserving planner summaries', () => {
  const sourceResponse = [
    'We should use Bun-native auth for auth strategy. That keeps the runtime simple.',
    '',
    'Use a staged rollout for rollout strategy. That keeps the launch reversible.',
    '',
    'Start with five enterprise customers before broader launch for pilot scope. That keeps early support manageable.',
  ].join('\n')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'topic_paragraphs',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      decisionKey: undefined,
      summary: 'Auth strategy',
      prompt: 'What should the auth strategy be?',
      taskRef: undefined,
      answer: 'We should use Bun-native auth for auth strategy. That keeps the runtime simple.',
    },
    {
      decisionKey: undefined,
      summary: 'Rollout strategy',
      prompt: 'What should the rollout strategy be?',
      taskRef: undefined,
      answer: 'Use a staged rollout for rollout strategy. That keeps the launch reversible.',
    },
  ])
})

test('materializes new decision topics from remaining topic blocks while reserving planner summaries', () => {
  const sourceResponse = [
    'We should use Bun-native auth for auth strategy.',
    '',
    'That keeps the runtime simple.',
    '',
    'Use a staged rollout for rollout strategy.',
    '',
    'That keeps the launch reversible.',
    '',
    'Start with five enterprise customers before broader launch for pilot scope.',
    '',
    'That keeps early support manageable.',
  ].join('\n')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'topic_blocks',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      decisionKey: undefined,
      summary: 'Auth strategy',
      prompt: 'What should the auth strategy be?',
      taskRef: undefined,
      answer: [
        'We should use Bun-native auth for auth strategy.',
        'That keeps the runtime simple.',
      ].join('\n\n'),
    },
    {
      decisionKey: undefined,
      summary: 'Rollout strategy',
      prompt: 'What should the rollout strategy be?',
      taskRef: undefined,
      answer: [
        'Use a staged rollout for rollout strategy.',
        'That keeps the launch reversible.',
      ].join('\n\n'),
    },
  ])
})

test('materializes matching open decisions from topic paragraphs without per-topic mapping', () => {
  const sourceResponse = [
    'We should use Bun-native auth for auth strategy. That keeps the runtime simple.',
    '',
    'Use a staged rollout for rollout strategy. That keeps the launch reversible.',
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
      'topic_paragraphs',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'We should use Bun-native auth for auth strategy. That keeps the runtime simple.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout for rollout strategy. That keeps the launch reversible.',
    },
  ])
})

test('materializes topic blocks across decision and planner answers with continuation paragraphs', () => {
  const sourceResponse = [
    'We should use Bun-native auth for auth strategy.',
    '',
    'That keeps the runtime simple.',
    '',
    'Use a staged rollout for rollout strategy.',
    '',
    'That keeps the launch reversible.',
    '',
    'Start with five enterprise customers before broader launch for pilot scope.',
    '',
    'That keeps early support manageable.',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_blocks')

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
      'topic_blocks',
      state,
      [['Pilot scope']],
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: [
        'We should use Bun-native auth for auth strategy.',
        'That keeps the runtime simple.',
      ].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: [
        'Use a staged rollout for rollout strategy.',
        'That keeps the launch reversible.',
      ].join('\n\n'),
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
      'topic_blocks',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        answer: [
          'Start with five enterprise customers before broader launch for pilot scope.',
          'That keeps early support manageable.',
        ].join('\n\n'),
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

test('materializes topic middle blocks across decision and planner answers with anchor paragraphs in the middle', () => {
  const sourceResponse = [
    'Keep the runtime simple.',
    '',
    'We should use Bun-native auth for auth strategy.',
    '',
    'That avoids extra infra.',
    '',
    'Launch in phases.',
    '',
    'Use a staged rollout for rollout strategy.',
    '',
    'That keeps the launch reversible.',
    '',
    'Keep support load manageable.',
    '',
    'Start with five enterprise customers before broader launch for pilot scope.',
    '',
    'That keeps the pilot focused.',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_middle_blocks')

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
      'topic_middle_blocks',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: [
        'Keep the runtime simple.',
        'We should use Bun-native auth for auth strategy.',
        'That avoids extra infra.',
      ].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: [
        'Launch in phases.',
        'Use a staged rollout for rollout strategy.',
        'That keeps the launch reversible.',
      ].join('\n\n'),
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
      'topic_middle_blocks',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        answer: [
          'Keep support load manageable.',
          'Start with five enterprise customers before broader launch for pilot scope.',
          'That keeps the pilot focused.',
        ].join('\n\n'),
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

test('materializes inferred planner answers from remaining topic middle blocks without explicit follow-through summaries', () => {
  const sourceResponse = [
    'Keep the runtime simple.',
    '',
    'We should use Bun-native auth for auth strategy.',
    '',
    'That avoids extra infra.',
    '',
    'Launch in phases.',
    '',
    'Use a staged rollout for rollout strategy.',
    '',
    'That keeps the launch reversible.',
    '',
    'Keep support load manageable.',
    '',
    'Start with five enterprise customers before broader launch for pilot scope.',
    '',
    'That keeps the pilot focused.',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_middle_blocks')

  expect(
    materializeInterpretedDecisionAnswerBatch(
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
      [],
      false,
      sourceResponse,
      [],
      'topic_middle_blocks',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: [
        'Keep the runtime simple.',
        'We should use Bun-native auth for auth strategy.',
        'That avoids extra infra.',
      ].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: [
        'Launch in phases.',
        'Use a staged rollout for rollout strategy.',
        'That keeps the launch reversible.',
      ].join('\n\n'),
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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
      'topic_middle_blocks',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    inferRemainingAnswers: true,
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'What should the pilot scope be?',
        answer: [
          'Keep support load manageable.',
          'Start with five enterprise customers before broader launch for pilot scope.',
          'That keeps the pilot focused.',
        ].join('\n\n'),
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

test('materializes inferred planner answers from remaining topic blocks without explicit follow-through summaries', () => {
  const sourceResponse = [
    'We should use Bun-native auth for auth strategy.',
    '',
    'That keeps the runtime simple.',
    '',
    'Use a staged rollout for rollout strategy.',
    '',
    'That keeps the launch reversible.',
    '',
    'Start with five enterprise customers before broader launch for pilot scope.',
    '',
    'That keeps early support manageable.',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_blocks')

  expect(
    materializeInterpretedDecisionAnswerBatch(
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
      [],
      false,
      sourceResponse,
      [],
      'topic_blocks',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: [
        'We should use Bun-native auth for auth strategy.',
        'That keeps the runtime simple.',
      ].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: [
        'Use a staged rollout for rollout strategy.',
        'That keeps the launch reversible.',
      ].join('\n\n'),
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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
      'topic_blocks',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    inferRemainingAnswers: true,
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'What should the pilot scope be?',
        answer: [
          'Start with five enterprise customers before broader launch for pilot scope.',
          'That keeps early support manageable.',
        ].join('\n\n'),
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

test('materializes inferred planner answers from remaining leading topic blocks without explicit follow-through summaries', () => {
  const sourceResponse = [
    'Auth strategy should use Bun-native auth.',
    '',
    'That keeps the runtime simple.',
    '',
    'Rollout strategy should use a staged rollout.',
    '',
    'That keeps the launch reversible.',
    '',
    'Pilot scope should start with five enterprise customers before broader launch.',
    '',
    'That keeps early support manageable.',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_blocks')

  expect(
    materializeInterpretedDecisionAnswerBatch(
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
      [],
      false,
      sourceResponse,
      [],
      'topic_blocks',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: ['Auth strategy should use Bun-native auth.', 'That keeps the runtime simple.'].join(
        '\n\n',
      ),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: [
        'Rollout strategy should use a staged rollout.',
        'That keeps the launch reversible.',
      ].join('\n\n'),
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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
      'topic_blocks',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    inferRemainingAnswers: true,
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'What should the pilot scope be?',
        answer: [
          'Pilot scope should start with five enterprise customers before broader launch.',
          'That keeps early support manageable.',
        ].join('\n\n'),
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

test('materializes inferred planner answers from remaining prefixed topic blocks without explicit follow-through summaries', () => {
  const sourceResponse = [
    'For auth strategy, use Bun-native auth.',
    '',
    'That keeps the runtime simple.',
    '',
    'Regarding rollout strategy, use a staged rollout.',
    '',
    'That keeps the launch reversible.',
    '',
    'About pilot scope, start with five enterprise customers before broader launch.',
    '',
    'That keeps early support manageable.',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_blocks')

  expect(
    materializeInterpretedDecisionAnswerBatch(
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
      [],
      false,
      sourceResponse,
      [],
      'topic_blocks',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: ['For auth strategy, use Bun-native auth.', 'That keeps the runtime simple.'].join(
        '\n\n',
      ),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: [
        'Regarding rollout strategy, use a staged rollout.',
        'That keeps the launch reversible.',
      ].join('\n\n'),
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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
      'topic_blocks',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    inferRemainingAnswers: true,
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'What should the pilot scope be?',
        answer: [
          'About pilot scope, start with five enterprise customers before broader launch.',
          'That keeps early support manageable.',
        ].join('\n\n'),
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

test('materializes inferred planner answers from remaining as-topic blocks without explicit follow-through summaries', () => {
  const sourceResponse = [
    'Use Bun-native auth as the auth strategy.',
    '',
    'That keeps the runtime simple.',
    '',
    'Use a staged rollout as the rollout strategy.',
    '',
    'That keeps the launch reversible.',
    '',
    'Start with five enterprise customers before broader launch as the pilot scope.',
    '',
    'That keeps early support manageable.',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_blocks')

  expect(
    materializeInterpretedDecisionAnswerBatch(
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
      [],
      false,
      sourceResponse,
      [],
      'topic_blocks',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: ['Use Bun-native auth as the auth strategy.', 'That keeps the runtime simple.'].join(
        '\n\n',
      ),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: [
        'Use a staged rollout as the rollout strategy.',
        'That keeps the launch reversible.',
      ].join('\n\n'),
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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
      'topic_blocks',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    inferRemainingAnswers: true,
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'What should the pilot scope be?',
        answer: [
          'Start with five enterprise customers before broader launch as the pilot scope.',
          'That keeps early support manageable.',
        ].join('\n\n'),
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

test('materializes inferred planner answers from remaining copular topic blocks without explicit follow-through summaries', () => {
  const sourceResponse = [
    'Bun-native auth should be the auth strategy.',
    '',
    'That keeps the runtime simple.',
    '',
    'A staged rollout should be the rollout strategy.',
    '',
    'That keeps the launch reversible.',
    '',
    'Five enterprise customers should be the pilot scope.',
    '',
    'That keeps early support manageable.',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'topic_blocks')

  expect(
    materializeInterpretedDecisionAnswerBatch(
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
      [],
      false,
      sourceResponse,
      [],
      'topic_blocks',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: [
        'Bun-native auth should be the auth strategy.',
        'That keeps the runtime simple.',
      ].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: [
        'A staged rollout should be the rollout strategy.',
        'That keeps the launch reversible.',
      ].join('\n\n'),
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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
      'topic_blocks',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    inferRemainingAnswers: true,
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'What should the pilot scope be?',
        answer: [
          'Five enterprise customers should be the pilot scope.',
          'That keeps early support manageable.',
        ].join('\n\n'),
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

test('materializes matching open decisions from topic blocks without per-topic mapping', () => {
  const sourceResponse = [
    'We should use Bun-native auth for auth strategy.',
    '',
    'That keeps the runtime simple.',
    '',
    'Use a staged rollout for rollout strategy.',
    '',
    'That keeps the launch reversible.',
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
      'topic_blocks',
      undefined,
      false,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: [
        'We should use Bun-native auth for auth strategy.',
        'That keeps the runtime simple.',
      ].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: [
        'Use a staged rollout for rollout strategy.',
        'That keeps the launch reversible.',
      ].join('\n\n'),
    },
  ])
})

test('materializes matching open decisions from topic blocks by durable prompt keyword anchors', () => {
  const sourceResponse = [
    'Adopt the Bun-native auth provider for the Bun-first product path.',
    '',
    'That keeps the runtime simple.',
    '',
    'Rollout should happen in stages, not once.',
    '',
    'That keeps the launch reversible.',
  ].join('\n')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'topic_blocks',
      undefined,
      false,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: [
        'Adopt the Bun-native auth provider for the Bun-first product path.',
        'That keeps the runtime simple.',
      ].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: [
        'Rollout should happen in stages, not once.',
        'That keeps the launch reversible.',
      ].join('\n\n'),
    },
  ])
})

test('materializes ordered blocks across decision and planner answers without labels', () => {
  const sourceResponse = [
    'Use Bun-native auth.',
    '',
    'That keeps the runtime simple.',
    '',
    '',
    'Use a staged rollout.',
    '',
    'That keeps the launch reversible.',
    '',
    '',
    'Start with five enterprise customers before broader launch.',
    '',
    'That keeps early support manageable.',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'ordered_blocks')

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
      'ordered_blocks',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
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
      'ordered_blocks',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        answer: [
          'Start with five enterprise customers before broader launch.',
          'That keeps early support manageable.',
        ].join('\n\n'),
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

test('materializes matching open decisions from ordered blocks without labels', () => {
  const sourceResponse = [
    'Use Bun-native auth.',
    '',
    'That keeps the runtime simple.',
    '',
    '',
    'Use a staged rollout.',
    '',
    'That keeps the launch reversible.',
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
      'ordered_blocks',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
    },
  ])
})

test('materializes question blocks across decision and planner answers without repeating topic names in answers', () => {
  const sourceResponse = [
    'Auth strategy?',
    '',
    'Use Bun-native auth.',
    '',
    'That keeps the runtime simple.',
    '',
    'Rollout strategy?',
    '',
    'Use a staged rollout.',
    '',
    'That keeps the launch reversible.',
    '',
    'Pilot scope?',
    '',
    'Start with five enterprise customers before broader launch.',
    '',
    'That keeps early support manageable.',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'question_blocks')

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
      'question_blocks',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Auth strategy?',
      taskRef: undefined,
      answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Rollout strategy?',
      taskRef: undefined,
      answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
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
      'question_blocks',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'Pilot scope?',
        answer: [
          'Start with five enterprise customers before broader launch.',
          'That keeps early support manageable.',
        ].join('\n\n'),
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

test('materializes question clauses across decision and planner answers without sentence or paragraph boundaries', () => {
  const sourceResponse = [
    'Auth strategy? Use Bun-native auth,',
    'Rollout strategy? Use a staged rollout,',
    'Pilot scope? Start with five enterprise customers before broader launch.',
  ].join(' ')
  const state = createInterpretedSourceResponseState(sourceResponse, 'question_clauses')

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
      'question_clauses',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Auth strategy?',
      taskRef: undefined,
      answer: 'Use Bun-native auth',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Rollout strategy?',
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
      'question_clauses',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'Pilot scope?',
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

test('materializes inferred planner answers from remaining question clauses without explicit follow-through summaries', () => {
  const sourceResponse = [
    'Auth strategy? Use Bun-native auth,',
    'Rollout strategy? Use a staged rollout,',
    'Pilot scope? Start with five enterprise customers before broader launch.',
  ].join(' ')
  const state = createInterpretedSourceResponseState(sourceResponse, 'question_clauses')

  expect(
    materializeInterpretedDecisionAnswerBatch(
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
      [],
      false,
      sourceResponse,
      [],
      'question_clauses',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Auth strategy?',
      taskRef: undefined,
      answer: 'Use Bun-native auth',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Rollout strategy?',
      taskRef: undefined,
      answer: 'Use a staged rollout',
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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
      'question_clauses',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    inferRemainingAnswers: true,
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'Pilot scope?',
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

test('materializes matching open decisions from question clauses by durable prompt keyword anchors', () => {
  const sourceResponse = [
    'What auth provider should we adopt for the Bun-first product path? Use Bun-native auth,',
    'Should rollout happen in stages or all at once? Use a staged rollout.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'question_clauses',
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

test('materializes new decision topics from remaining question clauses while reserving planner summaries', () => {
  const sourceResponse = [
    'Auth strategy? Use Bun-native auth,',
    'Rollout strategy? Use a staged rollout,',
    'Pilot scope? Start with five enterprise customers before broader launch.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'question_clauses',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      decisionKey: undefined,
      summary: 'Auth strategy',
      prompt: 'Auth strategy?',
      taskRef: undefined,
      answer: 'Use Bun-native auth',
    },
    {
      decisionKey: undefined,
      summary: 'Rollout strategy',
      prompt: 'Rollout strategy?',
      taskRef: undefined,
      answer: 'Use a staged rollout',
    },
  ])
})

test('materializes one pending open decision from a single-pending shared reply without anchors', () => {
  const sourceResponse = 'Use Bun-native auth. That keeps the runtime simple.'

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
      ],
      true,
      sourceResponse,
      [],
      'single_pending',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth. That keeps the runtime simple.',
    },
  ])
})

test('materializes multiple pending open decisions from one pending-clause shared reply without anchors', () => {
  const sourceResponse = 'Use Bun-native auth; Use a staged rollout.'

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'pending_clauses',
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

test('materializes multiple pending open decisions from one pending-paragraph shared reply without anchors', () => {
  const sourceResponse = [
    'Use Bun-native auth. That keeps the runtime simple.',
    'Use a staged rollout. That keeps the launch reversible.',
  ].join('\n\n')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'pending_paragraphs',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth. That keeps the runtime simple.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout. That keeps the launch reversible.',
    },
  ])
})

test('materializes multiple pending open decisions from one pending-sentence shared reply without anchors', () => {
  const sourceResponse = 'Use Bun-native auth. Use a staged rollout.'

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'pending_sentences',
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
})

test('rejects single-pending interpretation when more than one explicit answer would consume the shared reply', () => {
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
      'Use Bun-native auth.',
      [],
      'single_pending',
    ),
  ).toThrow('sourceResponseFormat single_pending requires exactly one pending answer consumer.')
})

test('materializes inferred shared workflow answers after child workflow answers consume question blocks', () => {
  const sourceResponse = [
    'Auth strategy?',
    '',
    'Use Bun-native auth.',
    '',
    'That keeps the runtime simple.',
    '',
    'Rollout strategy?',
    '',
    'Use a staged rollout.',
    '',
    'That keeps the launch reversible.',
    '',
    'Rollback trigger?',
    '',
    'Abort after two regressions.',
    '',
    'Pilot scope?',
    '',
    'Start with five enterprise customers before broader launch.',
    '',
    'That keeps early support manageable.',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'question_blocks')

  expect(
    materializeInterpretedDecisionAnswerBatch(
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
      [],
      false,
      sourceResponse,
      [],
      'question_blocks',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Auth strategy?',
      taskRef: undefined,
      answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Rollout strategy?',
      taskRef: undefined,
      answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'workflow_batch',
        inferRemainingAnswers: true,
        workflows: [
          {
            kind: 'planning_batch',
            groupKey: 'auth-rollout-follow-through',
            answers: [
              {
                summary: 'Rollback trigger',
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
          {
            kind: 'planning',
            workflowTaskKey: 'handoff-review',
            title: 'Review auth rollout readiness',
            description: 'Inspect the shared auth rollout workflow before handoff.',
            acceptanceCriteria: ['The auth rollout review is visible.'],
            requestedUpdates: ['design.md'],
          },
        ],
      },
      sourceResponse,
      [],
      'question_blocks',
      state,
    ),
  ).toEqual({
    kind: 'workflow_batch',
    workflowKey: undefined,
    reuseTaskRef: undefined,
    reuseGroupKey: undefined,
    inferRemainingAnswers: true,
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'Pilot scope?',
        answer: [
          'Start with five enterprise customers before broader launch.',
          'That keeps early support manageable.',
        ].join('\n\n'),
      },
    ],
    workflows: [
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Rollback trigger',
            prompt: 'Rollback trigger?',
            answer: 'Abort after two regressions.',
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
      {
        kind: 'planning',
        workflowTaskKey: 'handoff-review',
        title: 'Review auth rollout readiness',
        description: 'Inspect the shared auth rollout workflow before handoff.',
        acceptanceCriteria: ['The auth rollout review is visible.'],
        answers: undefined,
        requestedUpdates: ['design.md'],
      },
    ],
  })
})

test('materializes matching open decisions from question blocks without per-topic mapping', () => {
  const sourceResponse = [
    'What should auth strategy be?',
    '',
    'Use Bun-native auth.',
    '',
    'That keeps the runtime simple.',
    '',
    'How should rollout strategy happen?',
    '',
    'Use a staged rollout.',
    '',
    'That keeps the launch reversible.',
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
      'question_blocks',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
    },
  ])
})

test('materializes matching open decisions from question blocks by exact durable prompt text', () => {
  const sourceResponse = [
    'Should we use Bun-native auth or an external auth provider?',
    '',
    'Use Bun-native auth.',
    '',
    'That keeps the runtime simple.',
    '',
    'Should rollout happen in stages or all at once?',
    '',
    'Use a staged rollout.',
    '',
    'That keeps the launch reversible.',
  ].join('\n')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Should we use Bun-native auth or an external auth provider?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'question_blocks',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
    },
  ])
})

test('materializes matching open decisions from question blocks by durable prompt core text', () => {
  const sourceResponse = [
    'What auth provider should we adopt?',
    '',
    'Use Bun-native auth.',
    '',
    'That keeps the runtime simple.',
    '',
    'How should rollout happen?',
    '',
    'Use a staged rollout.',
    '',
    'That keeps the launch reversible.',
  ].join('\n')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'question_blocks',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
    },
  ])
})

test('materializes matching open decisions from question blocks by durable prompt keyword anchors', () => {
  const sourceResponse = [
    'Should we adopt the auth provider for the Bun-first product path?',
    '',
    'Use Bun-native auth.',
    '',
    'That keeps the runtime simple.',
    '',
    'Should rollout be all at once or in stages?',
    '',
    'Use a staged rollout.',
    '',
    'That keeps the launch reversible.',
  ].join('\n')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'question_blocks',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
    },
  ])
})

test('materializes new decision topics from remaining question blocks while reserving planner summaries', () => {
  const sourceResponse = [
    'Auth strategy?',
    '',
    'Use Bun-native auth.',
    '',
    'That keeps the runtime simple.',
    '',
    'Rollout strategy?',
    '',
    'Use a staged rollout.',
    '',
    'That keeps the launch reversible.',
    '',
    'Pilot scope?',
    '',
    'Start with five enterprise customers before broader launch.',
    '',
    'That keeps early support manageable.',
  ].join('\n')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'question_blocks',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      summary: 'Auth strategy',
      prompt: 'Auth strategy?',
      decisionKey: undefined,
      taskRef: undefined,
      answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
    },
    {
      summary: 'Rollout strategy',
      prompt: 'Rollout strategy?',
      decisionKey: undefined,
      taskRef: undefined,
      answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
    },
  ])
})

test('materializes question spans across decision and planner answers without question paragraphs', () => {
  const sourceResponse = [
    'Auth strategy?',
    'Use Bun-native auth.',
    'That keeps the runtime simple.',
    'Rollout strategy?',
    'Use a staged rollout.',
    'That keeps the launch reversible.',
    'Pilot scope?',
    'Start with five enterprise customers before broader launch.',
    'That keeps early support manageable.',
  ].join(' ')
  const state = createInterpretedSourceResponseState(sourceResponse, 'question_spans')

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
      'question_spans',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Auth strategy?',
      taskRef: undefined,
      answer: 'Use Bun-native auth. That keeps the runtime simple.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Rollout strategy?',
      taskRef: undefined,
      answer: 'Use a staged rollout. That keeps the launch reversible.',
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
      'question_spans',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'Pilot scope?',
        answer:
          'Start with five enterprise customers before broader launch. That keeps early support manageable.',
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

test('materializes inferred planner answers from remaining question spans without explicit follow-through summaries', () => {
  const sourceResponse = [
    'Auth strategy?',
    'Use Bun-native auth.',
    'That keeps the runtime simple.',
    'Rollout strategy?',
    'Use a staged rollout.',
    'That keeps the launch reversible.',
    'Pilot scope?',
    'Start with five enterprise customers before broader launch.',
    'That keeps early support manageable.',
  ].join(' ')
  const state = createInterpretedSourceResponseState(sourceResponse, 'question_spans')

  expect(
    materializeInterpretedDecisionAnswerBatch(
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
      [],
      false,
      sourceResponse,
      [],
      'question_spans',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Auth strategy?',
      taskRef: undefined,
      answer: 'Use Bun-native auth. That keeps the runtime simple.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Rollout strategy?',
      taskRef: undefined,
      answer: 'Use a staged rollout. That keeps the launch reversible.',
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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
      'question_spans',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    inferRemainingAnswers: true,
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'Pilot scope?',
        answer:
          'Start with five enterprise customers before broader launch. That keeps early support manageable.',
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

test('materializes matching open decisions from question spans without per-topic mapping', () => {
  const sourceResponse = [
    'What should auth strategy be?',
    'Use Bun-native auth.',
    'That keeps the runtime simple.',
    'How should rollout strategy happen?',
    'Use a staged rollout.',
    'That keeps the launch reversible.',
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
      'question_spans',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth. That keeps the runtime simple.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout. That keeps the launch reversible.',
    },
  ])
})

test('materializes matching open decisions from question spans by exact durable prompt text', () => {
  const sourceResponse = [
    'Should we use Bun-native auth or an external auth provider?',
    'Use Bun-native auth.',
    'That keeps the runtime simple.',
    'Should rollout happen in stages or all at once?',
    'Use a staged rollout.',
    'That keeps the launch reversible.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Should we use Bun-native auth or an external auth provider?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'question_spans',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth. That keeps the runtime simple.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout. That keeps the launch reversible.',
    },
  ])
})

test('materializes matching open decisions from question spans by durable prompt core text', () => {
  const sourceResponse = [
    'What auth provider should we adopt?',
    'Use Bun-native auth.',
    'That keeps the runtime simple.',
    'How should rollout happen?',
    'Use a staged rollout.',
    'That keeps the launch reversible.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'question_spans',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth. That keeps the runtime simple.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout. That keeps the launch reversible.',
    },
  ])
})

test('materializes matching open decisions from question spans by durable prompt keyword anchors', () => {
  const sourceResponse = [
    'Should we adopt the auth provider for the Bun-first product path?',
    'Use Bun-native auth.',
    'That keeps the runtime simple.',
    'Should rollout be all at once or in stages?',
    'Use a staged rollout.',
    'That keeps the launch reversible.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'question_spans',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth. That keeps the runtime simple.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout. That keeps the launch reversible.',
    },
  ])
})

test('materializes planner answers from question spans by durable prompt text', () => {
  const sourceResponse = [
    'Auth strategy?',
    'Use Bun-native auth.',
    'That keeps the runtime simple.',
    'Rollout strategy?',
    'Use a staged rollout.',
    'That keeps the launch reversible.',
    'Which customers should pilot first before broader launch?',
    'Start with five enterprise customers.',
    'That keeps early support manageable.',
  ].join(' ')
  const state = createInterpretedSourceResponseState(sourceResponse, 'question_spans')

  expect(
    materializeInterpretedDecisionAnswerBatch(
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
      [],
      false,
      sourceResponse,
      [],
      'question_spans',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Auth strategy?',
      taskRef: undefined,
      answer: 'Use Bun-native auth. That keeps the runtime simple.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Rollout strategy?',
      taskRef: undefined,
      answer: 'Use a staged rollout. That keeps the launch reversible.',
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
            prompt: 'Which customers should pilot first before broader launch?',
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
      'question_spans',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    inferRemainingAnswers: undefined,
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'Which customers should pilot first before broader launch?',
        answer: 'Start with five enterprise customers. That keeps early support manageable.',
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

test('materializes new decision topics from remaining question spans while reserving planner summaries', () => {
  const sourceResponse = [
    'Auth strategy?',
    'Use Bun-native auth.',
    'That keeps the runtime simple.',
    'Rollout strategy?',
    'Use a staged rollout.',
    'That keeps the launch reversible.',
    'Pilot scope?',
    'Start with five enterprise customers before broader launch.',
    'That keeps early support manageable.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'question_spans',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      summary: 'Auth strategy',
      prompt: 'Auth strategy?',
      decisionKey: undefined,
      taskRef: undefined,
      answer: 'Use Bun-native auth. That keeps the runtime simple.',
    },
    {
      summary: 'Rollout strategy',
      prompt: 'Rollout strategy?',
      decisionKey: undefined,
      taskRef: undefined,
      answer: 'Use a staged rollout. That keeps the launch reversible.',
    },
  ])
})

test('materializes question middle spans across decision and planner answers with question sentences in the middle', () => {
  const sourceResponse = [
    'Keep the runtime simple.',
    'Auth strategy?',
    'Use Bun-native auth.',
    'Launch in phases.',
    'Rollout strategy?',
    'Use a staged rollout.',
    'Keep support load manageable.',
    'Pilot scope?',
    'Start with five enterprise customers before broader launch.',
  ].join(' ')
  const state = createInterpretedSourceResponseState(sourceResponse, 'question_middle_spans')

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
      'question_middle_spans',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Auth strategy?',
      taskRef: undefined,
      answer: 'Keep the runtime simple. Use Bun-native auth.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Rollout strategy?',
      taskRef: undefined,
      answer: 'Launch in phases. Use a staged rollout.',
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
      'question_middle_spans',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'Pilot scope?',
        answer:
          'Keep support load manageable. Start with five enterprise customers before broader launch.',
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

test('materializes inferred planner answers from remaining question middle spans without explicit follow-through summaries', () => {
  const sourceResponse = [
    'Keep the runtime simple.',
    'Auth strategy?',
    'Use Bun-native auth.',
    'Launch in phases.',
    'Rollout strategy?',
    'Use a staged rollout.',
    'Keep support load manageable.',
    'Pilot scope?',
    'Start with five enterprise customers before broader launch.',
  ].join(' ')
  const state = createInterpretedSourceResponseState(sourceResponse, 'question_middle_spans')

  expect(
    materializeInterpretedDecisionAnswerBatch(
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
      [],
      false,
      sourceResponse,
      [],
      'question_middle_spans',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Auth strategy?',
      taskRef: undefined,
      answer: 'Keep the runtime simple. Use Bun-native auth.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Rollout strategy?',
      taskRef: undefined,
      answer: 'Launch in phases. Use a staged rollout.',
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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
      'question_middle_spans',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    inferRemainingAnswers: true,
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'Pilot scope?',
        answer:
          'Keep support load manageable. Start with five enterprise customers before broader launch.',
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

test('materializes matching open decisions from question middle spans by durable prompt keyword anchors', () => {
  const sourceResponse = [
    'Keep the runtime simple.',
    'Should we adopt the auth provider for the Bun-first product path?',
    'Use Bun-native auth.',
    'Launch in phases.',
    'Should rollout be all at once or in stages?',
    'Use a staged rollout.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'question_middle_spans',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Keep the runtime simple. Use Bun-native auth.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Launch in phases. Use a staged rollout.',
    },
  ])
})

test('materializes new decision topics from remaining question middle spans while reserving planner summaries', () => {
  const sourceResponse = [
    'Keep the runtime simple.',
    'Auth strategy?',
    'Use Bun-native auth.',
    'Launch in phases.',
    'Rollout strategy?',
    'Use a staged rollout.',
    'Keep support load manageable.',
    'Pilot scope?',
    'Start with five enterprise customers before broader launch.',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'question_middle_spans',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      summary: 'Auth strategy',
      prompt: 'Auth strategy?',
      decisionKey: undefined,
      taskRef: undefined,
      answer: 'Keep the runtime simple. Use Bun-native auth.',
    },
    {
      summary: 'Rollout strategy',
      prompt: 'Rollout strategy?',
      decisionKey: undefined,
      taskRef: undefined,
      answer: 'Launch in phases. Use a staged rollout.',
    },
  ])
})

test('rejects question middle span interpretation when adjacent anchors do not leave both trailing and leading sentences', () => {
  const sourceResponse = [
    'Keep the runtime simple.',
    'Auth strategy?',
    'Launch in phases.',
    'Rollout strategy?',
    'Use a staged rollout.',
  ].join(' ')

  expect(() =>
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'question_middle_spans',
      undefined,
      true,
    ),
  ).toThrow(
    'sourceResponseFormat question_middle_spans requires at least one trailing sentence before the next question sentence and at least one leading sentence for that next span.',
  )
})

test('materializes question closing spans across decision and planner answers without front-loaded question sentences', () => {
  const sourceResponse = [
    'Use Bun-native auth.',
    'That keeps the runtime simple.',
    'Auth strategy?',
    'Use a staged rollout.',
    'That keeps the launch reversible.',
    'Rollout strategy?',
    'Start with five enterprise customers before broader launch.',
    'That keeps early support manageable.',
    'Pilot scope?',
  ].join(' ')
  const state = createInterpretedSourceResponseState(sourceResponse, 'question_closing_spans')

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
      'question_closing_spans',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Auth strategy?',
      taskRef: undefined,
      answer: 'Use Bun-native auth. That keeps the runtime simple.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Rollout strategy?',
      taskRef: undefined,
      answer: 'Use a staged rollout. That keeps the launch reversible.',
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
      'question_closing_spans',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'Pilot scope?',
        answer:
          'Start with five enterprise customers before broader launch. That keeps early support manageable.',
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

test('materializes question closing blocks across decision and planner answers without front-loaded question paragraphs', () => {
  const sourceResponse = [
    'Use Bun-native auth.',
    '',
    'That keeps the runtime simple.',
    '',
    'Auth strategy?',
    '',
    'Use a staged rollout.',
    '',
    'That keeps the launch reversible.',
    '',
    'Rollout strategy?',
    '',
    'Start with five enterprise customers before broader launch.',
    '',
    'That keeps early support manageable.',
    '',
    'Pilot scope?',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'question_closing_blocks')

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
      'question_closing_blocks',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Auth strategy?',
      taskRef: undefined,
      answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Rollout strategy?',
      taskRef: undefined,
      answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
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
      'question_closing_blocks',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'Pilot scope?',
        answer: [
          'Start with five enterprise customers before broader launch.',
          'That keeps early support manageable.',
        ].join('\n\n'),
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

test('materializes inferred planner answers from remaining question closing spans without explicit follow-through summaries', () => {
  const sourceResponse = [
    'Use Bun-native auth.',
    'That keeps the runtime simple.',
    'Auth strategy?',
    'Use a staged rollout.',
    'That keeps the launch reversible.',
    'Rollout strategy?',
    'Start with five enterprise customers before broader launch.',
    'That keeps early support manageable.',
    'Pilot scope?',
  ].join(' ')
  const state = createInterpretedSourceResponseState(sourceResponse, 'question_closing_spans')

  expect(
    materializeInterpretedDecisionAnswerBatch(
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
      [],
      false,
      sourceResponse,
      [],
      'question_closing_spans',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Auth strategy?',
      taskRef: undefined,
      answer: 'Use Bun-native auth. That keeps the runtime simple.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Rollout strategy?',
      taskRef: undefined,
      answer: 'Use a staged rollout. That keeps the launch reversible.',
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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
      'question_closing_spans',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    inferRemainingAnswers: true,
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'Pilot scope?',
        answer:
          'Start with five enterprise customers before broader launch. That keeps early support manageable.',
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

test('materializes inferred planner answers from remaining question closing blocks without explicit follow-through summaries', () => {
  const sourceResponse = [
    'Use Bun-native auth.',
    '',
    'That keeps the runtime simple.',
    '',
    'Auth strategy?',
    '',
    'Use a staged rollout.',
    '',
    'That keeps the launch reversible.',
    '',
    'Rollout strategy?',
    '',
    'Start with five enterprise customers before broader launch.',
    '',
    'That keeps early support manageable.',
    '',
    'Pilot scope?',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'question_closing_blocks')

  expect(
    materializeInterpretedDecisionAnswerBatch(
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
      [],
      false,
      sourceResponse,
      [],
      'question_closing_blocks',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Auth strategy?',
      taskRef: undefined,
      answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Rollout strategy?',
      taskRef: undefined,
      answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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
      'question_closing_blocks',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    inferRemainingAnswers: true,
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'Pilot scope?',
        answer: [
          'Start with five enterprise customers before broader launch.',
          'That keeps early support manageable.',
        ].join('\n\n'),
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

test('materializes matching open decisions from question closing spans by durable prompt keyword anchors', () => {
  const sourceResponse = [
    'Use Bun-native auth.',
    'That keeps the runtime simple.',
    'Should we adopt the auth provider for the Bun-first product path?',
    'Use a staged rollout.',
    'That keeps the launch reversible.',
    'Should rollout be all at once or in stages?',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'question_closing_spans',
      undefined,
      false,
      [],
      [['Pilot scope']],
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: 'Use Bun-native auth. That keeps the runtime simple.',
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: 'Use a staged rollout. That keeps the launch reversible.',
    },
  ])
})

test('materializes matching open decisions from question closing blocks by durable prompt keyword anchors', () => {
  const sourceResponse = [
    'Use Bun-native auth.',
    '',
    'That keeps the runtime simple.',
    '',
    'Should we adopt the auth provider for the Bun-first product path?',
    '',
    'Use a staged rollout.',
    '',
    'That keeps the launch reversible.',
    '',
    'Should rollout be all at once or in stages?',
  ].join('\n')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'question_closing_blocks',
      undefined,
      false,
      [],
      [['Pilot scope']],
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
    },
  ])
})

test('materializes new decision topics from remaining question closing spans while reserving planner summaries', () => {
  const sourceResponse = [
    'Use Bun-native auth.',
    'That keeps the runtime simple.',
    'Auth strategy?',
    'Use a staged rollout.',
    'That keeps the launch reversible.',
    'Rollout strategy?',
    'Start with five enterprise customers before broader launch.',
    'That keeps early support manageable.',
    'Pilot scope?',
  ].join(' ')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'question_closing_spans',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      summary: 'Auth strategy',
      prompt: 'Auth strategy?',
      decisionKey: undefined,
      taskRef: undefined,
      answer: 'Use Bun-native auth. That keeps the runtime simple.',
    },
    {
      summary: 'Rollout strategy',
      prompt: 'Rollout strategy?',
      decisionKey: undefined,
      taskRef: undefined,
      answer: 'Use a staged rollout. That keeps the launch reversible.',
    },
  ])
})

test('materializes new decision topics from remaining question closing blocks while reserving planner summaries', () => {
  const sourceResponse = [
    'Use Bun-native auth.',
    '',
    'That keeps the runtime simple.',
    '',
    'Auth strategy?',
    '',
    'Use a staged rollout.',
    '',
    'That keeps the launch reversible.',
    '',
    'Rollout strategy?',
    '',
    'Start with five enterprise customers before broader launch.',
    '',
    'That keeps early support manageable.',
    '',
    'Pilot scope?',
  ].join('\n')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'question_closing_blocks',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      summary: 'Auth strategy',
      prompt: 'Auth strategy?',
      decisionKey: undefined,
      taskRef: undefined,
      answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
    },
    {
      summary: 'Rollout strategy',
      prompt: 'Rollout strategy?',
      decisionKey: undefined,
      taskRef: undefined,
      answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
    },
  ])
})

test('materializes question middle blocks across decision and planner answers with question paragraphs in the middle', () => {
  const sourceResponse = [
    'Keep the runtime simple.',
    '',
    'Auth strategy?',
    '',
    'Use Bun-native auth.',
    '',
    'Launch in phases.',
    '',
    'Rollout strategy?',
    '',
    'Use a staged rollout.',
    '',
    'Keep support load manageable.',
    '',
    'Pilot scope?',
    '',
    'Start with five enterprise customers before broader launch.',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'question_middle_blocks')

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
      'question_middle_blocks',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Auth strategy?',
      taskRef: undefined,
      answer: ['Keep the runtime simple.', 'Use Bun-native auth.'].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Rollout strategy?',
      taskRef: undefined,
      answer: ['Launch in phases.', 'Use a staged rollout.'].join('\n\n'),
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
      'question_middle_blocks',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'Pilot scope?',
        answer: [
          'Keep support load manageable.',
          'Start with five enterprise customers before broader launch.',
        ].join('\n\n'),
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

test('materializes inferred planner answers from remaining question middle blocks without explicit follow-through summaries', () => {
  const sourceResponse = [
    'Keep the runtime simple.',
    '',
    'Auth strategy?',
    '',
    'Use Bun-native auth.',
    '',
    'Launch in phases.',
    '',
    'Rollout strategy?',
    '',
    'Use a staged rollout.',
    '',
    'Keep support load manageable.',
    '',
    'Pilot scope?',
    '',
    'Start with five enterprise customers before broader launch.',
  ].join('\n')
  const state = createInterpretedSourceResponseState(sourceResponse, 'question_middle_blocks')

  expect(
    materializeInterpretedDecisionAnswerBatch(
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
      [],
      false,
      sourceResponse,
      [],
      'question_middle_blocks',
      state,
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Auth strategy?',
      taskRef: undefined,
      answer: ['Keep the runtime simple.', 'Use Bun-native auth.'].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Rollout strategy?',
      taskRef: undefined,
      answer: ['Launch in phases.', 'Use a staged rollout.'].join('\n\n'),
    },
  ])

  expect(
    materializeInterpretedDecisionFollowThrough(
      {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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
      'question_middle_blocks',
      state,
    ),
  ).toEqual({
    kind: 'planning_batch',
    groupKey: 'auth-rollout-follow-through',
    inferRemainingAnswers: true,
    answers: [
      {
        summary: 'Pilot scope',
        prompt: 'Pilot scope?',
        answer: [
          'Keep support load manageable.',
          'Start with five enterprise customers before broader launch.',
        ].join('\n\n'),
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

test('materializes matching open decisions from question middle blocks by durable prompt keyword anchors', () => {
  const sourceResponse = [
    'Keep the runtime simple.',
    '',
    'Should we adopt the auth provider for the Bun-first product path?',
    '',
    'Use Bun-native auth.',
    '',
    'Launch in phases.',
    '',
    'Should rollout be all at once or in stages?',
    '',
    'Use a staged rollout.',
  ].join('\n')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          prompt: 'Should rollout happen in stages or all at once?',
        },
      ],
      true,
      sourceResponse,
      [],
      'question_middle_blocks',
    ),
  ).toEqual([
    {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: undefined,
      answer: ['Keep the runtime simple.', 'Use Bun-native auth.'].join('\n\n'),
    },
    {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: undefined,
      answer: ['Launch in phases.', 'Use a staged rollout.'].join('\n\n'),
    },
  ])
})

test('materializes new decision topics from remaining question middle blocks while reserving planner summaries', () => {
  const sourceResponse = [
    'Keep the runtime simple.',
    '',
    'Auth strategy?',
    '',
    'Use Bun-native auth.',
    '',
    'Launch in phases.',
    '',
    'Rollout strategy?',
    '',
    'Use a staged rollout.',
    '',
    'Keep support load manageable.',
    '',
    'Pilot scope?',
    '',
    'Start with five enterprise customers before broader launch.',
  ].join('\n')

  expect(
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'question_middle_blocks',
      undefined,
      true,
      [],
      ['Pilot scope'],
    ),
  ).toEqual([
    {
      summary: 'Auth strategy',
      prompt: 'Auth strategy?',
      decisionKey: undefined,
      taskRef: undefined,
      answer: ['Keep the runtime simple.', 'Use Bun-native auth.'].join('\n\n'),
    },
    {
      summary: 'Rollout strategy',
      prompt: 'Rollout strategy?',
      decisionKey: undefined,
      taskRef: undefined,
      answer: ['Launch in phases.', 'Use a staged rollout.'].join('\n\n'),
    },
  ])
})

test('rejects question middle block interpretation when adjacent anchors do not leave both trailing and leading paragraphs', () => {
  const sourceResponse = [
    'Keep the runtime simple.',
    '',
    'Auth strategy?',
    '',
    'Launch in phases.',
    '',
    'Rollout strategy?',
    '',
    'Use a staged rollout.',
  ].join('\n')

  expect(() =>
    materializeInterpretedDecisionAnswerBatch(
      [],
      [],
      false,
      sourceResponse,
      [],
      'question_middle_blocks',
      undefined,
      true,
    ),
  ).toThrow(
    'sourceResponseFormat question_middle_blocks requires at least one trailing paragraph before the next question paragraph and at least one leading paragraph for that next block.',
  )
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
      'inferOpenDecisions requires sourceResponseFormat "labeled_sections", "single_pending", "pending_clauses", "pending_paragraphs", "pending_sentences", "ordered_items", "ordered_blocks", "question_blocks", "question_clauses", "question_spans", "question_middle_spans", "question_closing_spans", "question_closing_blocks", "question_middle_blocks", "inline_topics", "topic_clauses", "topic_sentences", "topic_spans", "topic_middle_spans", "topic_closing_spans", "topic_closing_blocks", "topic_paragraphs", "topic_middle_blocks", or "topic_blocks".',
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
      'inferDecisionTopics requires sourceResponseFormat "labeled_sections", "inline_topics", "topic_clauses", "question_blocks", "question_clauses", "question_spans", "question_middle_spans", "question_closing_spans", "question_closing_blocks", "question_middle_blocks", "topic_sentences", "topic_spans", "topic_middle_spans", "topic_closing_spans", "topic_closing_blocks", "topic_paragraphs", "topic_middle_blocks", or "topic_blocks".',
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

test('rejects topic-span interpretation when one requested topic matches more than one span', () => {
  const sourceResponse = [
    'Use Bun-native auth for auth strategy.',
    'That keeps the runtime simple.',
    'Document Bun-native fallback decisions for auth strategy.',
    'That keeps incident recovery explicit.',
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
      'topic_spans',
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'Multiple topic spans matched decision answer auth-strategy in sourceResponse.',
    ),
  )
})

test('rejects topic-closing-span interpretation when one requested topic matches more than one span', () => {
  const sourceResponse = [
    'Use Bun-native auth.',
    'That keeps the runtime simple for auth strategy.',
    'Document Bun-native fallback decisions.',
    'That keeps incident recovery explicit for auth strategy.',
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
      'topic_closing_spans',
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'Multiple topic closing spans matched decision answer auth-strategy in sourceResponse.',
    ),
  )
})

test('rejects topic-closing-block interpretation when one requested topic matches more than one block', () => {
  const sourceResponse = [
    'Use Bun-native auth.',
    '',
    'That keeps the runtime simple for auth strategy.',
    '',
    'Document Bun-native fallback decisions.',
    '',
    'That keeps incident recovery explicit for auth strategy.',
  ].join('\n')

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
      'topic_closing_blocks',
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'Multiple topic closing blocks matched decision answer auth-strategy in sourceResponse.',
    ),
  )
})

test('rejects topic-paragraph interpretation when one requested topic matches more than one paragraph', () => {
  const sourceResponse = [
    'Use Bun-native auth for auth strategy. That keeps the runtime simple.',
    '',
    'Document Bun-native fallback decisions for auth strategy. That keeps incident recovery explicit.',
  ].join('\n')

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
      'topic_paragraphs',
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'Multiple topic paragraphs matched decision answer auth-strategy in sourceResponse.',
    ),
  )
})

test('rejects topic-block interpretation when one requested topic matches more than one anchored block', () => {
  const sourceResponse = [
    'Use Bun-native auth for auth strategy.',
    '',
    'That keeps the runtime simple.',
    '',
    'Document Bun-native fallback decisions for auth strategy.',
    '',
    'That keeps incident recovery explicit.',
  ].join('\n')

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
      'topic_blocks',
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'Multiple topic blocks matched decision answer auth-strategy in sourceResponse.',
    ),
  )
})

test('rejects ordered-block interpretation when not enough blocks remain', () => {
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
      ['Use Bun-native auth.', '', 'That keeps the runtime simple.'].join('\n'),
      [],
      'ordered_blocks',
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'No ordered block remained for decision answer rollout-strategy in sourceResponse.',
    ),
  )
})

test('rejects question-block interpretation when a matched question omits its answer block', () => {
  expect(() =>
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
      ],
      'Auth strategy?',
      [],
      'question_blocks',
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'Question block "Auth strategy?" in sourceResponse did not include an answer block.',
    ),
  )
})

test('rejects question-span interpretation when a matched question omits its answer sentences', () => {
  expect(() =>
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
      ],
      'Auth strategy?',
      [],
      'question_spans',
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'Question span "Auth strategy?" in sourceResponse did not include an answer sentence.',
    ),
  )
})

test('rejects question-closing-span interpretation when one requested topic matches more than one span', () => {
  expect(() =>
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
      ],
      ['Use Bun-native auth.', 'Auth strategy?', 'Use external auth.', 'Auth strategy?'].join(' '),
      [],
      'question_closing_spans',
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'Multiple question closing spans matched decision answer auth-strategy in sourceResponse.',
    ),
  )
})

test('rejects question-closing-block interpretation when one requested topic matches more than one block', () => {
  expect(() =>
    materializeInterpretedDecisionAnswers(
      [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
      ],
      [
        'Use Bun-native auth.',
        '',
        'Auth strategy?',
        '',
        'Use external auth.',
        '',
        'Auth strategy?',
      ].join('\n'),
      [],
      'question_closing_blocks',
    ),
  ).toThrowError(
    new AnswerInterpretationError(
      'Multiple question closing blocks matched decision answer auth-strategy in sourceResponse.',
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
