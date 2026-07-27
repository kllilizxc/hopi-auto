import { useMemo, useState } from 'react'
import type { AssistantAttentionDecisionPrompt, AssistantDecisionQuestion } from '../lib/api'
import { AppButton, AppForm, AppTextArea } from './ui'

const OTHER_OPTION_ID = '__other__'

interface AssistantDecisionPromptProps {
  disabled?: boolean
  prompts: readonly AssistantAttentionDecisionPrompt[]
  onSubmit: (answer: string) => void
}

interface DecisionQuestionEntry {
  key: string
  question: AssistantDecisionQuestion
}

export function AssistantDecisionPrompt({
  disabled = false,
  prompts,
  onSubmit,
}: AssistantDecisionPromptProps) {
  const questions = useMemo(
    () =>
      prompts.flatMap(({ attentionId, prompt }) =>
        prompt.questions.map((question) => ({
          key: `${attentionId}:${question.id}`,
          question,
        })),
      ),
    [prompts],
  )
  const [selectedByQuestion, setSelectedByQuestion] = useState<Record<string, string>>({})
  const [detailByQuestion, setDetailByQuestion] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  const complete = questions.every(({ key, question }) => {
    const selected = selectedByQuestion[key]
    const option = question.options.find((candidate) => candidate.id === selected)
    return Boolean(
      selected &&
        (selected !== OTHER_OPTION_ID || detailByQuestion[key]?.trim()) &&
        (!option?.detailPrompt || detailByQuestion[key]?.trim()),
    )
  })

  if (questions.length === 0) return null

  return (
    <AppForm
      className="assistant-decision-prompt"
      onSubmit={(event) => {
        event.preventDefault()
        if (!complete || disabled || submitted) return
        onSubmit(formatDecisionAnswers(questions, selectedByQuestion, detailByQuestion))
        setSubmitted(true)
      }}
    >
      <div className="assistant-decision-prompt__questions">
        {questions.map(({ key, question }, index) => {
          const selected = selectedByQuestion[key]
          const selectedOption = question.options.find((option) => option.id === selected)
          const detailPrompt =
            selected === OTHER_OPTION_ID
              ? `Other answer for ${question.header}`
              : selectedOption?.detailPrompt
          return (
            <fieldset
              className="assistant-decision-question"
              key={key}
              disabled={disabled || submitted}
            >
              <legend>
                <span>{index + 1}</span>
                <strong>{question.header}</strong>
              </legend>
              <p>{question.question}</p>
              <div className="assistant-decision-question__options">
                {question.options.map((option) => (
                  <AppButton
                    aria-pressed={selected === option.id}
                    className="assistant-decision-option"
                    key={option.id}
                    onClick={() =>
                      setSelectedByQuestion((current) => ({ ...current, [key]: option.id }))
                    }
                    type="button"
                    variant="ghost"
                  >
                    <span>
                      <strong>{option.label}</strong>
                      {option.recommended ? <small>Recommended</small> : null}
                    </span>
                    <span>{option.description}</span>
                  </AppButton>
                ))}
                {question.allowOther ? (
                  <AppButton
                    aria-pressed={selected === OTHER_OPTION_ID}
                    className="assistant-decision-option"
                    onClick={() =>
                      setSelectedByQuestion((current) => ({
                        ...current,
                        [key]: OTHER_OPTION_ID,
                      }))
                    }
                    type="button"
                    variant="ghost"
                  >
                    <span>
                      <strong>Other</strong>
                    </span>
                    <span>Provide a different answer.</span>
                  </AppButton>
                ) : null}
              </div>
              {detailPrompt ? (
                <AppTextArea
                  aria-label={detailPrompt}
                  className="assistant-decision-question__other"
                  onChange={(event) =>
                    setDetailByQuestion((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                  placeholder={detailPrompt}
                  rows={2}
                  value={detailByQuestion[key] ?? ''}
                />
              ) : null}
            </fieldset>
          )
        })}
      </div>
      <AppButton
        className="assistant-decision-prompt__submit"
        disabled={!complete || disabled || submitted}
        type="submit"
      >
        {submitted ? 'Answers submitted' : 'Submit answers'}
      </AppButton>
    </AppForm>
  )
}

export function formatDecisionAnswers(
  questions: readonly DecisionQuestionEntry[],
  selectedByQuestion: Readonly<Record<string, string>>,
  detailByQuestion: Readonly<Record<string, string>>,
) {
  return questions
    .map(({ key, question }, index) => {
      const selected = selectedByQuestion[key]
      const option = question.options.find((candidate) => candidate.id === selected)
      const detail = detailByQuestion[key]?.trim()
      const answer =
        selected === OTHER_OPTION_ID ? detail : [option?.label, detail].filter(Boolean).join(' — ')
      return `${index + 1}. ${question.header}: ${answer ?? ''}`
    })
    .join('\n')
}
