import { expect, test } from 'bun:test'

test('Assistant submit publishes locally before waiting for the Inbox response', async () => {
  const source = await Bun.file(new URL('./AssistantPanel.tsx', import.meta.url)).text()
  const handleSend = source.slice(
    source.indexOf('const handleSend = () =>'),
    source.indexOf('const queueImages ='),
  )
  const mutation = source.slice(
    source.indexOf('const sendMutation = useMutation'),
    source.indexOf('const handleSend = () =>'),
  )

  expect(handleSend.indexOf('setOptimisticMessages')).toBeLessThan(
    handleSend.indexOf('sendMutation.mutate(submission)'),
  )
  expect(handleSend.indexOf("setInput('')")).toBeLessThan(
    handleSend.indexOf('sendMutation.mutate(submission)'),
  )
  expect(mutation).toContain('eventId: result.eventId')
  expect(mutation).toContain('assistantStream.refresh()')
  expect(mutation).toContain('setInput((current) =>')
  expect(mutation).toContain('setDraftImages((current) => [...submission.images, ...current])')
})

test('Needs-you count focuses the newest exact request and starts its reply', async () => {
  const source = await Bun.file(new URL('./AssistantPanel.tsx', import.meta.url)).text()
  const focusHandler = source.slice(
    source.indexOf('const replyToLatestNeedsYouMessage = useCallback'),
    source.indexOf('const sendMutation = useMutation'),
  )

  expect(source).toContain('onClick={replyToLatestNeedsYouMessage}')
  expect(source).toContain("messageFocus?.source === 'needs-you'")
  expect(source).toContain('latestNeedsYouGroupId')
  expect(focusHandler).toContain("source: 'needs-you'")
  expect(source).toContain('assistantStream.requests.map')
  expect(focusHandler).toContain('needsYouAttentionsByGroupId.get(latestNeedsYouGroupId)')
  expect(focusHandler).toContain('setReplyAttentions(attentions)')
})

test('Assistant Needs-you state comes only from the scoped Feed projection', async () => {
  const source = await Bun.file(new URL('./AssistantPanel.tsx', import.meta.url)).text()

  expect(source).not.toContain('readAssistantAttentions')
  expect(source).not.toContain("queryKey: ['assistant-attentions'")
  expect(source).not.toContain('groupNeedsYouAttentions')
  expect(source).toContain('assistantStream.requests')
})
