import type { AnswerCaptureFormat } from '../domain/answerCaptureFormat'
import type { GoalPlanningRequestAnswer } from '../storage/planningRequestStore'
import type {
  RemainingAnswerSourceGroupDescriptor,
  PendingAnswerSourceConsumerDescriptor,
  ResolvedAnswerSourceEntry,
} from './answerInterpretationAnswerSourceSupport'
import type { PreparedDecisionTopicSurface } from './answerInterpretationDecisionTopicSurfaceSupport'
import type {
  InterpretableAnswerSource,
  InterpretableDecisionAnswerEntryInput,
  InterpretableDecisionFollowThroughInput,
  InterpretableDecisionPlanningBatchFollowThroughInput,
  InterpretableDecisionPlanningFollowThroughInput,
  InterpretableDecisionWorkflowPlanningBatchFollowThroughInput,
  InterpretableDecisionWorkflowPlanningFollowThroughInput,
  InterpretableDecisionWorkflowBatchFollowThroughInput,
  InterpretableKnownDecision,
  InterpretableOpenDecision,
  MaterializedInterpretedDecisionAnswer,
} from './answerInterpretationPublicTypes'
import type {
  InterpretableSourceResponseFormat,
  InterpretedSourceResponseState,
  LabeledSourceResponseSection,
  ResolvedAnswerContent,
} from './answerInterpretationTypes'

export type ConcreteInterpretableSourceResponseFormat = AnswerCaptureFormat

export type DecisionBundleInput = {
  answers: InterpretableDecisionAnswerEntryInput[] | undefined
  openDecisions: InterpretableOpenDecision[]
  inferOpenDecisions: boolean
  sourceResponse?: string
  answerSources?: InterpretableAnswerSource[]
  sourceResponseFormat?: InterpretableSourceResponseFormat
  inferDecisionTopics?: boolean
  knownDecisions?: InterpretableKnownDecision[]
  followThrough?: InterpretableDecisionFollowThroughInput
  reservedAnswerCandidates?: string[] | string[][]
}

export type MaterializedFollowThrough =
  | (Omit<InterpretableDecisionPlanningFollowThroughInput, 'answers'> & {
      answers: GoalPlanningRequestAnswer[] | undefined
      resolvedSourceResponseFormat?: ConcreteInterpretableSourceResponseFormat
    })
  | (Omit<InterpretableDecisionPlanningBatchFollowThroughInput, 'answers'> & {
      answers: GoalPlanningRequestAnswer[] | undefined
      resolvedSourceResponseFormat?: ConcreteInterpretableSourceResponseFormat
    })
  | (Omit<InterpretableDecisionWorkflowBatchFollowThroughInput, 'answers' | 'workflows'> & {
      answers: GoalPlanningRequestAnswer[] | undefined
      resolvedSourceResponseFormat?: ConcreteInterpretableSourceResponseFormat
      workflows: Array<
        | (Omit<InterpretableDecisionWorkflowPlanningFollowThroughInput, 'answers'> & {
            answers: GoalPlanningRequestAnswer[] | undefined
          })
        | (Omit<InterpretableDecisionWorkflowPlanningBatchFollowThroughInput, 'answers'> & {
            answers: GoalPlanningRequestAnswer[] | undefined
          })
      >
    })

export interface DecisionMaterializationSupportDependencies {
  assertAutoDidNotSkipMalformedExplicitInlineTopicAuthority: (
    sourceResponse: string | undefined,
  ) => void
  assertAutoSourceResponseFormatCompleteness: (input: {
    sourceResponse?: string
    answerSources?: InterpretableAnswerSource[]
    sourceResponseFormat: ConcreteInterpretableSourceResponseFormat
    sourceResponseState: InterpretedSourceResponseState | undefined
    inferDecisionTopics?: boolean
    inferRemainingAnswers?: boolean
  }) => void
  assertAutoSourceResponseFormatDidNotStopAtWeakerInlineTopics: (
    sourceResponseFormat: ConcreteInterpretableSourceResponseFormat,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => void
  assertDirectAnswerSourceFamilySourceResponseCompleteness: (input: {
    sourceResponse?: string
    answerSources?: InterpretableAnswerSource[]
    sourceResponseFormat?: InterpretableSourceResponseFormat
    sourceResponseState?: InterpretedSourceResponseState
    label: string
  }) => void
  assertDirectLabelFamilySourceResponseCompleteness: (input: {
    sourceResponse?: string
    sourceResponseFormat?: InterpretableSourceResponseFormat
    sourceResponseState?: InterpretedSourceResponseState
    label: string
  }) => void
  assertDirectMatchingRunSourceResponseCompleteness: (input: {
    sourceResponse?: string
    sourceResponseFormat?: InterpretableSourceResponseFormat
    sourceResponseState?: InterpretedSourceResponseState
    label: string
  }) => void
  assertDirectOrderedSourceResponseCompleteness: (input: {
    sourceResponse?: string
    sourceResponseFormat?: InterpretableSourceResponseFormat
    sourceResponseState?: InterpretedSourceResponseState
    label: string
  }) => void
  assertDirectPendingSourceResponseCompleteness: (input: {
    sourceResponse?: string
    sourceResponseFormat?: InterpretableSourceResponseFormat
    sourceResponseState?: InterpretedSourceResponseState
    label: string
  }) => void
  assertDirectQuestionAndTopicSourceResponseCompleteness: (input: {
    sourceResponse?: string
    sourceResponseFormat?: InterpretableSourceResponseFormat
    sourceResponseState?: InterpretedSourceResponseState
    label: string
  }) => void
  assertNoUnusedExplicitlyRoutedAnswerSources: (input: {
    sourceResponse?: string
    answerSources?: InterpretableAnswerSource[]
    sourceResponseFormat?: InterpretableSourceResponseFormat
    sourceResponseState?: InterpretedSourceResponseState
    label: string
  }) => void
  attachCaptureFormat: <T extends object>(
    value: T,
    captureFormat?: AnswerCaptureFormat,
  ) => T & { captureFormat?: AnswerCaptureFormat }
  buildDecisionAnswerSourceResponseCandidates: (
    answer: InterpretableDecisionAnswerEntryInput,
  ) => string[]
  buildDecisionPendingAnswerSourceConsumerDescriptor: (
    answer: InterpretableDecisionAnswerEntryInput,
  ) => PendingAnswerSourceConsumerDescriptor
  buildKnownDecisionSourceResponseCandidates: (decision: InterpretableKnownDecision) => string[]
  buildOpenDecisionSourceResponseCandidates: (decision: InterpretableOpenDecision) => string[]
  createAutoSourceResponseTerminalError: (message: string) => Error
  createInterpretedSourceResponseState: (
    sourceResponse?: string,
    sourceResponseFormat?: InterpretableSourceResponseFormat,
  ) => InterpretedSourceResponseState | undefined
  finalizeMaterializedPlanningAnswers: (
    answers: GoalPlanningRequestAnswer[],
    captureFormat?: AnswerCaptureFormat,
  ) => GoalPlanningRequestAnswer[]
  followThroughInfersRemainingAnswers: (
    followThrough: InterpretableDecisionFollowThroughInput | undefined,
  ) => boolean
  hasMixedRemainingAnswerSourceInference: (input: DecisionBundleInput) => boolean
  isTerminalLabelFamilyAutoProbeError: (
    sourceResponseFormat: ConcreteInterpretableSourceResponseFormat,
    error: unknown,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => boolean
  listAutoSourceResponseFormatCandidates: (input: {
    hasSourceResponse: boolean
    hasAnswerSources: boolean
    needsExplicitAnswerInterpretation: boolean
    inferOpenDecisions?: boolean
    inferDecisionTopics?: boolean
    inferRemainingAnswers?: boolean
    sourceResponse?: string
  }) => ConcreteInterpretableSourceResponseFormat[]
  listInterpretableFollowThroughAnswerSummaries: (
    followThrough: InterpretableDecisionFollowThroughInput | undefined,
  ) => string[]
  materializeInterpretedDecisionFollowThrough: (
    followThrough: InterpretableDecisionFollowThroughInput | undefined,
    sourceResponse?: string,
    answerSources?: InterpretableAnswerSource[],
    sourceResponseFormat?: InterpretableSourceResponseFormat,
    sourceResponseState?: InterpretedSourceResponseState,
    enforceDirectSourceResponseCompleteness?: boolean,
  ) => MaterializedFollowThrough | undefined
  materializeMixedRemainingAnswerSourceInference: (input: {
    sourceResponse?: string
    answerSources?: InterpretableAnswerSource[]
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined
    sourceResponseState: InterpretedSourceResponseState | undefined
    knownDecisions: InterpretableKnownDecision[]
  }) => {
    decisionAnswers: MaterializedInterpretedDecisionAnswer[]
    planningAnswers: GoalPlanningRequestAnswer[]
  }
  materializeRemainingDecisionTopicAnswersFromAnswerSourceEntries: (
    entries: ResolvedAnswerSourceEntry[],
    knownDecisions: InterpretableKnownDecision[],
    label: string,
  ) => MaterializedInterpretedDecisionAnswer[]
  materializeMatchingOpenDecisionSurfaceAnswers: (
    openDecisions: InterpretableOpenDecision[],
    explicitDecisionKeys: Set<string>,
    sourceResponse: string | undefined,
    answerSources: InterpretableAnswerSource[] | undefined,
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => MaterializedInterpretedDecisionAnswer[]
  materializePreparedDecisionTopicSurfaceAnswers: (
    preparedDecisionTopicSurface: PreparedDecisionTopicSurface,
    knownDecisions: InterpretableKnownDecision[],
  ) => MaterializedInterpretedDecisionAnswer[]
  normalizeReservedAnswerCandidateGroups: (
    reservedAnswerCandidates: string[] | string[][],
  ) => string[][]
  parseRequiredInlineTopicSections: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => Map<string, LabeledSourceResponseSection>
  parseRequiredLabeledSourceResponseSections: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => Map<string, LabeledSourceResponseSection>
  parseRequiredMatchingAnswerSourceEntries: (
    answerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => ResolvedAnswerSourceEntry[]
  parseRequiredPendingAnswerSourceEntries: (
    answerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => ResolvedAnswerSourceEntry[]
  prepareDecisionTopicSurface: (
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
    sourceResponse: string | undefined,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => PreparedDecisionTopicSurface
  registerMatchingRunCandidateGroups: (
    sourceResponseState: InterpretedSourceResponseState | undefined,
    candidateGroups: string[][],
  ) => void
  registerQuestionAnchorCandidateGroups: (
    sourceResponseState: InterpretedSourceResponseState | undefined,
    candidateGroups: string[][],
  ) => void
  registerTopicAnchorCandidates: (
    sourceResponseState: InterpretedSourceResponseState | undefined,
    candidateGroups: string[][],
  ) => void
  reservePreparedDecisionTopicSurfaceCandidates: (
    preparedDecisionTopicSurface: PreparedDecisionTopicSurface,
    explicitAnswers: InterpretableDecisionAnswerEntryInput[],
    openDecisions: InterpretableOpenDecision[],
    inferOpenDecisions: boolean,
    reservedAnswerCandidateGroups: string[][],
  ) => void
  resolveAutoSourceResponseFormat: (
    requestedSourceResponseFormat: InterpretableSourceResponseFormat | undefined,
    candidateSourceResponseFormats: ConcreteInterpretableSourceResponseFormat[],
    validateCandidate: (sourceResponseFormat: ConcreteInterpretableSourceResponseFormat) => void,
    label: string,
  ) => ConcreteInterpretableSourceResponseFormat | undefined
  resolveRemainingMatchingDecisionAnswerSourceGroupDescriptor: (
    entry: ResolvedAnswerSourceEntry,
  ) => RemainingAnswerSourceGroupDescriptor | undefined
  resolveStructuredAnswerContent: (
    answer: string | undefined,
    sourceExcerpt: string | undefined,
    sourceOccurrence: number | undefined,
    answerSourceKey: string | undefined,
    answerSourceGroupKey: string | undefined,
    sourceResponse: string | undefined,
    label: string,
    answerSourcesByKey?: Map<string, string>,
    answerSourceGroupsByKey?: Map<string, string>,
    pendingAnswerSourceEntries?: ResolvedAnswerSourceEntry[],
    matchingAnswerSourceEntries?: ResolvedAnswerSourceEntry[],
    sourceResponseFormat?: InterpretableSourceResponseFormat,
    sourceResponseCandidates?: string[],
    sourceResponseState?: InterpretedSourceResponseState,
    pendingAnswerSourceConsumerDescriptor?: PendingAnswerSourceConsumerDescriptor,
    rejectMultipleInferredTopicSummariesInTopicUnits?: boolean,
  ) => ResolvedAnswerContent
  shouldAutoSourceResponseProbeFailClosed: (
    sourceResponseFormat: ConcreteInterpretableSourceResponseFormat,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => boolean
  supportsMixedRemainingAnswerSourceInference: (
    sourceResponseFormat: ConcreteInterpretableSourceResponseFormat,
  ) => boolean
  throwSpecificOpenDecisionSurfaceNoMatchError: (
    openDecisions: InterpretableOpenDecision[],
    explicitDecisionKeys: Set<string>,
    sourceResponse: string | undefined,
    answerSources: InterpretableAnswerSource[] | undefined,
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => void
}
