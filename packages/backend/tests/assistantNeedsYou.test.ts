import { describe, expect, test } from 'bun:test'
import { needsYouAttentionIds, needsYouRequests } from '../src/assistant/assistantNeedsYou'

const VALID_PROMPT = {
  questions: [
    {
      id: 'scope',
      header: '适用范围',
      question: '哪类单据适用？',
      options: [
        {
          id: 'accrual',
          label: '仅 Accrual',
          description: '沿用当前权威代码映射',
          recommended: true,
          detailPrompt: '填写 System account ID',
        },
        {
          id: 'actual',
          label: '仅 Actual',
          description: '按需求名称解释',
        },
      ],
      allowOther: true,
    },
  ],
}

describe('NeedsYou decision prompts', () => {
  test('projects one validated structured prompt from its owning NeedsYou block', () => {
    const reply = [
      '<NeedsYou attentionId="A-scope">',
      '请选择适用范围。',
      `<DecisionPrompt>${JSON.stringify(VALID_PROMPT)}</DecisionPrompt>`,
      '</NeedsYou>',
    ].join('\n')

    expect(needsYouRequests(reply)).toEqual([
      {
        attentionId: 'A-scope',
        decisionPrompt: VALID_PROMPT,
      },
    ])
    expect(needsYouAttentionIds(reply)).toEqual(['A-scope'])
  })

  test('keeps the ordinary NeedsYou fallback when structured data is invalid', () => {
    const reply =
      '<NeedsYou attentionId="A-scope">请选择。<DecisionPrompt>{"questions":[]}</DecisionPrompt></NeedsYou>'

    expect(needsYouRequests(reply)).toEqual([
      {
        attentionId: 'A-scope',
        decisionPrompt: null,
      },
    ])
    expect(needsYouAttentionIds(reply)).toEqual(['A-scope'])
  })

  test('rejects duplicate IDs, excess options, and prompts outside NeedsYou', () => {
    const validQuestion = VALID_PROMPT.questions.at(0)
    if (!validQuestion) throw new Error('Expected the valid fixture to contain a question')
    const duplicateQuestions = {
      questions: [validQuestion, validQuestion],
    }
    const excessOptions = {
      questions: [
        {
          ...validQuestion,
          options: [
            ...validQuestion.options,
            { id: 'both', label: '两者', description: '扩大覆盖范围' },
            { id: 'neither', label: '都不是', description: '等待补充规则' },
          ],
        },
      ],
    }
    const reply = [
      `<DecisionPrompt>${JSON.stringify(VALID_PROMPT)}</DecisionPrompt>`,
      `<NeedsYou attentionId="A-duplicate"><DecisionPrompt>${JSON.stringify(duplicateQuestions)}</DecisionPrompt></NeedsYou>`,
      `<NeedsYou attentionId="A-options"><DecisionPrompt>${JSON.stringify(excessOptions)}</DecisionPrompt></NeedsYou>`,
    ].join('\n')

    expect(needsYouRequests(reply)).toEqual([
      { attentionId: 'A-duplicate', decisionPrompt: null },
      { attentionId: 'A-options', decisionPrompt: null },
    ])
  })
})
