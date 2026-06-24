import type { GoalSourceResponseFormat } from '../lib/api'
import { ScrollContainer } from '../components/ScrollContainer'
import {
  ANSWER_SOURCE_ONLY_FORMATS,
  INFER_DECISION_TOPIC_FORMATS,
  INFER_OPEN_DECISION_FORMATS,
  INFER_REMAINING_PLANNING_ANSWER_FORMATS,
  buildContextualSourceResponseTemplate,
  buildRecommendedContextualSourceResponseTemplate,
  buildSourceResponseFormatTemplate,
  collectSourceResponseTemplateConsumers,
  describeSourceResponseFormat,
  describeSourceResponseInputAuthority,
  formatSourceResponseFormatLabel,
  type SourceResponseTemplateConsumer,
} from './boardViewSourceResponseSupport'

export function SourceResponseFormatGuidance({
  format,
  sourceResponse,
  onApplyTemplate,
  onApplyFormatTemplate,
  onApplyFormatContextSetup,
  onApplyFormatAnswerContextSetup,
  onApplyCurrentContextSetup,
  onApplyCurrentAnswerContextSetup,
  onApplyCurrentAnswerSetup,
  onApplyCurrentAnswerSourceSetup,
  onApplyCurrentConsumerRouting,
  consumers = [],
}: {
  format: GoalSourceResponseFormat
  sourceResponse?: string
  onApplyTemplate?: (value: string) => void
  onApplyFormatTemplate?: (format: GoalSourceResponseFormat, value: string) => void
  onApplyFormatContextSetup?: (format: GoalSourceResponseFormat, value: string) => void
  onApplyFormatAnswerContextSetup?: (format: GoalSourceResponseFormat, value: string) => void
  onApplyCurrentContextSetup?: (value: string) => void
  onApplyCurrentAnswerContextSetup?: (value: string) => void
  onApplyCurrentAnswerSetup?: () => void
  onApplyCurrentAnswerSourceSetup?: () => void
  onApplyCurrentConsumerRouting?: () => void
  consumers?: SourceResponseTemplateConsumer[]
}) {
  const template = buildSourceResponseFormatTemplate(format)
  const trimmedSourceResponse = sourceResponse?.trim() ?? ''
  const usesAnswerSourceOnly = ANSWER_SOURCE_ONLY_FORMATS.has(format)
  const contextualConsumers = collectSourceResponseTemplateConsumers(consumers)
  const contextualTemplate = buildContextualSourceResponseTemplate(format, contextualConsumers)
  const recommendedContextualTemplate =
    format === 'auto' ? buildRecommendedContextualSourceResponseTemplate(contextualConsumers) : null

  return (
    <div className="mt-2 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
        {formatSourceResponseFormatLabel(format)}
      </div>
      <div className="mt-1 text-xs leading-5 text-gray-400">
        {describeSourceResponseFormat(format)}
      </div>
      <div className="mt-2 text-[11px] text-gray-500">
        Input authority: {describeSourceResponseInputAuthority(format)}
      </div>
      <div className="mt-1 text-[11px] text-gray-500">
        Inference support: open decisions {INFER_OPEN_DECISION_FORMATS.has(format) ? 'yes' : 'no'} ·
        decision topics {INFER_DECISION_TOPIC_FORMATS.has(format) ? 'yes' : 'no'} · remaining
        answers {INFER_REMAINING_PLANNING_ANSWER_FORMATS.has(format) ? 'yes' : 'no'}
      </div>
      {format === 'auto' ? (
        <div className="mt-2 text-[11px] text-gray-500">
          Pick a concrete deterministic format to reveal a starter template, or keep auto when you
          already have a well-structured shared reply.
        </div>
      ) : usesAnswerSourceOnly ? (
        <div className="mt-2 text-[11px] text-gray-500">
          This format consumes structured answer sources instead of a shared source-response
          textarea.
        </div>
      ) : template ? (
        <details className="mt-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3">
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Starter template
          </summary>
          <div className="mt-3 text-[11px] text-gray-500">
            Insert a deterministic skeleton for this format, then replace the placeholder content
            with the current reply text.
          </div>
          <ScrollContainer
            axis="both"
            className="mt-3 rounded-lg border border-[#252525] bg-[#161616]"
            viewportClassName="max-h-72 px-3 py-3"
          >
            <pre className="min-h-full whitespace-pre-wrap text-xs leading-5 text-gray-300">
              {template}
            </pre>
          </ScrollContainer>
          {onApplyTemplate && (
            <button
              type="button"
              onClick={() => onApplyTemplate(template)}
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
            >
              {trimmedSourceResponse.length > 0 ? 'Replace source response' : 'Insert template'}
            </button>
          )}
        </details>
      ) : null}
      {contextualConsumers.length > 0 ? (
        <details className="mt-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3">
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Current consumer prefill
          </summary>
          <div className="mt-3 text-[11px] text-gray-500">
            Preserve this current consumer order or label authority when rewriting the shared reply
            into a deterministic format.
          </div>
          <div className="mt-3 space-y-2">
            {contextualConsumers.map((consumer, index) => (
              <div
                key={`${consumer.summary}:${consumer.prompt ?? index}`}
                className="rounded-lg border border-[#252525] bg-[#161616] px-3 py-2"
              >
                <div className="text-[11px] font-medium text-gray-300">
                  {index + 1}. {consumer.summary || consumer.prompt}
                </div>
                {consumer.prompt && consumer.prompt !== consumer.summary ? (
                  <div className="mt-1 text-[11px] text-gray-500">{consumer.prompt}</div>
                ) : null}
              </div>
            ))}
          </div>
          {contextualTemplate && !usesAnswerSourceOnly ? (
            <>
              <div className="mt-3 text-[11px] text-gray-500">
                Insert a deterministic skeleton seeded from the current consumer authority instead
                of rebuilding the labels or order by hand.
              </div>
              <ScrollContainer
                axis="both"
                className="mt-3 rounded-lg border border-[#252525] bg-[#161616]"
                viewportClassName="max-h-72 px-3 py-3"
              >
                <pre className="min-h-full whitespace-pre-wrap text-xs leading-5 text-gray-300">
                  {contextualTemplate}
                </pre>
              </ScrollContainer>
              {onApplyTemplate && (
                <button
                  type="button"
                  onClick={() => onApplyTemplate(contextualTemplate)}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
                >
                  {trimmedSourceResponse.length > 0
                    ? 'Replace with current-context template'
                    : 'Insert current-context template'}
                </button>
              )}
              {onApplyCurrentContextSetup && (
                <button
                  type="button"
                  onClick={() => onApplyCurrentContextSetup(contextualTemplate)}
                  className="mt-3 ml-3 inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
                >
                  Set up current-context reply
                </button>
              )}
              {onApplyCurrentAnswerContextSetup && (
                <button
                  type="button"
                  onClick={() => onApplyCurrentAnswerContextSetup(contextualTemplate)}
                  className="mt-3 ml-3 inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
                >
                  Set up current answer context
                </button>
              )}
            </>
          ) : format === 'auto' ? (
            <>
              <div className="mt-3 text-[11px] text-gray-500">
                Auto will still reuse the current consumer order and authority. Pick a concrete
                deterministic format if you want a seeded reply template, or route the current
                consumers directly into structured answer sources here.
              </div>
              {recommendedContextualTemplate ? (
                <>
                  <div className="mt-3 text-[11px] text-gray-500">
                    Recommended deterministic surface:{' '}
                    {formatSourceResponseFormatLabel(recommendedContextualTemplate.format)}.
                  </div>
                  <ScrollContainer
                    axis="both"
                    className="mt-3 rounded-lg border border-[#252525] bg-[#161616]"
                    viewportClassName="max-h-72 px-3 py-3"
                  >
                    <pre className="min-h-full whitespace-pre-wrap text-xs leading-5 text-gray-300">
                      {recommendedContextualTemplate.template}
                    </pre>
                  </ScrollContainer>
                  {onApplyFormatTemplate ? (
                    <button
                      type="button"
                      onClick={() =>
                        onApplyFormatTemplate(
                          recommendedContextualTemplate.format,
                          recommendedContextualTemplate.template,
                        )
                      }
                      className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
                    >
                      Use {formatSourceResponseFormatLabel(recommendedContextualTemplate.format)}
                    </button>
                  ) : null}
                  {onApplyFormatContextSetup ? (
                    <button
                      type="button"
                      onClick={() =>
                        onApplyFormatContextSetup(
                          recommendedContextualTemplate.format,
                          recommendedContextualTemplate.template,
                        )
                      }
                      className="mt-3 ml-3 inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
                    >
                      Set up {formatSourceResponseFormatLabel(recommendedContextualTemplate.format)}
                    </button>
                  ) : null}
                  {onApplyFormatAnswerContextSetup ? (
                    <button
                      type="button"
                      onClick={() =>
                        onApplyFormatAnswerContextSetup(
                          recommendedContextualTemplate.format,
                          recommendedContextualTemplate.template,
                        )
                      }
                      className="mt-3 ml-3 inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
                    >
                      Set up current answer context
                    </button>
                  ) : null}
                </>
              ) : null}
              {onApplyCurrentAnswerSetup ? (
                <button
                  type="button"
                  onClick={() => onApplyCurrentAnswerSetup()}
                  className="mt-3 mr-3 inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
                >
                  Set up current answers
                </button>
              ) : null}
              {onApplyCurrentAnswerSourceSetup ? (
                <button
                  type="button"
                  onClick={() => onApplyCurrentAnswerSourceSetup()}
                  className="mt-3 mr-3 inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
                >
                  Set up current answer sources
                </button>
              ) : null}
              {onApplyCurrentConsumerRouting && (
                <button
                  type="button"
                  onClick={() => onApplyCurrentConsumerRouting()}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
                >
                  Route current consumers
                </button>
              )}
            </>
          ) : usesAnswerSourceOnly ? (
            <>
              <div className="mt-3 text-[11px] text-gray-500">
                This format routes structured answer sources without a shared source-response
                textarea. Use the current consumer order above to seed those routing entries
                directly.
              </div>
              {onApplyCurrentAnswerSourceSetup && (
                <button
                  type="button"
                  onClick={() => onApplyCurrentAnswerSourceSetup()}
                  className="mt-3 mr-3 inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
                >
                  Set up current answer sources
                </button>
              )}
              {onApplyCurrentAnswerSetup ? (
                <button
                  type="button"
                  onClick={() => onApplyCurrentAnswerSetup()}
                  className="mt-3 mr-3 inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
                >
                  Set up current answers
                </button>
              ) : null}
              {onApplyCurrentConsumerRouting && (
                <button
                  type="button"
                  onClick={() => onApplyCurrentConsumerRouting()}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
                >
                  Route current consumers
                </button>
              )}
            </>
          ) : (
            <div className="mt-3 text-[11px] text-gray-500">
              Use the consumer order above together with the generic starter template for this
              format.
            </div>
          )}
        </details>
      ) : null}
    </div>
  )
}

export function SourceResponseFormatCompatibilityNotice({
  issues,
}: {
  issues: string[]
}) {
  if (issues.length === 0) {
    return null
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-xs text-amber-100">
      <div className="font-medium text-amber-200">Current interpretation constraints</div>
      <div className="mt-2 space-y-1">
        {issues.map((issue, index) => (
          <div key={`source-response-format-issue:${index}`}>{issue}</div>
        ))}
      </div>
    </div>
  )
}

export function WorkflowAuthoringConstraintNotice({
  issues,
}: {
  issues: string[]
}) {
  if (issues.length === 0) {
    return null
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-xs text-amber-100">
      <div className="font-medium text-amber-200">Current workflow authoring constraints</div>
      <div className="mt-2 space-y-1">
        {issues.map((issue, index) => (
          <div key={`workflow-child-dependency-issue:${index}`}>{issue}</div>
        ))}
      </div>
    </div>
  )
}
