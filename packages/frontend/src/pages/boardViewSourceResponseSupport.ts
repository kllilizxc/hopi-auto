import { type GoalSourceResponseFormat } from '../lib/api'
import {
  parseDecisionWorkflowChildEditorItems,
  parsePlanningAnswerEditorItems,
  parseWorkflowChildEditorItems,
} from './boardViewStructuredEditorCodec'
import type {
  DecisionAnswerEntryEditorItem,
  DecisionFollowThroughDraft,
  PlanningAnswerEditorItem,
} from './boardViewStructuredEditorTypes'

export type SourceResponseTemplateConsumer = {
  summary: string
  prompt?: string
}

export const SOURCE_RESPONSE_FORMAT_OPTIONS: GoalSourceResponseFormat[] = [
  'auto',
  'single_pending',
  'labeled_sections',
  'inline_topics',
  'ordered_items',
  'ordered_blocks',
  'question_blocks',
  'question_clauses',
  'question_spans',
  'question_middle_spans',
  'question_closing_spans',
  'question_closing_blocks',
  'question_middle_blocks',
  'topic_clauses',
  'topic_sentences',
  'topic_spans',
  'topic_middle_spans',
  'topic_closing_spans',
  'topic_closing_blocks',
  'topic_paragraphs',
  'topic_middle_blocks',
  'topic_blocks',
  'pending_clauses',
  'pending_paragraphs',
  'pending_sentences',
  'pending_conjunctions',
  'pending_answer_sources',
  'matching_answer_sources',
  'matching_runs',
  'matching_opening_runs',
  'matching_closing_runs',
  'matching_middle_runs',
]

export const ANSWER_SOURCE_ONLY_FORMATS = new Set<GoalSourceResponseFormat>([
  'pending_answer_sources',
  'matching_answer_sources',
])

export const INFER_OPEN_DECISION_FORMATS = new Set<GoalSourceResponseFormat>([
  'labeled_sections',
  'single_pending',
  'pending_clauses',
  'pending_paragraphs',
  'pending_sentences',
  'pending_conjunctions',
  'pending_answer_sources',
  'matching_answer_sources',
  'matching_runs',
  'matching_opening_runs',
  'matching_closing_runs',
  'matching_middle_runs',
  'ordered_items',
  'ordered_blocks',
  'question_blocks',
  'question_clauses',
  'question_spans',
  'question_middle_spans',
  'question_closing_spans',
  'question_closing_blocks',
  'question_middle_blocks',
  'inline_topics',
  'topic_clauses',
  'topic_sentences',
  'topic_spans',
  'topic_middle_spans',
  'topic_closing_spans',
  'topic_closing_blocks',
  'topic_paragraphs',
  'topic_middle_blocks',
  'topic_blocks',
])

export const INFER_DECISION_TOPIC_FORMATS = new Set<GoalSourceResponseFormat>([
  'pending_answer_sources',
  'matching_answer_sources',
  'labeled_sections',
  'inline_topics',
  'topic_clauses',
  'question_blocks',
  'question_clauses',
  'question_spans',
  'question_middle_spans',
  'question_closing_spans',
  'question_closing_blocks',
  'question_middle_blocks',
  'topic_sentences',
  'topic_spans',
  'topic_middle_spans',
  'topic_closing_spans',
  'topic_closing_blocks',
  'topic_paragraphs',
  'topic_middle_blocks',
  'topic_blocks',
])

export const INFER_REMAINING_PLANNING_ANSWER_FORMATS = new Set<GoalSourceResponseFormat>([
  'pending_answer_sources',
  'matching_answer_sources',
  'question_blocks',
  'question_clauses',
  'question_spans',
  'question_middle_spans',
  'question_closing_spans',
  'question_closing_blocks',
  'question_middle_blocks',
  'topic_clauses',
  'topic_sentences',
  'topic_spans',
  'topic_middle_spans',
  'topic_closing_spans',
  'topic_closing_blocks',
  'topic_paragraphs',
  'topic_middle_blocks',
  'topic_blocks',
])

export function formatSourceResponseFormatLabel(format: GoalSourceResponseFormat) {
  if (format === 'auto') {
    return 'Auto'
  }

  return format
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

export function describeSourceResponseFormat(format: GoalSourceResponseFormat) {
  switch (format) {
    case 'auto':
      return 'Let backend choose the strongest deterministic interpretation surface that fully consumes the provided source response or reusable answer sources.'
    case 'single_pending':
      return 'Treat one whole shared reply as the answer for exactly one unresolved pending consumer.'
    case 'labeled_sections':
      return 'Split a shared reply by stable labels or headings and map each labeled section onto one consumer.'
    case 'inline_topics':
      return 'Turn inline topic clauses into durable decision topics or direct topic-anchored answers.'
    case 'ordered_items':
      return 'Interpret one ordered list item per answer consumer.'
    case 'ordered_blocks':
      return 'Interpret ordered multi-line blocks instead of single ordered items.'
    case 'pending_clauses':
      return 'Split one shared reply into unresolved consumers by clause boundaries.'
    case 'pending_paragraphs':
      return 'Split one shared reply into unresolved consumers by paragraph boundaries.'
    case 'pending_sentences':
      return 'Split one shared reply into unresolved consumers by sentence boundaries.'
    case 'pending_conjunctions':
      return 'Split one shared reply into unresolved consumers by conjunction-linked segments.'
    case 'pending_answer_sources':
      return 'Walk ordered reusable answer sources onto unresolved consumers in sequence.'
    case 'matching_answer_sources':
      return 'Match reusable answer sources onto consumers by durable authority like keys, prompts, or hints.'
    case 'matching_runs':
      return 'Merge contiguous stretches that keep answering the same already-known consumer.'
    case 'matching_opening_runs':
      return 'Each answer stretch starts with a known consumer anchor and keeps trailing continuation.'
    case 'matching_closing_runs':
      return 'Each answer stretch ends with a known consumer anchor after earlier explanation prose.'
    case 'matching_middle_runs':
      return 'Each answer stretch keeps the known consumer anchor in the middle with leading and trailing continuation.'
    case 'question_blocks':
      return 'Interpret question-and-answer paragraph blocks where each block starts with the question.'
    case 'question_clauses':
      return 'Interpret clause-level question-and-answer pairs inside one shared reply.'
    case 'question_spans':
      return 'Each span starts with a question sentence and keeps the following answer sentences attached.'
    case 'question_middle_spans':
      return 'Each span keeps answer text before and after the question sentence anchor.'
    case 'question_closing_spans':
      return 'Each span ends with a question sentence after leading answer text.'
    case 'question_closing_blocks':
      return 'Each paragraph block ends with the question paragraph after earlier answer paragraphs.'
    case 'question_middle_blocks':
      return 'Each paragraph block keeps the question paragraph between leading and trailing answer paragraphs.'
    case 'topic_clauses':
      return 'Interpret clause-level topic mentions paired with their own continuation text.'
    case 'topic_sentences':
      return 'Interpret one topic-bearing sentence per answer consumer.'
    case 'topic_spans':
      return 'Each span starts with a topic anchor sentence and keeps trailing continuation sentences.'
    case 'topic_middle_spans':
      return 'Each span keeps the topic anchor sentence between leading and trailing continuation sentences.'
    case 'topic_closing_spans':
      return 'Each span ends with a topic-closing sentence after earlier continuation.'
    case 'topic_closing_blocks':
      return 'Each paragraph block ends with a topic-closing paragraph after earlier continuation paragraphs.'
    case 'topic_paragraphs':
      return 'Interpret one topic-bearing paragraph per answer consumer.'
    case 'topic_middle_blocks':
      return 'Each paragraph block keeps the topic anchor paragraph between leading and trailing continuation paragraphs.'
    case 'topic_blocks':
      return 'Each paragraph block starts with a topic anchor paragraph and keeps trailing continuation paragraphs.'
  }
}

export function describeSourceResponseInputAuthority(format: GoalSourceResponseFormat) {
  if (format === 'auto') {
    return 'shared source response or structured answer sources'
  }

  if (ANSWER_SOURCE_ONLY_FORMATS.has(format)) {
    return 'structured answer sources'
  }

  return 'shared source response'
}

export function createSourceResponseTemplateConsumer(
  summary: string,
  prompt?: string,
): SourceResponseTemplateConsumer | null {
  const normalizedSummary = summary.trim()
  const normalizedPrompt = prompt?.trim() ? prompt.trim() : undefined

  if (normalizedSummary.length === 0 && !normalizedPrompt) {
    return null
  }

  return {
    summary: normalizedSummary,
    ...(normalizedPrompt ? { prompt: normalizedPrompt } : {}),
  }
}

export function collectSourceResponseTemplateConsumers(
  consumers: Array<SourceResponseTemplateConsumer | null | undefined>,
) {
  const result: SourceResponseTemplateConsumer[] = []
  const seen = new Set<string>()

  for (const consumer of consumers) {
    if (!consumer) {
      continue
    }

    const summary = consumer.summary.trim()
    const prompt = consumer.prompt?.trim() ?? ''
    if (summary.length === 0 && prompt.length === 0) {
      continue
    }

    const key = `${summary}::${prompt}`
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push({
      summary,
      ...(prompt ? { prompt } : {}),
    })
  }

  return result
}

export function buildSourceResponseTemplateConsumersFromPlanningAnswerItems(
  items: PlanningAnswerEditorItem[],
) {
  return collectSourceResponseTemplateConsumers(
    items.map((item) => createSourceResponseTemplateConsumer(item.summary, item.prompt)),
  )
}

export function buildPlanningAnswerEditorItemsFromDecisionFollowThroughDraft(
  draft: DecisionFollowThroughDraft,
) {
  const directItems = parsePlanningAnswerEditorItems(draft.answersJson).items

  if (draft.kind !== 'workflow_batch') {
    return directItems
  }

  const simpleWorkflowChildItems = directItems
  const workflowRootItems = parsePlanningAnswerEditorItems(draft.workflowAnswersJson).items
  const workflowChildItems = parseDecisionWorkflowChildEditorItems(
    draft.workflowChildrenJson,
  ).items.flatMap((child) => parsePlanningAnswerEditorItems(child.answersJson).items)

  if (draft.workflowChildrenJson.trim()) {
    return [...workflowRootItems, ...workflowChildItems]
  }

  return [...simpleWorkflowChildItems, ...workflowRootItems]
}

export type ExplicitAnswerSourceReferenceEntry = {
  answer?: string
  sourceExcerpt?: string
  answerSourceKey?: string
  answerSourceGroupKey?: string
}

export type ExplicitAnswerSourceReferenceGroup = {
  label: string
  entries: ExplicitAnswerSourceReferenceEntry[]
}

export function createExplicitAnswerSourceReferenceGroup(
  label: string,
  entries: ExplicitAnswerSourceReferenceEntry[] | undefined,
) {
  if (!entries || entries.length === 0) {
    return null
  }

  return {
    label,
    entries: [...entries],
  } satisfies ExplicitAnswerSourceReferenceGroup
}

function parsePlanningAnswerEditorItemsIfValid(source: string) {
  const { items, error } = parsePlanningAnswerEditorItems(source)
  return error ? [] : items
}

function parseWorkflowChildEditorItemsIfValid(source: string) {
  const { items, error } = parseWorkflowChildEditorItems(source)
  return error ? [] : items
}

function parseDecisionWorkflowChildEditorItemsIfValid(source: string) {
  const { items, error } = parseDecisionWorkflowChildEditorItems(source)
  return error ? [] : items
}

export function buildDecisionFollowThroughDraftAnswerSourceReferenceGroups(
  draft: DecisionFollowThroughDraft,
) {
  if (draft.kind === 'none') {
    return [] as ExplicitAnswerSourceReferenceGroup[]
  }

  if (draft.kind === 'planning') {
    return [
      createExplicitAnswerSourceReferenceGroup(
        'Decision planning follow-through answers',
        parsePlanningAnswerEditorItemsIfValid(draft.answersJson),
      ),
    ].filter((group): group is ExplicitAnswerSourceReferenceGroup => group !== null)
  }

  if (draft.kind === 'planning_batch') {
    return [
      createExplicitAnswerSourceReferenceGroup(
        'Decision planning-batch follow-through answers',
        parsePlanningAnswerEditorItemsIfValid(draft.answersJson),
      ),
    ].filter((group): group is ExplicitAnswerSourceReferenceGroup => group !== null)
  }

  const groups: ExplicitAnswerSourceReferenceGroup[] = []
  const rootGroup = createExplicitAnswerSourceReferenceGroup(
    'Decision workflow follow-through root answers',
    parsePlanningAnswerEditorItemsIfValid(draft.workflowAnswersJson),
  )
  if (rootGroup) {
    groups.push(rootGroup)
  }

  if (draft.workflowChildrenJson.trim()) {
    parseDecisionWorkflowChildEditorItemsIfValid(draft.workflowChildrenJson).forEach(
      (child, index) => {
        const childGroup = createExplicitAnswerSourceReferenceGroup(
          `Decision workflow child ${index + 1} answers`,
          parsePlanningAnswerEditorItemsIfValid(child.answersJson),
        )
        if (childGroup) {
          groups.push(childGroup)
        }
      },
    )
    return groups
  }

  const simpleChildGroup = createExplicitAnswerSourceReferenceGroup(
    'Decision workflow child answers',
    parsePlanningAnswerEditorItemsIfValid(draft.answersJson),
  )
  if (simpleChildGroup) {
    groups.push(simpleChildGroup)
  }

  return groups
}

export function buildPlanningAnswerEditorItemsFromWorkflowDraft(workflowDraft: {
  sharedAnswersJson: string
  childAnswersJson: string
  childrenJson: string
}) {
  const sharedItems = parsePlanningAnswerEditorItems(workflowDraft.sharedAnswersJson).items
  const simpleChildItems = parsePlanningAnswerEditorItems(workflowDraft.childAnswersJson).items
  const advancedChildItems = parseWorkflowChildEditorItems(
    workflowDraft.childrenJson,
  ).items.flatMap((child) => parsePlanningAnswerEditorItems(child.answersJson).items)

  if (workflowDraft.childrenJson.trim()) {
    return [...sharedItems, ...advancedChildItems]
  }

  return [...sharedItems, ...simpleChildItems]
}

export function buildWorkflowDraftAnswerSourceReferenceGroups(workflowDraft: {
  sharedAnswersJson: string
  childAnswersJson: string
  childrenJson: string
}) {
  const groups: ExplicitAnswerSourceReferenceGroup[] = []
  const sharedGroup = createExplicitAnswerSourceReferenceGroup(
    'Workflow shared answers',
    parsePlanningAnswerEditorItemsIfValid(workflowDraft.sharedAnswersJson),
  )
  if (sharedGroup) {
    groups.push(sharedGroup)
  }

  if (workflowDraft.childrenJson.trim()) {
    parseWorkflowChildEditorItemsIfValid(workflowDraft.childrenJson).forEach((child, index) => {
      const childGroup = createExplicitAnswerSourceReferenceGroup(
        `Workflow child ${index + 1} answers`,
        parsePlanningAnswerEditorItemsIfValid(child.answersJson),
      )
      if (childGroup) {
        groups.push(childGroup)
      }
    })
    return groups
  }

  const simpleChildGroup = createExplicitAnswerSourceReferenceGroup(
    'Workflow child answers',
    parsePlanningAnswerEditorItemsIfValid(workflowDraft.childAnswersJson),
  )
  if (simpleChildGroup) {
    groups.push(simpleChildGroup)
  }

  return groups
}

export function buildSourceResponseTemplateConsumersFromDecisionAnswerItems(
  items: DecisionAnswerEntryEditorItem[],
) {
  return collectSourceResponseTemplateConsumers(
    items.map((item) => createSourceResponseTemplateConsumer(item.summary, item.prompt)),
  )
}

export function buildSourceResponseTemplateConsumersFromDecisionFollowThroughDraft(
  draft: DecisionFollowThroughDraft,
) {
  return buildSourceResponseTemplateConsumersFromPlanningAnswerItems(
    buildPlanningAnswerEditorItemsFromDecisionFollowThroughDraft(draft),
  )
}

export function buildSourceResponseTemplateConsumersFromWorkflowDraft(workflowDraft: {
  sharedAnswersJson: string
  childAnswersJson: string
  childrenJson: string
}) {
  return buildSourceResponseTemplateConsumersFromPlanningAnswerItems(
    buildPlanningAnswerEditorItemsFromWorkflowDraft(workflowDraft),
  )
}

export function buildContextualSourceResponseTemplate(
  format: GoalSourceResponseFormat,
  consumers: SourceResponseTemplateConsumer[],
) {
  if (format === 'auto' || ANSWER_SOURCE_ONLY_FORMATS.has(format)) {
    return null
  }

  const normalizedConsumers = collectSourceResponseTemplateConsumers(consumers)
  if (normalizedConsumers.length === 0) {
    return null
  }

  const labels = normalizedConsumers.map((consumer, index) =>
    consumer.summary.length > 0 ? consumer.summary : `Consumer ${index + 1}`,
  )
  const questions = normalizedConsumers.map((consumer, index) =>
    consumer.prompt?.length ? consumer.prompt : `What should ${labels[index]} be?`,
  )
  const openingAnchors = normalizedConsumers.map((consumer, index) =>
    consumer.prompt?.length ? consumer.prompt : `${labels[index]}:`,
  )
  const closingAnchors = normalizedConsumers.map((consumer, index) =>
    consumer.prompt?.length ? consumer.prompt : `${labels[index]}.`,
  )
  const answerLine = 'Replace this answer.'

  switch (format) {
    case 'single_pending':
      return normalizedConsumers.length === 1
        ? normalizedConsumers[0]?.prompt?.length
          ? `Replace the answer to "${normalizedConsumers[0].prompt}" here.`
          : `Replace the "${labels[0]}" answer here.`
        : null
    case 'labeled_sections':
      return labels.map((label) => `${label}:\n${answerLine}`).join('\n\n')
    case 'inline_topics':
      return labels.map((label) => `${label}: ${answerLine}`).join(' ')
    case 'ordered_items':
      return labels.map((_, index) => `${index + 1}. ${answerLine}`).join('\n')
    case 'ordered_blocks':
      return labels.map((_, index) => `${index + 1}.\n   ${answerLine}`).join('\n\n')
    case 'pending_clauses':
      return labels.map(() => answerLine).join('; ')
    case 'pending_paragraphs':
      return labels.map(() => answerLine).join('\n\n')
    case 'pending_sentences':
      return labels.map(() => answerLine).join(' ')
    case 'pending_conjunctions':
      return labels.length === 1
        ? answerLine
        : labels
            .map((_, index) =>
              index === labels.length - 1
                ? `and ${answerLine.toLowerCase()}`
                : answerLine.toLowerCase(),
            )
            .join(', ')
            .replace(/^replace this answer\./, 'Replace this answer.')
    case 'question_blocks':
      return questions.map((question) => `${question}\n${answerLine}`).join('\n\n')
    case 'question_clauses':
      return questions.map((question) => `${question} ${answerLine}`).join(' ')
    case 'question_spans':
      return questions.map((question) => `${question} ${answerLine}`).join('\n')
    case 'question_middle_spans':
      return questions
        .map((question) => `Keep the surrounding context explicit. ${question} ${answerLine}`)
        .join('\n')
    case 'question_closing_spans':
      return questions.map((question) => `${answerLine} ${question}`).join('\n')
    case 'question_closing_blocks':
      return questions.map((question) => `${answerLine}\n${question}`).join('\n\n')
    case 'question_middle_blocks':
      return questions
        .map((question) => `Keep the surrounding context explicit.\n${question}\n${answerLine}`)
        .join('\n\n')
    case 'matching_runs':
      return openingAnchors
        .map((anchor) => `${anchor} ${answerLine} ${anchor} ${answerLine}`)
        .join('\n\n')
    case 'matching_opening_runs':
      return openingAnchors.map((anchor) => `${anchor} ${answerLine}`).join('\n')
    case 'matching_closing_runs':
      return closingAnchors.map((anchor) => `${answerLine} ${anchor}`).join('\n')
    case 'matching_middle_runs':
      return closingAnchors
        .map((anchor) => `Keep the leading context explicit. ${anchor} ${answerLine}`)
        .join('\n')
    case 'topic_clauses':
      return labels.map((label) => `${label} should ${answerLine.toLowerCase()}`).join('; ')
    case 'topic_sentences':
    case 'topic_spans':
    case 'topic_paragraphs':
    case 'topic_blocks':
      return labels.map((label) => `${label} should ${answerLine.toLowerCase()}`).join('\n')
    case 'topic_middle_spans':
      return labels
        .map((label) => `Keep the leading context explicit. ${label}: ${answerLine}`)
        .join('\n')
    case 'topic_closing_spans':
      return labels.map((label) => `${answerLine} ${label}.`).join('\n')
    case 'topic_closing_blocks':
      return labels.map((label) => `${answerLine}\n${label}.`).join('\n\n')
    case 'topic_middle_blocks':
      return labels
        .map((label) => `Keep the leading context explicit.\n${label}.\n${answerLine}`)
        .join('\n\n')
    default:
      return null
  }
}

function selectRecommendedDeterministicSourceResponseFormat(
  consumers: SourceResponseTemplateConsumer[],
): GoalSourceResponseFormat | null {
  const normalizedConsumers = collectSourceResponseTemplateConsumers(consumers)
  if (normalizedConsumers.length === 0) {
    return null
  }

  if (normalizedConsumers.length === 1) {
    return 'single_pending'
  }

  return normalizedConsumers.some((consumer) => consumer.prompt?.trim().length)
    ? 'question_blocks'
    : 'labeled_sections'
}

export function buildRecommendedContextualSourceResponseTemplate(
  consumers: SourceResponseTemplateConsumer[],
) {
  const format = selectRecommendedDeterministicSourceResponseFormat(consumers)
  if (!format) {
    return null
  }

  const template = buildContextualSourceResponseTemplate(format, consumers)
  if (!template) {
    return null
  }

  return {
    format,
    template,
  }
}

export function buildSourceResponseFormatTemplate(format: GoalSourceResponseFormat) {
  switch (format) {
    case 'single_pending':
      return 'Stage rollout through internal users first, then widen to beta after the docs update lands.'
    case 'labeled_sections':
      return [
        'Rollout shape:',
        'Stage rollout through internal users first.',
        '',
        'Timeline:',
        'Start beta next sprint after the docs update lands.',
      ].join('\n')
    case 'ordered_items':
      return [
        '1. Stage rollout through internal users first.',
        '2. Start beta next sprint after the docs update lands.',
        '3. Keep public launch after QA sign-off.',
      ].join('\n')
    case 'ordered_blocks':
      return [
        '1. Rollout shape',
        '   Stage rollout through internal users first.',
        '',
        '2. Timeline',
        '   Start beta next sprint after the docs update lands.',
        '',
        '3. Launch gate',
        '   Keep public launch after QA sign-off.',
      ].join('\n')
    case 'pending_clauses':
      return [
        'Stage rollout through internal users first;',
        'start beta next sprint after the docs update lands;',
        'keep public launch after QA sign-off.',
      ].join(' ')
    case 'pending_paragraphs':
      return [
        'Stage rollout through internal users first.',
        '',
        'Start beta next sprint after the docs update lands.',
        '',
        'Keep public launch after QA sign-off.',
      ].join('\n')
    case 'pending_sentences':
      return [
        'Stage rollout through internal users first.',
        'Start beta next sprint after the docs update lands.',
        'Keep public launch after QA sign-off.',
      ].join(' ')
    case 'pending_conjunctions':
      return [
        'Stage rollout through internal users first,',
        'start beta next sprint after the docs update lands,',
        'and keep public launch after QA sign-off.',
      ].join(' ')
    case 'question_blocks':
      return [
        'What rollout shape should we use?',
        'Stage rollout through internal users first.',
        '',
        'When should beta start?',
        'Start beta next sprint after the docs update lands.',
      ].join('\n')
    case 'question_clauses':
      return [
        'What rollout shape should we use? Stage rollout through internal users first;',
        'when should beta start? Start beta next sprint after the docs update lands.',
      ].join(' ')
    case 'question_spans':
      return [
        'What rollout shape should we use? Stage rollout through internal users first.',
        'When should beta start? Start beta next sprint after the docs update lands.',
      ].join('\n')
    case 'question_middle_spans':
      return [
        'We should keep the first wave internal. What rollout shape should we use? Stage rollout through internal users first.',
        'We should avoid a public launch before docs land. When should beta start? Start beta next sprint after the docs update lands.',
      ].join('\n')
    case 'question_closing_spans':
      return [
        'Stage rollout through internal users first. What rollout shape should we use?',
        'Start beta next sprint after the docs update lands. When should beta start?',
      ].join('\n')
    case 'question_closing_blocks':
      return [
        'Stage rollout through internal users first.',
        'What rollout shape should we use?',
        '',
        'Start beta next sprint after the docs update lands.',
        'When should beta start?',
      ].join('\n')
    case 'question_middle_blocks':
      return [
        'We should keep the first wave internal.',
        'What rollout shape should we use?',
        'Stage rollout through internal users first.',
        '',
        'We should avoid a public launch before docs land.',
        'When should beta start?',
        'Start beta next sprint after the docs update lands.',
      ].join('\n')
    case 'inline_topics':
      return [
        'Rollout shape: stage rollout through internal users first.',
        'Timeline: start beta next sprint after the docs update lands.',
      ].join(' ')
    case 'topic_clauses':
      return [
        'For rollout shape, stage rollout through internal users first;',
        'for timeline, start beta next sprint after the docs update lands.',
      ].join(' ')
    case 'topic_sentences':
      return [
        'Rollout shape: stage rollout through internal users first.',
        'Timeline: start beta next sprint after the docs update lands.',
      ].join('\n')
    case 'topic_spans':
      return [
        'Rollout shape: stage rollout through internal users first. Keep public launch after QA sign-off.',
        'Timeline: start beta next sprint after the docs update lands. Keep external launch after QA.',
      ].join('\n')
    case 'topic_middle_spans':
      return [
        'We should keep the first wave internal. Rollout shape: stage rollout through internal users first. Keep public launch after QA sign-off.',
        'We should avoid a public launch before docs land. Timeline: start beta next sprint after the docs update lands. Keep external launch after QA.',
      ].join('\n')
    case 'topic_closing_spans':
      return [
        'Stage rollout through internal users first. Rollout shape.',
        'Start beta next sprint after the docs update lands. Timeline.',
      ].join('\n')
    case 'topic_closing_blocks':
      return [
        'Stage rollout through internal users first.',
        'Keep public launch after QA sign-off.',
        'Rollout shape.',
        '',
        'Start beta next sprint after the docs update lands.',
        'Keep external launch after QA.',
        'Timeline.',
      ].join('\n')
    case 'topic_paragraphs':
      return [
        'Rollout shape: stage rollout through internal users first and keep public launch after QA sign-off.',
        '',
        'Timeline: start beta next sprint after the docs update lands and keep external launch after QA.',
      ].join('\n')
    case 'topic_middle_blocks':
      return [
        'We should keep the first wave internal.',
        'Rollout shape.',
        'Stage rollout through internal users first and keep public launch after QA sign-off.',
        '',
        'We should avoid a public launch before docs land.',
        'Timeline.',
        'Start beta next sprint after the docs update lands and keep external launch after QA.',
      ].join('\n')
    case 'topic_blocks':
      return [
        'Rollout shape.',
        'Stage rollout through internal users first and keep public launch after QA sign-off.',
        '',
        'Timeline.',
        'Start beta next sprint after the docs update lands and keep external launch after QA.',
      ].join('\n')
    case 'matching_runs':
      return [
        'Rollout shape: stage rollout through internal users first. Rollout shape: keep public launch after QA sign-off.',
        '',
        'Timeline: start beta next sprint after the docs update lands. Timeline: keep external launch after QA.',
      ].join('\n')
    case 'matching_opening_runs':
      return [
        'Rollout shape: stage rollout through internal users first. Keep public launch after QA sign-off.',
        'Timeline: start beta next sprint after the docs update lands. Keep external launch after QA.',
      ].join('\n')
    case 'matching_closing_runs':
      return [
        'Stage rollout through internal users first. Rollout shape.',
        'Start beta next sprint after the docs update lands. Timeline.',
      ].join('\n')
    case 'matching_middle_runs':
      return [
        'We should keep the first wave internal. Rollout shape. Keep public launch after QA sign-off.',
        'We should avoid a public launch before docs land. Timeline. Start beta next sprint after the docs update lands.',
      ].join('\n')
    case 'auto':
    case 'pending_answer_sources':
    case 'matching_answer_sources':
      return null
  }
}
