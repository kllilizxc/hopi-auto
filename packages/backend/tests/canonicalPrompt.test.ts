import { describe, expect, test } from 'bun:test'
import {
  resolveCanonicalPromptFromSummary,
  synthesizeCanonicalPromptFromSummary,
} from '../src/domain/canonicalPrompt'

describe('canonicalPrompt', () => {
  test('synthesizes a canonical prompt from stable summary phrases', () => {
    expect(synthesizeCanonicalPromptFromSummary('Choose the auth strategy')).toBe(
      'What should the auth strategy be?',
    )
    expect(synthesizeCanonicalPromptFromSummary('Pilot scope')).toBe(
      'What should the pilot scope be?',
    )
  })

  test('preserves question-shaped summaries as-is', () => {
    expect(synthesizeCanonicalPromptFromSummary('Which auth provider should we adopt?')).toBe(
      'Which auth provider should we adopt?',
    )
  })

  test('rejects sentence-like summaries that are not stable prompt authority', () => {
    expect(synthesizeCanonicalPromptFromSummary('Use Bun-native auth for enterprise SSO.')).toBe(
      undefined,
    )
  })

  test('upgrades a synthesized prompt when a stronger explicit prompt arrives later', () => {
    expect(
      resolveCanonicalPromptFromSummary({
        summary: 'Choose the auth strategy',
        currentPrompt: 'What should the auth strategy be?',
        incomingPrompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
      }),
    ).toBe('Which auth strategy should we adopt for the Bun-first runtime?')
  })

  test('preserves an existing richer prompt across later merges', () => {
    expect(
      resolveCanonicalPromptFromSummary({
        summary: 'Choose the auth strategy',
        currentPrompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
        incomingPrompt: 'Should we switch to an external auth provider?',
      }),
    ).toBe('Which auth strategy should we adopt for the Bun-first runtime?')
  })
})
