import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { readClaudeProviderEnvironment } from '../src/agent/claudeSettingsEnvironment'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'claude-settings-environment')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(join(temporaryRoot, '.claude'), { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('Claude provider environment', () => {
  test('loads only provider variables without importing user permissions', async () => {
    await Bun.write(
      join(temporaryRoot, '.claude', 'settings.json'),
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:43119',
          ANTHROPIC_API_KEY: 'secret',
          ANTHROPIC_MODEL: 'gemini-3.1-pro-preview',
          CLAUDE_CODE_USE_VERTEX: '1',
          CLAUDE_CODE_USE_FOUNDRY: '1',
          AWS_REGION: 'us-east-1',
          PATH: '/unsafe/path',
        },
        permissions: { allow: ['Bash(*)'] },
      }),
    )

    expect(await readClaudeProviderEnvironment(temporaryRoot, {})).toEqual({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:43119',
      ANTHROPIC_API_KEY: 'secret',
      ANTHROPIC_MODEL: 'gemini-3.1-pro-preview',
      CLAUDE_CODE_USE_VERTEX: '1',
      CLAUDE_CODE_USE_FOUNDRY: '1',
      AWS_REGION: 'us-east-1',
    })
  })

  test('keeps the inherited process environment authoritative', async () => {
    await Bun.write(
      join(temporaryRoot, '.claude', 'settings.json'),
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://settings.example' } }),
    )

    expect(
      await readClaudeProviderEnvironment(temporaryRoot, {
        ANTHROPIC_BASE_URL: 'http://process.example',
      }),
    ).toEqual({})
  })

  test('reads the active custom Claude config directory', async () => {
    const configRoot = join(temporaryRoot, 'work-account')
    await mkdir(configRoot, { recursive: true })
    await Bun.write(
      join(configRoot, 'settings.json'),
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://custom.example' } }),
    )

    expect(
      await readClaudeProviderEnvironment(undefined, { CLAUDE_CONFIG_DIR: configRoot }),
    ).toEqual({ ANTHROPIC_BASE_URL: 'http://custom.example' })
  })
})
