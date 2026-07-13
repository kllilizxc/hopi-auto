import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { checkoutSnapshot, gitOutput, runCommand } from './liveHarness'

export async function initializeFailingClampProject(repoRoot: string) {
  await mkdir(join(repoRoot, 'src'), { recursive: true })
  await mkdir(join(repoRoot, 'scripts', 'hopi'), { recursive: true })
  await Bun.write(
    join(repoRoot, 'AGENTS.md'),
    [
      '# Test Project',
      '',
      'Keep the implementation minimal and run `bun test` before reporting success.',
      '',
    ].join('\n'),
  )
  await Bun.write(
    join(repoRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'hopi-live-e2e-clamp',
        private: true,
        type: 'module',
        scripts: { test: 'bun test' },
      },
      null,
      2,
    )}\n`,
  )
  await Bun.write(
    join(repoRoot, 'src', 'clamp.ts'),
    [
      'export function clampScore(score: number) {',
      '  return Math.min(0, Math.max(100, score))',
      '}',
      '',
    ].join('\n'),
  )
  await Bun.write(
    join(repoRoot, 'src', 'clamp.test.ts'),
    [
      "import { expect, test } from 'bun:test'",
      "import { clampScore } from './clamp'",
      '',
      "test('clamps scores into the inclusive 0 to 100 range', () => {",
      '  expect(clampScore(-5)).toBe(0)',
      '  expect(clampScore(50)).toBe(50)',
      '  expect(clampScore(120)).toBe(100)',
      '})',
      '',
    ].join('\n'),
  )
  const preparePath = join(repoRoot, 'scripts', 'hopi', 'prepare')
  await Bun.write(preparePath, '#!/usr/bin/env sh\nset -eu\n:\n')
  await chmod(preparePath, 0o755)
  await gitOutput(repoRoot, ['init', '-b', 'main'])
  await gitOutput(repoRoot, ['config', 'core.autocrlf', 'false'])
  await gitOutput(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await gitOutput(repoRoot, ['config', 'user.name', 'HOPI Live E2E'])
  await gitOutput(repoRoot, ['add', '.'])
  await gitOutput(repoRoot, ['commit', '-m', 'add failing clamp fixture'])

  const initialTest = await runCommand(['bun', 'test'], repoRoot)
  if (initialTest.exitCode === 0) throw new Error('Clamp fixture must begin with a failing test')
  return checkoutSnapshot(repoRoot)
}

export async function verifyIntegratedClampProject(integrationRoot: string) {
  const result = await runCommand(['bun', 'test'], integrationRoot)
  if (result.exitCode !== 0) {
    throw new Error(
      `Integrated Project tests failed:\n${result.stdout.trim()}\n${result.stderr.trim()}`,
    )
  }
  return { command: 'bun test', stdout: result.stdout.trim(), stderr: result.stderr.trim() }
}
