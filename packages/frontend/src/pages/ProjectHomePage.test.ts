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

test('Project full agent access uses the visible shared Switch control', async () => {
  const page = await Bun.file(new URL('./ProjectHomePage.tsx', import.meta.url)).text()
  const componentStyles = await Bun.file(new URL('../styles/app.css', import.meta.url)).text()
  const applicationStyles = await Bun.file(new URL('../index.css', import.meta.url)).text()

  expect(page).toContain('className="project-agent-access"')
  expect(componentStyles).toContain('@heroui/styles/components/switch.css')
  expect(applicationStyles).toContain(
    '.project-agent-access .app-switch__content > span:not(.app-switch__control)',
  )
})

test('Project paths display the selected Git subdirectory without changing the Repo root', () => {
  expect(scopedRepoPath('/home/me/Code/mono', 'apps/new-product')).toBe(
    '/home/me/Code/mono/apps/new-product',
  )
  expect(scopedRepoPath('/home/me/Code/mono/', '.')).toBe('/home/me/Code/mono/')
})

test('Project cards control the one Project Preview session and expose every named surface', async () => {
  const source = await Bun.file(new URL('./ProjectHomePage.tsx', import.meta.url)).text()

  expect(source).toContain('project.preview.surfaces.map')
  expect(source).toContain('startPreview(project.projectId)')
  expect(source).toContain('stopPreview(project.projectId)')
  expect(source).toContain("requestPreviewRepair(project.preview?.repair?.prompt ?? '', {")
  expect(source).toContain('projectId: project.projectId')
})

test('Project linking leaves identity generation to the backend', async () => {
  const source = await Bun.file(new URL('./ProjectHomePage.tsx', import.meta.url)).text()

  expect(source).not.toContain('Project ID')
  expect(source).not.toContain('setProjectId')
  expect(source).not.toContain('Derived when omitted')
  expect(source).toContain('Its primary folder also names it.')
})

test('empty Project folders use the same create operation without a confirmation workflow', async () => {
  const source = await Bun.file(new URL('./ProjectHomePage.tsx', import.meta.url)).text()
  const api = await Bun.file(new URL('../lib/apiClient.ts', import.meta.url)).text()

  expect(source).toContain("selection.kind === 'empty_directory'")
  expect(source).not.toContain('repo-init-modal')
  expect(api).not.toContain('/api/system/initialize-repository')
})

test('Goal creation leaves readable identity generation to the backend', async () => {
  const source = await Bun.file(new URL('./GoalCreatePage.tsx', import.meta.url)).text()

  expect(source).not.toContain('Goal ID')
  expect(source).not.toContain('setGoalId')
  expect(source).not.toContain('Generated when omitted')
})
