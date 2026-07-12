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
