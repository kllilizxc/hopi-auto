import { expect, test } from 'bun:test'

const styleFiles = [
  new URL('../index.css', import.meta.url),
  new URL('./theme.css', import.meta.url),
  new URL('./ui.css', import.meta.url),
  new URL('./app.css', import.meta.url),
  new URL('./route.css', import.meta.url),
]

async function read(file: URL) {
  return Bun.file(file).text()
}

test('application typography never declares a pixel size below 10px', async () => {
  const sources = await Promise.all(styleFiles.map(read))
  const sizes = sources.flatMap((source) =>
    [...source.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1])),
  )

  expect(sizes.filter((size) => size < 10)).toEqual([])
})

test('raw application colors live only in the theme contract', async () => {
  const sources = await Promise.all(
    styleFiles.filter((file) => !file.pathname.endsWith('/theme.css')).map(read),
  )
  const rawColorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/g
  const theme = await read(new URL('./theme.css', import.meta.url))

  expect(sources.flatMap((source) => source.match(rawColorPattern) ?? [])).toEqual([])
  expect(theme).toContain('--color-bg-app')
  expect(theme).toContain('--color-text-primary')
  expect(theme).toContain('--color-state-done')
})

test('Route is a scrollable derived graph with explicit node states and fog', async () => {
  const route = await read(new URL('./route.css', import.meta.url))
  const view = await read(new URL('../pages/RouteView.tsx', import.meta.url))
  const layout = await read(new URL('../pages/route/routeLayout.ts', import.meta.url))

  expect(route).toMatch(/\.route-viewport\s*\{[^}]*overflow:\s*auto;/)
  expect(route).toContain('.route-node.state-running')
  expect(route).toContain('.route-node.state-ready')
  expect(route).toContain('.route-node.state-needs_user')
  expect(route).toContain('.route-fog')
  expect(view).toContain('layoutGoalRoute(goalQuery.data.route)')
  expect(view).toContain('layout is derived, never stored')
  expect(layout).toContain('work.dependsOn')
  expect(layout).toContain("id: 'destination'")
})

test('scrollbars share one minimal design and hide until interaction', async () => {
  const theme = await read(new URL('./theme.css', import.meta.url))
  const ui = await read(new URL('./ui.css', import.meta.url))
  const defaultThumb = ui.match(/::-webkit-scrollbar-thumb\s*\{([^}]*)\}/)?.[1] ?? ''
  const interactiveThumb =
    ui.match(/:where\(\*:hover, \*:focus-within\)::-webkit-scrollbar-thumb\s*\{([^}]*)\}/)?.[1] ?? ''

  expect(theme).toContain('--app-scrollbar-size: 6px')
  expect(ui).toContain('scrollbar-color: transparent transparent')
  expect(defaultThumb).toContain('background: transparent')
  expect(interactiveThumb).toContain('background: var(--app-scrollbar-thumb)')
})

test('working and waiting indicators keep separate visual semantics', async () => {
  const ui = await read(new URL('./ui.css', import.meta.url))
  const spinner = ui.match(/\.working-indicator__spinner\.app-spinner\s*\{([^}]*)\}/)?.[1] ?? ''
  const breathing = ui.match(/\.app-breathing-indicator::before\s*\{([^}]*)\}/)?.[1] ?? ''

  expect(spinner).toContain('width: var(--working-indicator-size)')
  expect(spinner).toContain('height: var(--working-indicator-size)')
  expect(breathing).toContain('animation: app-breathe')
  expect(ui).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation:\s*none/)
})

test('compact Goal workspaces keep the active surface full-height and open Assistant on demand', async () => {
  const styles = await read(new URL('../index.css', import.meta.url))
  const layout = await read(new URL('../components/Layout.tsx', import.meta.url))

  expect(layout).toContain("const COMPACT_WORKSPACE_QUERY = '(max-width: 1280px)'")
  expect(layout).toContain(
    'const shouldRenderAssistant = projectOnlyRoute || assistantDocked || assistantActivated',
  )
  expect(layout).toContain('className="workspace-assistant-button"')
  expect(styles).toMatch(
    /@media \(max-width: 1280px\)[\s\S]*?\.goal-workspace\s*\{[\s\S]*?height:\s*100dvh;/,
  )
})

test('stream virtualization owns variable message and Run row height', async () => {
  const styles = await read(new URL('../index.css', import.meta.url))
  const feed = await read(new URL('../components/UnifiedMessageFeed.tsx', import.meta.url))
  const wake = await read(new URL('../components/WakeDebugPanel.tsx', import.meta.url))
  const runRow = styles.match(/\.wake-run-row\s*\{([^}]*)\}/)?.[1] ?? ''

  expect(feed).toContain('<Virtuoso')
  expect(wake).toContain('className="wake-run-virtuoso"')
  expect(runRow).not.toContain('content-visibility')
  expect(runRow).not.toContain('contain-intrinsic-size')
})

test('phone controls avoid viewport zoom and honor display safe areas', async () => {
  const styles = await read(new URL('../index.css', import.meta.url))
  const html = await read(new URL('../../index.html', import.meta.url))

  expect(html).toContain('viewport-fit=cover')
  expect(styles).toMatch(
    /@media \(max-width: 660px\)[\s\S]*?body :is\(input, textarea\)\s*\{[\s\S]*?font-size:\s*16px;/,
  )
  expect(styles).toContain('env(safe-area-inset-bottom)')
})
