import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MessageFeedItem } from '../lib/messageFeed'
import { UnifiedMessageFeed } from './UnifiedMessageFeed'

test('uses conversation-shaped skeleton rows for an initially loading feed', () => {
  const markup = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="loading"
      items={[]}
      isLoading
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )

  expect(markup).toContain('message-feed-skeleton')
  expect(markup.match(/message-feed-skeleton__row/g)).toHaveLength(3)
  expect(markup).not.toContain('app-spinner')
  expect(markup).not.toContain('Loading messages…')
})

test('renders one conversation activity after the newest historical row', () => {
  const reply: MessageFeedItem = {
    id: 'reply',
    createdAt: '2026-07-12T12:00:00.000Z',
    kind: 'assistant_message',
    role: 'assistant',
    text: 'Still processing the request.',
  }

  const markup = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="test"
      items={[reply]}
      tailActivity="working"
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )

  expect(markup).toContain('unified-feed-waiting')
  expect(markup).toContain('app-breathing-indicator')
  expect(markup).toContain('Working')
  expect(markup.match(/Working/g)).toHaveLength(1)
  expect(markup.indexOf('Still processing the request.')).toBeLessThan(markup.indexOf('Working'))
  expect(markup).not.toContain('app-spinner')
  expect(markup).not.toContain('app-disclosure')
})

test('renders hidden model activity as one Thinking breathing status', () => {
  const markup = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="thinking"
      items={[]}
      tailActivity="thinking"
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )

  expect(markup).toContain('data-phase="thinking"')
  expect(markup).toContain('app-breathing-indicator')
  expect(markup).toContain('Thinking')
  expect(markup.match(/app-breathing-indicator/g)).toHaveLength(1)
  expect(markup).not.toContain('Working')
  expect(markup).not.toContain('Empty')
})

test('decorates the exact unresolved Assistant request and restores it after resolution', () => {
  const request: MessageFeedItem = {
    id: 'request',
    createdAt: '2026-07-12T12:00:00.000Z',
    kind: 'assistant_message',
    role: 'assistant',
    text: 'Which release strategy should I use?',
    groupId: 'inbox:EV-request',
  }
  const marked = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="needs-you"
      items={[request]}
      needsYouByGroupId={new Map([['inbox:EV-request', 2]])}
      onReplyNeedsYou={() => undefined}
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )
  const resolved = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="resolved"
      items={[request]}
      needsYouByGroupId={new Map()}
      onReplyNeedsYou={() => undefined}
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )

  expect(marked).toContain('unified-feed-message-row assistant needs-you')
  expect(marked).toContain('Needs you')
  expect(marked).toContain('· 2')
  expect(marked).toContain('aria-label="Reply to this request"')
  expect(marked).toContain('>Reply<')
  expect(
    marked.match(/<button[^>]*aria-label="Reply to this request"[\s\S]*?<\/button>/)?.[0],
  ).not.toContain('<svg')
  expect(resolved).not.toContain('needs-you')
  expect(resolved).not.toContain('Reply to this request')
})

test('lets Virtuoso follow updates while the reader remains near the bottom', async () => {
  const source = await Bun.file(new URL('./UnifiedMessageFeed.tsx', import.meta.url)).text()

  expect(source).toContain('const MESSAGE_FEED_AUTO_FOLLOW_DISTANCE = 160')
  expect(source).toContain('followOutput="auto"')
  expect(source).toContain('atBottomThreshold={MESSAGE_FEED_AUTO_FOLLOW_DISTANCE}')
  expect(source).toContain('atBottomStateChange={setIsNearBottom}')
  expect(source).not.toContain("followOutput={isAtBottom ? 'auto' : false}")
})

test('can focus an exact conversation group on an explicit request', async () => {
  const source = await Bun.file(new URL('./UnifiedMessageFeed.tsx', import.meta.url)).text()

  expect(source).toContain('feedRowGroupId(row) === focusGroupId')
  expect(source).toContain("scrollToIndex({ index: focusRowIndex, align: 'center' })")
  expect(source).toContain('handledFocusRequestRef.current === focusRequest')
})

test('renders a trailing tool stream directly without an outer aggregate', () => {
  const markup = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="test"
      items={[toolCall('tool')]}
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )

  expect(markup).toContain('unified-feed-live-activity')
  expect(markup).not.toContain('unified-feed-activity"')
  expect(markup).not.toContain('Used search')
  expect(markup).toContain('inspect workspace')
})

test('conversation activity does not prematurely aggregate the trailing tool stream', () => {
  const markup = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="test"
      items={[toolCall('tool')]}
      tailActivity="working"
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )

  expect(markup).toContain('unified-feed-live-activity')
  expect(markup).not.toContain('unified-feed-activity"')
  expect(markup.indexOf('inspect workspace')).toBeLessThan(markup.indexOf('Working'))
})

test('keeps live and historical activity free of repeated labels and timestamps', () => {
  const activityItems: MessageFeedItem[] = [
    {
      id: 'progress',
      createdAt: '2026-07-12T12:00:00.000Z',
      kind: 'status',
      role: 'system',
      label: 'Activity',
      text: 'Checking the current runtime state.',
      groupId: 'turn',
    },
    toolCall('tool'),
  ]
  const liveMarkup = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="test"
      items={activityItems}
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )
  const historicalMarkup = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="test"
      items={[
        ...activityItems,
        {
          id: 'reply',
          createdAt: '2026-07-12T12:00:01.000Z',
          kind: 'assistant_message',
          role: 'assistant',
          text: 'Finished.',
          groupId: 'turn',
        },
      ]}
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )

  expect(liveMarkup).toContain('Checking the current runtime state.')
  for (const markup of [liveMarkup, historicalMarkup]) {
    expect(markup).not.toContain('>Activity<')
    expect(markup).not.toContain('<time')
  }
})

test('does not surface transport metadata as conversation copy', () => {
  const markup = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="test"
      items={[
        {
          id: 'assistant-message',
          createdAt: '2026-07-12T12:00:00.000Z',
          kind: 'assistant_message',
          role: 'assistant',
          text: 'The task is complete.',
          details: ['codex', 'item.completed'],
        },
      ]}
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )

  expect(markup).toContain('The task is complete.')
  expect(markup).not.toContain('codex')
  expect(markup).not.toContain('item.completed')
})

test('opens safe Assistant Markdown links without activating local filesystem paths', () => {
  const artifactUrl = '/api/projects/P-1/goals/G-1/evidence/E-1/artifacts/0'
  const markup = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="links"
      items={[
        {
          id: 'assistant-links',
          createdAt: '2026-07-18T00:00:00.000Z',
          kind: 'assistant_message',
          role: 'assistant',
          text: `报告在 [打开报告](${artifactUrl})。旧路径 [plan](/home/user/plan.md) 不应打开。`,
        },
      ]}
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )

  expect(markup).toContain(`href="${artifactUrl}"`)
  expect(markup).toContain('target="_blank"')
  expect(markup).toContain('>打开报告</a>')
  expect(markup).toContain('[plan](/home/user/plan.md)')
  expect(markup).not.toContain('href="/home/user/plan.md"')
})

test('opens the same safe Markdown links from completion updates', () => {
  const artifactUrl = '/api/projects/P-1/goals/G-1/evidence/E-1/artifacts/7'
  const markup = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="completion-links"
      items={[
        {
          id: 'completion-link',
          createdAt: '2026-07-19T00:00:00.000Z',
          kind: 'system_update',
          role: 'system',
          label: 'Completed',
          text: `已完成：[查看循环动画](${artifactUrl})。`,
        },
      ]}
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )

  expect(markup).toContain('unified-feed-system-update')
  expect(markup).toContain(`href="${artifactUrl}"`)
  expect(markup).toContain('>查看循环动画</a>')
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

  expect(markup).toContain('unified-feed-activity')
  expect(markup).toContain('aria-expanded="false"')
  expect(markup).toContain('Used search')
  expect(markup).not.toContain('inspect workspace')
  expect(markup).toContain('Finished')
})

test('reserves the breathing indicator for the live conversation tail', async () => {
  const markup = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="test"
      items={[
        toolCall('tool', true),
        {
          id: 'reply',
          createdAt: '2026-07-12T12:00:01.000Z',
          kind: 'assistant_message',
          role: 'assistant',
          text: 'Tool processing finished.',
          groupId: 'turn',
        },
      ]}
      tailActivity="working"
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )
  const source = await Bun.file(new URL('./UnifiedMessageFeed.tsx', import.meta.url)).text()

  expect(markup.match(/app-breathing-indicator/g)).toHaveLength(1)
  expect(markup).toContain('Used search')
  expect(markup.indexOf('Used search')).toBeLessThan(markup.indexOf('Working'))
  expect(source.match(/<AppBreathingIndicator\b/g)).toHaveLength(1)
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

function toolCall(id: string, pending = false): MessageFeedItem {
  return {
    id,
    createdAt: '2026-07-12T12:00:00.000Z',
    kind: 'tool_call',
    role: 'system',
    text: 'inspect workspace',
    toolName: 'search',
    toolInvocationKey: id,
    groupId: 'turn',
    pending,
  }
}
