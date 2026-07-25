const REDACTION = '[REDACTED_SECRET]'
const MINIMUM_SECRET_LENGTH = 8
const SECRET_NAME =
  /(?:^|_)(?:AUTH|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|DATABASE_URL|CONNECTION_STRING|DSN)(?:$|_)/i

export function createEnvironmentSecretRedactor(
  environment: Readonly<Record<string, string | undefined>>,
) {
  const values = new Set<string>()
  for (const [name, value] of Object.entries(environment)) {
    if (!SECRET_NAME.test(name) || !value || value.length < MINIMUM_SECRET_LENGTH) continue
    values.add(value)
    const escaped = JSON.stringify(value).slice(1, -1)
    if (escaped !== value) values.add(escaped)
  }
  const candidates = [...values].sort((left, right) => right.length - left.length)

  return (text: string) => {
    let redacted = text
    for (const value of candidates) redacted = redacted.split(value).join(REDACTION)
    return redacted
  }
}

export const ENVIRONMENT_SECRET_REDACTION = REDACTION
