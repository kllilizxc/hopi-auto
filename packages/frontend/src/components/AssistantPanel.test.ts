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
