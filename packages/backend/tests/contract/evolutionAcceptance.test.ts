import { expect, test } from 'bun:test'

const readRepoFile = (path: string) =>
  Bun.file(new URL(`../../../../${path}`, import.meta.url)).text()

test('evolution authority keeps Work while rejecting the fixed delivery pipeline', async () => {
  const [index, design, acceptance] = await Promise.all([
    readRepoFile('docs/README.md'),
    readRepoFile('docs/mvp_design.md'),
    readRepoFile('docs/mvp_evolution_acceptance.md'),
  ])

  const authority = index.match(/## Current Authority\n([\s\S]*?)\n## /)?.[1]
  expect(authority).toBeDefined()
  expect(authority).toContain('mvp_design.md')
  expect(authority).toContain('mvp_evolution_acceptance.md')
  expect(authority).not.toContain('mvp_execution.md')

  expect(design).toContain('Work remains a product concept')
  expect(design).toContain('A settled Run is never resumed')
  expect(design).toContain('a Work count is not Goal progress')
  expect(design).toContain('They are not business roles')
  expect(acceptance).toContain('EV-012: take-home replay')
})

test('fixed-pipeline documents are explicitly non-authoritative during migration', async () => {
  const paths = [
    'docs/mvp_document_model.md',
    'docs/mvp_assistant.md',
    'docs/mvp_project_owner.md',
    'docs/mvp_execution.md',
    'docs/mvp_state_machine.md',
    'docs/mvp_multi_repo.md',
    'docs/e2e_test_cases.md',
  ]
  const documents = await Promise.all(paths.map(readRepoFile))

  for (const [index, document] of documents.entries()) {
    expect(document.slice(0, 300), paths[index]).toMatch(
      /Status: (?:Work-based |fixed-pipeline |C1 |historical ).*(?:not current product authority|Current acceptance)/,
    )
  }
})
