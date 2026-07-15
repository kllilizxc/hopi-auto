import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MessageFeedItem } from '../lib/messageFeed'
import { UnifiedMessageFeed } from './UnifiedMessageFeed'

test('a pending reply renders as one simple breathing status', () => {
  const pending: MessageFeedItem = {
    id: 'pending-reply',
    createdAt: '2026-07-12T12:00:00.000Z',
    kind: 'status',
    role: 'system',
    text: 'Working',
    groupId: 'inbox:EV-1',
    pending: true,
  }

  const markup = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="test"
      items={[pending]}
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )

  expect(markup).toContain('unified-feed-waiting')
  expect(markup).toContain('app-breathing-indicator')
  expect(markup).toContain('Working')
  expect(markup).not.toContain('app-spinner')
  expect(markup).not.toContain('app-disclosure')
})

test('expands an activity aggregate when it is the final message row', () => {
  const markup = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="test"
      items={[toolCall('tool')]}
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )

  expect(markup).toContain('aria-expanded="true"')
  expect(markup).toContain('inspect workspace')
})

test('collapses an activity aggregate when a later message follows it', () => {
  const markup = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="test"
      items={[
        toolCall('tool'),
        {
          id: 'reply',
          createdAt: '2026-07-12T12:00:01.000Z',
          kind: 'assistant_message',
          role: 'assistant',
          text: 'Finished',
          groupId: 'turn',
        },
      ]}
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )

  expect(markup).toContain('aria-expanded="false"')
  expect(markup).not.toContain('inspect workspace')
  expect(markup).toContain('Finished')
})

test('keeps a final non-tool activity aggregate collapsed', () => {
  const markup = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="test"
      items={[
        {
          id: 'status',
          createdAt: '2026-07-12T12:00:00.000Z',
          kind: 'status',
          role: 'system',
          text: 'Background status detail',
          groupId: 'turn',
        },
      ]}
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )

  expect(markup).toContain('aria-expanded="false"')
  expect(markup.match(/Background status detail/g)).toHaveLength(1)
})

function toolCall(id: string): MessageFeedItem {
  return {
    id,
    createdAt: '2026-07-12T12:00:00.000Z',
    kind: 'tool_call',
    role: 'system',
    text: 'inspect workspace',
    toolName: 'search',
    toolInvocationKey: id,
    groupId: 'turn',
  }
}
