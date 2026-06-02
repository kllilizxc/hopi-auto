const SUMMARY_PROMPT_COMMAND_PATTERN =
  /^(?:choose|decide|select|confirm|clarify|define|identify|determine|set)\s+(?<subject>.+)$/i

const SUMMARY_PROMPT_REJECT_FIRST_TOKENS = new Set([
  'are',
  'can',
  'could',
  'did',
  'do',
  'does',
  'how',
  'i',
  'is',
  'it',
  'should',
  'this',
  'those',
  'they',
  'use',
  'using',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'would',
  'you',
])

export function synthesizeCanonicalPromptFromSummary(summary: string) {
  const raw = summary.trim()
  if (!raw) {
    return undefined
  }

  if (/[?？]\s*$/u.test(raw)) {
    return raw.replace(/？/gu, '?').replace(/\s+/g, ' ').trim()
  }

  let candidate = raw
    .replace(/[.?!]+\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
  const commandMatch = SUMMARY_PROMPT_COMMAND_PATTERN.exec(candidate)
  if (commandMatch?.groups?.subject) {
    candidate = commandMatch.groups.subject.trim()
  }

  if (!candidate || /[:;,]/.test(candidate)) {
    return undefined
  }

  const tokens = candidate.split(/\s+/).filter(Boolean)
  if (tokens.length === 0 || tokens.length > 8) {
    return undefined
  }

  const firstToken = tokens[0]?.toLowerCase()
  if (firstToken && SUMMARY_PROMPT_REJECT_FIRST_TOKENS.has(firstToken)) {
    return undefined
  }

  const normalizedSubject = maybeDecapitalizeLeadingTitleCase(candidate)
  const subject = /^(?:the|a|an|this|that|these|those|my|our|your|his|her|their|its)\b/i.test(
    normalizedSubject,
  )
    ? normalizedSubject
    : `the ${normalizedSubject}`

  return `What should ${subject} be?`
}

export function resolveCanonicalPromptFromSummary(options: {
  summary: string
  currentPrompt?: string
  incomingPrompt?: string
}) {
  const currentPrompt = normalizeOptionalPrompt(options.currentPrompt)
  const incomingPrompt = normalizeOptionalPrompt(options.incomingPrompt)
  const synthesizedPrompt = synthesizeCanonicalPromptFromSummary(options.summary)

  if (currentPrompt) {
    if (
      incomingPrompt &&
      synthesizedPrompt &&
      currentPrompt === synthesizedPrompt &&
      incomingPrompt !== currentPrompt
    ) {
      return incomingPrompt
    }
    return currentPrompt
  }

  return incomingPrompt || synthesizedPrompt
}

function maybeDecapitalizeLeadingTitleCase(value: string) {
  if (!/^[A-Z][a-z]/.test(value)) {
    return value
  }
  return `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`
}

function normalizeOptionalPrompt(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
