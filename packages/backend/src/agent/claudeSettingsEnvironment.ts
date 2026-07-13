import { join } from 'node:path'

const CLAUDE_PROVIDER_ENVIRONMENT_KEYS = new Set([
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
  'CLAUDE_CODE_SKIP_MANTLE_AUTH',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_DEFAULT_REGION',
  'AWS_PROFILE',
  'AWS_REGION',
  'CLOUD_ML_REGION',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
])

export async function readClaudeProviderEnvironment(
  homeRoot = process.env.HOME,
  processEnvironment: Record<string, string | undefined> = process.env,
) {
  const configRoot = processEnvironment.CLAUDE_CONFIG_DIR?.trim()
    ? processEnvironment.CLAUDE_CONFIG_DIR
    : homeRoot
      ? join(homeRoot, '.claude')
      : null
  if (!configRoot) return {}
  const file = Bun.file(join(configRoot, 'settings.json'))
  if (!(await file.exists())) return {}

  let source: unknown
  try {
    source = await file.json()
  } catch {
    return {}
  }
  if (!isRecord(source) || !isRecord(source.env)) return {}

  const environment: Record<string, string> = {}
  for (const [key, value] of Object.entries(source.env)) {
    if (!isClaudeProviderEnvironmentKey(key) || typeof value !== 'string') continue
    if (processEnvironment[key] !== undefined) continue
    environment[key] = value
  }
  return environment
}

function isClaudeProviderEnvironmentKey(key: string) {
  return key.startsWith('ANTHROPIC_') || CLAUDE_PROVIDER_ENVIRONMENT_KEYS.has(key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
