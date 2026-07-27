import { z } from 'zod'

const decisionIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/)

const decisionOptionSchema = z
  .object({
    id: decisionIdSchema,
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(400),
    recommended: z.boolean().optional(),
    detailPrompt: z.string().trim().min(1).max(200).optional(),
  })
  .strict()

const decisionQuestionSchema = z
  .object({
    id: decisionIdSchema,
    header: z.string().trim().min(1).max(40),
    question: z.string().trim().min(1).max(600),
    options: z.array(decisionOptionSchema).min(2).max(3),
    allowOther: z.boolean().default(true),
  })
  .strict()
  .superRefine((question, context) => {
    if (new Set(question.options.map((option) => option.id)).size !== question.options.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'Decision option IDs must be unique within a question',
      })
    }
  })

export const assistantDecisionPromptSchema = z
  .object({
    questions: z.array(decisionQuestionSchema).min(1).max(8),
  })
  .strict()
  .superRefine((prompt, context) => {
    if (new Set(prompt.questions.map((question) => question.id)).size !== prompt.questions.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['questions'],
        message: 'Decision question IDs must be unique',
      })
    }
  })

export type AssistantDecisionPrompt = z.infer<typeof assistantDecisionPromptSchema>
