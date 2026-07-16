import { expect, test } from 'bun:test'
import {
  codingDefaultsToDraft,
  formatCodingDefaults,
  resolveCodingDefaults,
  scopedRepoPath,
} from './ProjectHomePage'

test('Assistant settings use a safe default when an older API omits coding defaults', () => {
  expect(resolveCodingDefaults(undefined)).toEqual({
    transport: 'codex',
    model: 'gpt-5.4',
    reasoningEffort: 'xhigh',
  })
  expect(codingDefaultsToDraft(undefined)).toEqual({
    transport: 'codex',
    model: 'gpt-5.4',
    reasoningEffort: 'xhigh',
  })
  expect(formatCodingDefaults(undefined)).toBe('gpt-5.4 · xhigh')
})

test('Project paths display the selected Git subdirectory without changing the Repo root', () => {
  expect(scopedRepoPath('/home/me/Code/mono', 'apps/new-product')).toBe(
    '/home/me/Code/mono/apps/new-product',
  )
  expect(scopedRepoPath('/home/me/Code/mono/', '.')).toBe('/home/me/Code/mono/')
})
