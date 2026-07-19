import { expect, test } from 'bun:test'

const scrollSurfaceChecks = [
  {
    file: '../../pages/BoardView.tsx',
    patterns: [
      /<AppScrollShadow\s+className="kanban-scroll"/,
      /<AppScrollShadow className="kanban-cards"/,
      /<AppScrollShadow className="fact-grid work-fact-strip"/,
      /<AppScrollShadow className="work-contract-pane"/,
      /<AppScrollShadow className="attempt-list"/,
    ],
  },
  {
    file: '../AssistantPanel.tsx',
    patterns: [/className="composer-images"[\s\S]*?orientation="horizontal"/],
  },
  {
    file: '../ReflectionDebugPanel.tsx',
    patterns: [/Scroller: AppScrollShadow/],
  },
  {
    file: '../UnifiedMessageFeed.tsx',
    patterns: [/Scroller: AppScrollShadow/],
  },
  {
    file: '../../pages/GoalDocsPage.tsx',
    patterns: [
      /<AppScrollShadow className="docs-index"/,
      /<AppScrollShadow className="document-reader"/,
      /<AppScrollShadow className="evidence-panel"/,
    ],
  },
  {
    file: '../../pages/ProjectHomePage.tsx',
    patterns: [/<AppScrollShadow className="page-scroll"/],
  },
  {
    file: '../../pages/GoalCreatePage.tsx',
    patterns: [/<AppScrollShadow className="page-scroll"/],
  },
  {
    file: './SelectField.tsx',
    patterns: [/<AppScrollShadow className="app-select__scroll"/],
  },
]

test('every current application scroll list uses the shared ScrollShadow', async () => {
  const missing: string[] = []

  for (const check of scrollSurfaceChecks) {
    const source = await Bun.file(new URL(check.file, import.meta.url)).text()
    for (const pattern of check.patterns) {
      if (!pattern.test(source)) missing.push(`${check.file}: ${pattern.source}`)
    }
  }

  expect(missing).toEqual([])
})

test('the unified stream no longer carries its own overlay shadows', async () => {
  const component = await Bun.file(new URL('../UnifiedMessageFeed.tsx', import.meta.url)).text()
  const styles = await Bun.file(new URL('../../index.css', import.meta.url)).text()

  expect(component).not.toContain('unified-message-feed__top-shadow')
  expect(component).not.toContain('unified-message-feed__bottom-shadow')
  expect(styles).not.toContain('unified-message-feed__top-shadow')
  expect(styles).not.toContain('unified-message-feed__bottom-shadow')
})

test('the unified stream keeps its final row clear of the bottom scroll shadow', async () => {
  const component = await Bun.file(new URL('../UnifiedMessageFeed.tsx', import.meta.url)).text()
  const styles = await Bun.file(new URL('../../index.css', import.meta.url)).text()
  const clearanceRule =
    styles.match(/\.unified-message-feed__bottom-clearance\s*\{([^}]*)\}/)?.[1] ?? ''

  expect(component).toContain('Footer: FeedBottomClearance')
  expect(clearanceRule).toContain(
    'block-size: calc(var(--scroll-shadow-size, 22px) + 12px)',
  )
})
