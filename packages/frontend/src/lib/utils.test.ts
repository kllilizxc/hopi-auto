import { describe, expect, test } from 'bun:test'
import { projectDisplayName } from './utils'

describe('Project presentation', () => {
  test('uses the primary Repo folder for a root-scoped Project', () => {
    expect(
      projectDisplayName({
        projectId: 'P-b7e66869-0eb9-46af-bd76-6d3980511348',
        repoPath: '/home/me/Code/MyQuant',
        projectPath: '.',
      }),
    ).toBe('MyQuant')
  })

  test('uses the selected subfolder instead of the Repo root', () => {
    expect(
      projectDisplayName({
        projectId: 'P-legacy',
        repoPath: '/home/me/Code/monorepo',
        projectPath: 'apps/mobile-client',
      }),
    ).toBe('mobile-client')
  })

  test('normalizes Windows paths and falls back to stable identity for a pathless record', () => {
    expect(
      projectDisplayName({
        projectId: 'P-card-game',
        repoPath: 'C:\\Users\\me\\Code\\CardGame\\',
        projectPath: '.',
      }),
    ).toBe('CardGame')
    expect(projectDisplayName({ projectId: 'P-fallback', repoPath: '', projectPath: '.' })).toBe(
      'P-fallback',
    )
  })
})
