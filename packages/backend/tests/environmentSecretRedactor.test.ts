import { describe, expect, test } from 'bun:test'
import {
  ENVIRONMENT_SECRET_REDACTION,
  createEnvironmentSecretRedactor,
} from '../src/agent/environmentSecretRedactor'

describe('environment secret redaction', () => {
  test('removes inherited secret values without rewriting ordinary environment facts', () => {
    const redact = createEnvironmentSecretRedactor({
      TUSHARE_TOKEN: 'tushare-secret-value',
      DATABASE_URL: 'postgres://user:password@example.test/db',
      PROJECT_NAME: 'MyQuant',
    })

    expect(
      redact(
        'project=MyQuant token=tushare-secret-value db=postgres://user:password@example.test/db',
      ),
    ).toBe(
      `project=MyQuant token=${ENVIRONMENT_SECRET_REDACTION} db=${ENVIRONMENT_SECRET_REDACTION}`,
    )
  })

  test('also removes a JSON-escaped representation of a secret', () => {
    const redact = createEnvironmentSecretRedactor({ API_KEY: 'line-one\nline-two' })

    expect(redact('{"output":"line-one\\nline-two"}')).toBe(
      `{"output":"${ENVIRONMENT_SECRET_REDACTION}"}`,
    )
  })

  test('does not globally replace short ambiguous values', () => {
    const redact = createEnvironmentSecretRedactor({ TOKEN: 'test' })

    expect(redact('test output')).toBe('test output')
  })
})
