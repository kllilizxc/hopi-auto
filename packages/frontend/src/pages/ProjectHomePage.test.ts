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

test('model settings are Home-wide by role and absent from Project cards', async () => {
  const source = await Bun.file(new URL('./ProjectHomePage.tsx', import.meta.url)).text()

  expect(source).toContain('Projects share these settings.')
  expect(source).not.toContain('updateProjectSettings')
  expect(source).not.toContain('project-model-row')
  expect(source).not.toContain('Project default')
})

test('Project paths display the selected Git subdirectory without changing the Repo root', () => {
  expect(scopedRepoPath('/home/me/Code/mono', 'apps/new-product')).toBe(
    '/home/me/Code/mono/apps/new-product',
  )
  expect(scopedRepoPath('/home/me/Code/mono/', '.')).toBe('/home/me/Code/mono/')
})

test('Project linking leaves identity generation to the backend', async () => {
  const source = await Bun.file(new URL('./ProjectHomePage.tsx', import.meta.url)).text()

  expect(source).not.toContain('Project ID')
  expect(source).not.toContain('setProjectId')
  expect(source).not.toContain('Derived when omitted')
  expect(source).toContain('Its primary folder also names it.')
})

test('Goal creation leaves readable identity generation to the backend', async () => {
  const source = await Bun.file(new URL('./GoalCreatePage.tsx', import.meta.url)).text()

  expect(source).not.toContain('Goal ID')
  expect(source).not.toContain('setGoalId')
  expect(source).not.toContain('Generated when omitted')
})
