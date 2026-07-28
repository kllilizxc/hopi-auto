import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PeerSwitcher, peerSwitcherOverflowLabel } from './PeerSwitcher'

test('renders an accessible bounded count on a Project shortcut', () => {
  const markup = renderToStaticMarkup(
    <PeerSwitcher
      ariaLabel="Recent Projects"
      items={[
        {
          id: 'P-1',
          label: 'Finance',
          badge: { count: 120, label: '120 requests need your reply' },
        },
      ]}
      label="Project"
      moreAriaLabel="More Projects"
      onSelectionChange={() => undefined}
      selectedKey="P-1"
    />,
  )

  expect(markup).toContain('peer-switcher__badge')
  expect(markup).toContain('aria-label="120 requests need your reply"')
  expect(markup).toContain('99+')
})

test('keeps a NeedsYou count discoverable when its Project moves to overflow', () => {
  expect(
    peerSwitcherOverflowLabel({
      id: 'P-1',
      label: 'Finance',
      badge: { count: 2, label: '2 requests need your reply' },
    }),
  ).toBe('Finance · 2 requests need your reply')
  expect(peerSwitcherOverflowLabel({ id: 'P-2', label: 'Store' })).toBe('Store')
})

test('renders completion beside NeedsYou and keeps both discoverable in overflow', () => {
  const item = {
    id: 'P-1',
    label: 'Finance',
    badge: { count: 2, label: '2 requests need your reply' },
    completion: { label: '1 new Goal completed' },
  }
  const markup = renderToStaticMarkup(
    <PeerSwitcher
      ariaLabel="Recent Projects"
      items={[item]}
      label="Project"
      moreAriaLabel="More Projects"
      onSelectionChange={() => undefined}
      selectedKey="P-1"
    />,
  )

  expect(markup).toContain('peer-switcher__completion-marker')
  expect(markup).toContain('aria-label="1 new Goal completed"')
  expect(markup).toContain('aria-label="2 requests need your reply"')
  expect(peerSwitcherOverflowLabel(item)).toBe(
    'Finance · 2 requests need your reply · 1 new Goal completed',
  )
})
