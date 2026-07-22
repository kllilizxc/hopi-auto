import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MessageFeedItem } from '../lib/messageFeed'
import { AssistantMarkdown } from './AssistantMarkdown'
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
    <AssistantMarkdown
      text={`报告在 [打开报告](${artifactUrl})。旧路径 [plan](/home/user/plan.md) 不应打开。`}
    />,
  )

  expect(markup).toContain(`href="${artifactUrl}"`)
  expect(markup).toContain('assistant-message-link')
  expect(markup).toContain('target="_blank"')
  expect(markup).toContain('>打开报告</a>')
  expect(markup).toContain('旧路径 plan 不应打开')
  expect(markup).not.toContain('href="/home/user/plan.md"')
})

test('renders safe GFM without executing embedded HTML or loading Markdown images', () => {
  const markup = renderToStaticMarkup(
    <AssistantMarkdown
      text={[
        '# Status',
        '',
        '**Implemented** with ~~obsolete~~ output and `bun test`.',
        '',
        '- First check',
        '- [x] Verified',
        '',
        '> One decision remains.',
        '',
        '```ts',
        'const ready = true',
        '```',
        '',
        '| Check | Result |',
        '| --- | --- |',
        '| Build | pass |',
        '',
        '[unsafe](javascript:alert(1))',
        '<script>alert("embedded")</script>',
        '![remote](https://example.com/tracker.png)',
      ].join('\n')}
    />,
  )

  expect(markup).toContain('<h1>Status</h1>')
  expect(markup).toContain('<strong>Implemented</strong>')
  expect(markup).toContain('<del>obsolete</del>')
  expect(markup).toContain('<code>bun test</code>')
  expect(markup).toContain('contains-task-list')
  expect(markup).toContain('<blockquote>')
  expect(markup).toContain('<pre><code class="language-ts">')
  expect(markup).toContain('<table>')
  expect(markup).not.toContain('href="javascript:')
  expect(markup).not.toContain('<script')
  expect(markup).not.toContain('alert(&quot;embedded&quot;)')
  expect(markup).not.toContain('<img')
})

test('keeps user copy literal while tolerating an incomplete Assistant stream', () => {
  const markup = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="streaming-markdown"
      items={[
        {
          id: 'literal-user',
          createdAt: '2026-07-20T00:00:00.000Z',
          kind: 'user_message',
          role: 'user',
          text: '**Keep my syntax**',
        },
        {
          id: 'partial-assistant',
          createdAt: '2026-07-20T00:00:01.000Z',
          kind: 'assistant_message',
          role: 'assistant',
          text: '**Still streaming',
          pending: true,
        },
      ]}
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )

  expect(markup).toContain('**Keep my syntax**')
  expect(markup).not.toContain('<strong>Keep my syntax</strong>')
  expect(markup).toContain('**Still streaming')
  expect(markup).toContain('Streaming')
})

test('keeps user text and image attachments in the same message container', () => {
  const markup = renderToStaticMarkup(
    <UnifiedMessageFeed
      feedKey="user-image"
      items={[
        {
          id: 'user-image',
          createdAt: '2026-07-22T00:00:00.000Z',
          kind: 'user_message',
          role: 'user',
          text: '这个信号根本看不清',
          attachments: [
            {
              reference: '.hopi/docs/assistant/attachments/hash/chart.png',
              fileName: 'chart.png',
              url: '/api/assistant/attachments/hash/chart.png',
            },
          ],
        },
      ]}
      mode="inline"
      emptyState={<span>Empty</span>}
    />,
  )
  const message = markup.match(/<div class="unified-feed-message">([\s\S]*?)<\/div><\/article>/)?.[1]

  expect(message).toContain('unified-feed-message__bubble')
  expect(message).toContain('unified-feed-message__attachments')
  expect(message?.indexOf('unified-feed-message__bubble')).toBeLessThan(
    message?.indexOf('unified-feed-message__attachments') ?? -1,
  )
  expect(message).toContain('alt="chart.png"')
})

test('routes completion updates through the shared lazy Markdown surface', () => {
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
  expect(markup).toContain('assistant-message-markdown')
  expect(markup).toContain(`href="${artifactUrl}"`)
  expect(markup).toContain('assistant-message-link')
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
