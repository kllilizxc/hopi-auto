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
      'question_blocks',
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
      decisionKey: undefined,
      taskRef: undefined,
      answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
    },
    {
      summary: 'Rollout strategy',
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
      decisionKey: undefined,
      taskRef: undefined,
      answer: 'Use Bun-native auth. That keeps the runtime simple.',
    },
    {
      summary: 'Rollout strategy',
      decisionKey: undefined,
      taskRef: undefined,
      answer: 'Use a staged rollout. That keeps the launch reversible.',
    },
  ])
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
      'inferOpenDecisions requires sourceResponseFormat "labeled_sections", "ordered_items", "ordered_blocks", "question_blocks", "question_spans", "inline_topics", "topic_sentences", "topic_paragraphs", or "topic_blocks".',
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
      'inferDecisionTopics requires sourceResponseFormat "labeled_sections", "inline_topics", "question_blocks", or "question_spans".',
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
