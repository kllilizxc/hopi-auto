import { expect, test } from 'bun:test'

const styleFiles = [
  new URL('../index.css', import.meta.url),
  new URL('./theme.css', import.meta.url),
  new URL('./ui.css', import.meta.url),
  new URL('./app.css', import.meta.url),
]

test('application typography never declares a pixel size below 10px', async () => {
  const sources = await Promise.all(styleFiles.map((file) => Bun.file(file).text()))
  const declaredPixelSizes = sources.flatMap((source) =>
    [...source.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1])),
  )

  expect(declaredPixelSizes.filter((size) => size < 10)).toEqual([])
})

test('the application shell enforces the borderless surface system', async () => {
  const source = await Bun.file(new URL('../index.css', import.meta.url)).text()

  expect(source).toMatch(/body \*,[\s\S]*?border-width:\s*0\s*!important;/)
  expect(source).toContain('--shadow-xs')
  expect(source).toContain('var(--surface-raised)')
})

test('scrollbars share one minimal design and hide until interaction', async () => {
  const legacySource = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const themeSource = await Bun.file(new URL('./theme.css', import.meta.url)).text()
  const uiSource = await Bun.file(new URL('./ui.css', import.meta.url)).text()
  const defaultThumbRule = uiSource.match(/::-webkit-scrollbar-thumb\s*\{([^}]*)\}/)?.[1] ?? ''
  const interactiveThumbRule =
    uiSource.match(
      /:where\(\*:hover, \*:focus-within\)::-webkit-scrollbar-thumb\s*\{([^}]*)\}/,
    )?.[1] ?? ''

  expect(legacySource).not.toContain('::-webkit-scrollbar')
  expect(themeSource).toContain('--app-scrollbar-size: 6px')
  expect(themeSource).toContain('--scrollbar-color: transparent transparent')
  expect(uiSource).toContain('scrollbar-color: transparent transparent')
  expect(defaultThumbRule).toContain('background: transparent')
  expect(interactiveThumbRule).toContain('background: var(--app-scrollbar-thumb)')
  expect(uiSource).toContain('.scroll-shadow--hide-scrollbar::-webkit-scrollbar')
})

test('dense Kanban columns scroll without shrinking their Work cards', async () => {
  const source = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const workCardRules = [...source.matchAll(/\.work-card\s*\{([^}]*)\}/g)]
  const kanbanCardRules = [...source.matchAll(/\.kanban-cards\s*\{([^}]*)\}/g)]

  expect(workCardRules.some((rule) => rule[1]?.includes('flex: 0 0 auto'))).toBe(true)
  expect(kanbanCardRules.some((rule) => rule[1]?.includes('overflow-y: auto'))).toBe(true)
  expect(kanbanCardRules.some((rule) => rule[1]?.includes('scrollbar-gutter: stable'))).toBe(true)
})

test('Goal execution diagnostics style the nested Disclosure trigger', async () => {
  const source = await Bun.file(new URL('../index.css', import.meta.url)).text()

  expect(source).toContain(
    '.goal-execution-cost > .app-disclosure__heading > .app-disclosure__trigger',
  )
  expect(source).not.toContain('.goal-execution-cost > .app-disclosure__trigger')
})

test('Working states share one centered indicator implementation', async () => {
  const source = await Bun.file(new URL('./ui.css', import.meta.url)).text()
  const applicationSource = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const spinnerRule =
    source.match(/\.working-indicator__spinner\.app-spinner\s*\{([^}]*)\}/)?.[1] ?? ''
  const iconRule =
    source.match(/\.working-indicator__spinner\.app-spinner > svg\s*\{([^}]*)\}/)?.[1] ?? ''
  const runtimeSources = await Promise.all([
    Bun.file(new URL('../pages/BoardView.tsx', import.meta.url)).text(),
    Bun.file(new URL('../components/AssistantPanel.tsx', import.meta.url)).text(),
    Bun.file(new URL('../components/UnifiedMessageFeed.tsx', import.meta.url)).text(),
  ])
  const runtimeSource = runtimeSources.join('\n')

  expect(spinnerRule).toContain('width: var(--working-indicator-size)')
  expect(spinnerRule).toContain('height: var(--working-indicator-size)')
  expect(spinnerRule).toContain('align-items: center')
  expect(spinnerRule).toContain('justify-content: center')
  expect(spinnerRule).toContain('transform-origin: 50% 50%')
  expect(iconRule).toContain('width: 100%')
  expect(iconRule).toContain('height: 100%')
  expect(runtimeSource.match(/<WorkingIndicator\b/g)?.length ?? 0).toBeGreaterThan(0)
  expect(runtimeSource).not.toContain("=== 'running' && <AppSpinner")
  expect(runtimeSource).not.toContain("=== 'working' && <AppSpinner")
  expect(runtimeSource).not.toContain('<AppSpinner size="sm" /> Running')
  expect(runtimeSource).not.toContain('<AppSpinner size="sm" /> Streaming')
  expect(applicationSource).not.toContain('.working-indicator')
})

test('Work cards animate only the running title and current progress', async () => {
  const styles = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const ui = await Bun.file(new URL('./ui.css', import.meta.url)).text()
  const board = await Bun.file(new URL('../pages/BoardView.tsx', import.meta.url)).text()
  const workingRule = styles.match(/\.work-card\.work-card--working\s*\{([^}]*)\}/)?.[1] ?? ''
  const shinyTextRule = ui.match(/\.animated-shiny-text\s*\{([^}]*)\}/)?.[1] ?? ''
  const shinyTextFrames =
    ui.match(/@keyframes animated-shiny-text\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  const badgeRule = styles.match(/\.badge-working\s*\{([^}]*)\}/)?.[1] ?? ''
  const activeProgressRule = styles.match(/\.agent-plan__segment-progress\s*\{([^}]*)\}/)?.[1] ?? ''
  const completedProgressRule =
    styles.match(/\.agent-plan__segment\.is-complete\s*\{([^}]*)\}/)?.[1] ?? ''
  const completedMarkerRule =
    styles.match(/\.agent-plan__item\.is-complete \.agent-plan__marker\s*\{([^}]*)\}/)?.[1] ?? ''

  expect(board).toContain("const running = badge === 'working'")
  expect(board).toContain("running && 'work-card--working'")
  expect(board).toContain('<AnimatedShinyText')
  expect(board).toContain('shimmerWidth={140}')
  expect(board).toContain('agent-plan__segment-progress')
  expect(board).not.toContain('<WorkingIndicator label={badge}')
  expect(workingRule).not.toContain('animation:')
  expect(shinyTextRule).toContain('background-clip: text')
  expect(shinyTextRule).toContain('animation: animated-shiny-text')
  expect(shinyTextRule).toContain('linear infinite')
  expect(shinyTextFrames).toContain('from {')
  expect(shinyTextFrames).toContain('to {')
  expect(shinyTextFrames).not.toContain('30%')
  expect(shinyTextFrames).not.toContain('60%')
  expect(badgeRule).not.toContain('animation: running-glow')
  expect(styles).not.toContain('.work-card::before')
  expect(styles).not.toContain('.work-card.work-card--working::before')
  expect(styles).toContain('.agent-plan__segment-progress')
  expect(styles).toContain('inset: 0')
  expect(styles).toContain('animation: agent-plan-active-pulse')
  expect(ui).toContain('@keyframes animated-shiny-text')
  expect(ui).toMatch(
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.animated-shiny-text\s*\{[\s\S]*?animation:\s*none/,
  )
  expect(styles).toContain('opacity: 0.42')
  expect(activeProgressRule).toContain('box-shadow:')
  expect(completedProgressRule).toContain('--lane-accent')
  expect(completedProgressRule).not.toContain('--color-state-done')
  expect(completedMarkerRule).toContain('--lane-accent')
})

test('motion stays tokenized and avoids repeated paint-heavy transitions', async () => {
  const styles = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const theme = await Bun.file(new URL('./theme.css', import.meta.url)).text()
  const workCardRule = styles.match(/\.work-card\s*\{([^}]*)\}/)?.[1] ?? ''
  const finalWorkCardRule = [...styles.matchAll(/\.work-card\s*\{([^}]*)\}/g)].at(-1)?.[1] ?? ''

  expect(theme).toContain('--motion-fast')
  expect(theme).toContain('--motion-ease')
  expect(styles).not.toMatch(/transition:\s*\d+ms\s+ease/)
  expect(styles).not.toContain('running-glow')
  expect(workCardRule).toContain('content-visibility: auto')
  expect(finalWorkCardRule).toContain('contain: layout paint style')
  expect(finalWorkCardRule).toContain('transition: transform var(--motion-fast) var(--motion-ease)')
  expect(styles).toContain('contain-intrinsic-size: auto 112px')
  expect(styles).not.toContain('animation: card-in')
  expect(styles).not.toContain('@keyframes card-in')
  expect(styles).toMatch(/@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.work-card:hover/)
  expect(theme).toContain('--motion-ease-enter')
  expect(theme).toContain('--motion-status')
})

test('raw application colors live only in the theme contract', async () => {
  const applicationStyleFiles = styleFiles.filter((file) => !file.pathname.endsWith('/theme.css'))
  const sources = await Promise.all(applicationStyleFiles.map((file) => Bun.file(file).text()))
  const rawColorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/g
  const rawColors = sources.flatMap((source) => source.match(rawColorPattern) ?? [])
  const theme = await Bun.file(new URL('./theme.css', import.meta.url)).text()

  expect(rawColors).toEqual([])
  expect(theme).toContain('--color-bg-app')
  expect(theme).toContain('--color-text-primary')
  expect(theme).toContain('--color-working')
  expect(theme).toContain('--color-state-working')
  expect(theme).toContain('--color-state-live')
  expect(theme).toContain('--color-state-done')
  expect(theme).toContain('--color-phase-plan')
  expect(theme).toContain('--color-phase-build')
  expect(theme).toContain('--color-phase-review')
  expect(theme).toContain('--color-phase-done')
})

test('Assistant waiting uses a breathing dot instead of a rotating Spinner', async () => {
  const source = await Bun.file(new URL('./ui.css', import.meta.url)).text()
  const indicatorRule = source.match(/\.app-breathing-indicator::before\s*\{([^}]*)\}/)?.[1] ?? ''
  const breathingFrames = source.match(/@keyframes app-breathe\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''

  expect(indicatorRule).toContain('animation: app-breathe')
  expect(breathingFrames).toContain('opacity:')
  expect(breathingFrames).toContain('transform: scale')
  expect(breathingFrames).not.toContain('rotate')
})

test('Select values inherit control typography and stay vertically centered', async () => {
  const source = await Bun.file(new URL('./ui.css', import.meta.url)).text()
  const valueRule = source.match(/\.app-select__value\s*\{([^}]*)\}/)?.[1] ?? ''

  expect(valueRule).toContain('display: flex')
  expect(valueRule).toContain('height: 100%')
  expect(valueRule).toContain('align-items: center')
  expect(valueRule).toContain('font-size: inherit')
  expect(valueRule).toContain('line-height: inherit')
})

test('compact Goal workspaces keep the active surface full-height and open Assistant on demand', async () => {
  const styles = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const layout = await Bun.file(new URL('../components/Layout.tsx', import.meta.url)).text()

  expect(layout).toContain("const COMPACT_WORKSPACE_QUERY = '(max-width: 1280px)'")
  expect(layout).toContain('const shouldRenderAssistant = assistantDocked || assistantActivated')
  expect(layout).toContain('docked={assistantDocked}')
  expect(layout).toContain('isOpen={assistantDocked || assistantOpen}')
  expect(layout).toContain('className="workspace-assistant-button"')
  expect(styles).toMatch(
    /@media \(max-width: 1280px\)[\s\S]*?\.goal-workspace\s*\{[\s\S]*?height:\s*100dvh;/,
  )
  expect(styles).not.toContain('grid-template-rows: minmax(310px, 44vh)')
})

test('Assistant and Reflection use floating corner chrome while Kanban owns the full background', async () => {
  const styles = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const assistant = await Bun.file(
    new URL('../components/AssistantPanel.tsx', import.meta.url),
  ).text()
  const layout = await Bun.file(new URL('../components/Layout.tsx', import.meta.url)).text()
  const reflectionButtonRule = styles.match(/\.reflection-debug-button\s*\{([^}]*)\}/)?.[1] ?? ''
  const boardSurfaceRule =
    styles.match(
      /\.goal-workspace-surface--board > \.workspace-topbar,\s*\.goal-workspace-surface--board > \.workspace-main\s*\{([^}]*)\}/,
    )?.[1] ?? ''

  expect(assistant).toContain("'assistant-corner-chrome'")
  expect(assistant).not.toContain('assistant-header')
  expect(assistant).not.toContain('reflection-debug-toolbar')
  expect(assistant).not.toContain('Runtime reflections')
  expect(layout).not.toContain('className="assistant-header"')
  expect(layout).toContain("surface === 'board' && 'goal-workspace-surface--board'")
  expect(styles).toContain('-webkit-mask-image: radial-gradient')
  expect(reflectionButtonRule).toContain('opacity: 0')
  expect(boardSurfaceRule).toContain('background: transparent')
})

test('stream virtualization is the only authority for variable row height', async () => {
  const styles = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const assistant = await Bun.file(
    new URL('../components/AssistantPanel.tsx', import.meta.url),
  ).text()
  const reflection = await Bun.file(
    new URL('../components/ReflectionDebugPanel.tsx', import.meta.url),
  ).text()
  const feed = await Bun.file(new URL('../components/UnifiedMessageFeed.tsx', import.meta.url)).text()
  const runRowRule = styles.match(/\.reflection-run-row\s*\{([^}]*)\}/)?.[1] ?? ''
  const messageRowRule =
    styles.match(
      /\.unified-feed-message-row,\s*\.unified-feed-action-row,\s*\.unified-feed-activity,\s*\.unified-feed-live-activity\s*\{([^}]*)\}/,
    )?.[1] ?? ''

  expect(assistant).toContain("import('./ReflectionDebugPanel')")
  expect(reflection).toContain('className="reflection-run-virtuoso"')
  expect(feed).toContain('<Virtuoso')
  expect(runRowRule).not.toContain('content-visibility')
  expect(runRowRule).not.toContain('contain-intrinsic-size')
  expect(messageRowRule).not.toContain('content-visibility')
  expect(messageRowRule).not.toContain('contain-intrinsic-size')
})

test('a docked Assistant remains structural without stacked boundary effects', async () => {
  const styles = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const dockedRules = [...styles.matchAll(/\.assistant-drawer\.docked\s*\{([^}]*)\}/g)]
  const workspaceRules = [...styles.matchAll(/\.workspace-main\s*\{([^}]*)\}/g)]

  expect(dockedRules).toHaveLength(1)
  expect(dockedRules[0]?.[1]).toContain('border: 0')
  expect(dockedRules[0]?.[1]).toContain('box-shadow: none')
  expect(workspaceRules.every((match) => !match[1]?.includes('box-shadow'))).toBe(true)
})

test('Assistant Attention chrome stays quiet, aligned, and free of duplicate icon labels', async () => {
  const styles = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const assistant = await Bun.file(
    new URL('../components/AssistantPanel.tsx', import.meta.url),
  ).text()
  const needsYouRule =
    styles.match(
      /\.unified-feed-message-row\.assistant\.needs-you \.unified-feed-message\s*\{([^}]*)\}/,
    )?.[1] ?? ''
  const cornerRule = styles.match(/\.assistant-corner-chrome\s*\{([^}]*)\}/)?.[1] ?? ''

  expect(needsYouRule).toContain('border: 1px solid')
  expect(needsYouRule).not.toContain('inset 3px 0')
  expect(cornerRule).toContain('align-items: center')
  expect(cornerRule).toContain('justify-content: flex-end')
  expect(cornerRule).toContain('min-height: 54px')
  expect(cornerRule).not.toContain('min-height: 72px')
  expect(assistant.indexOf('className={cn(\'reflection-debug-button\'')).toBeLessThan(
    assistant.indexOf('className="assistant-needs-you-count"'),
  )
  expect(assistant).toContain('className="composer-context__dismiss"')
  expect(assistant).toContain('Replying to')
  expect(assistant).not.toContain('Responding to')
})

test('user text and image attachments stay in one right-aligned vertical message stack', async () => {
  const styles = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const userMessageRule =
    styles.match(
      /\.unified-feed-message-row\.user \.unified-feed-message\s*\{([^}]*)\}/,
    )?.[1] ?? ''
  const attachmentRule =
    styles.match(/\.unified-feed-message__attachments\s*\{([^}]*)\}/)?.[1] ?? ''
  const attachmentLinkRule =
    styles.match(/\.unified-feed-message__attachments a\s*\{([^}]*)\}/)?.[1] ?? ''

  expect(userMessageRule).toContain('display: flex')
  expect(userMessageRule).toContain('flex-direction: column')
  expect(userMessageRule).toContain('align-items: flex-end')
  expect(userMessageRule).not.toContain('justify-content: flex-end')
  expect(attachmentRule).toContain('display: flex')
  expect(attachmentRule).toContain('flex-wrap: wrap')
  expect(attachmentRule).toContain('justify-content: end')
  expect(attachmentRule).not.toContain('grid-template-columns')
  expect(attachmentLinkRule).toContain('flex: 0 1 150px')
})

test('Project and title-level Goal navigation reuse one peer switcher', async () => {
  const styles = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const layout = await Bun.file(new URL('../components/Layout.tsx', import.meta.url)).text()
  const switcher = await Bun.file(new URL('../components/PeerSwitcher.tsx', import.meta.url)).text()
  const board = await Bun.file(new URL('../pages/BoardView.tsx', import.meta.url)).text()
  const docs = await Bun.file(new URL('../pages/GoalDocsPage.tsx', import.meta.url)).text()
  const tabs = await Bun.file(new URL('../components/ui/Tabs.tsx', import.meta.url)).text()

  expect(layout).toContain('<PeerSwitcher')
  expect(layout).not.toContain('aria-label="Current Goal"')
  expect(switcher).toContain('<AppTabs')
  expect(switcher).toContain('<SelectField')
  expect(switcher).toContain("variant === 'compact' && 'project-switcher__tabs'")
  expect(switcher).toContain("variant === 'headline'")
  expect(switcher).toContain('...items.filter((item) => item.id === selectedKey)')
  expect(board).toContain('variant="headline"')
  expect(docs).toContain('variant="headline"')
  expect(layout).toContain('className="workspace-tabs"')
  expect(layout).not.toContain('<AppTabs.Indicator')
  expect(board).toContain('<AppTabs.List className="work-detail-tabs"')
  expect(board).not.toContain('<AppTabs.ListContainer')
  expect(tabs).toContain('<HeroTabs.Indicator className="app-tabs__indicator" />')
  expect(switcher).toContain("variant === 'compact' && 'project-switcher__more'")
  expect(switcher).toContain('if (window.matchMedia(SINGLE_SHORTCUT_QUERY).matches) return 1')
  expect(switcher).toContain('if (window.matchMedia(NARROW_SHORTCUT_QUERY).matches) return 2')
  expect(layout).toContain('const [recentProjects] = useState(readRecentProjects)')
  expect(layout).not.toContain('setRecentProjects(')
  expect(styles).toContain('.project-switcher__tabs.tabs')
  expect(styles).toContain('.peer-switcher--headline .app-tabs__list.tabs__list')
  expect(styles).toMatch(
    /\.peer-switcher--headline \.peer-switcher__tabs\.tabs\s*\{[^}]*width:\s*fit-content;[^}]*max-width:\s*calc\(100% - 36px\);[^}]*flex:\s*0 1 auto;/,
  )
  expect(styles).toMatch(
    /\.peer-switcher--headline \.app-tabs__list\.tabs__list\s*\{[^}]*width:\s*fit-content;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/,
  )
  expect(styles).toMatch(
    /\.peer-switcher--headline \.peer-switcher__tab\.tabs__tab\[data-selected="true"\]\s*\{[^}]*font-size:\s*clamp\(22px, 2\.4vw, 30px\);/,
  )
  expect(styles).toMatch(/\.peer-switcher--headline \.app-tabs__indicator\s*\{\s*display:\s*none;/)
  expect(styles).toMatch(
    /\.peer-switcher--headline \.peer-switcher__more \.app-select__indicator\s*\{[^}]*position:\s*relative;[^}]*top:\s*8px;[^}]*transform:\s*none;/,
  )
  expect(styles).toContain('.app-tabs__list.tabs__list')
  expect(styles).toContain('.app-tabs__indicator.tabs__indicator')
  expect(styles).toContain('.app-tabs__tab.tabs__tab[data-pressed="true"]')
  expect(styles).toMatch(/\.work-detail-tabs-root > \*\s*\{[^}]*min-width:\s*0;/)
  expect(styles).not.toContain('.project-switcher__indicator')
  expect(styles).not.toContain('.attempt-tabs')
  expect(styles).toMatch(/\.project-switcher__more \.app-select__value\s*\{\s*display:\s*none;/)
  expect(styles).toContain('.project-switcher__more .app-select__indicator')
})

test('compact Kanban and Docs preserve every lane and evidence surface', async () => {
  const source = await Bun.file(new URL('../index.css', import.meta.url)).text()

  expect(source).toContain('scroll-snap-type: x mandatory')
  expect(source).toContain('grid-template-columns: repeat(4, var(--compact-lane-width))')
  expect(source).toContain('scroll-snap-stop: always')
  expect(source).toMatch(
    /@media \(max-width: 900px\)[\s\S]*?\.evidence-panel\s*\{[\s\S]*?display:\s*block;/,
  )
})

test('Assistant Markdown links stay blue in ordinary and Completed messages', async () => {
  const styles = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const renderer = await Bun.file(new URL('../components/AssistantMarkdown.tsx', import.meta.url)).text()
  const linkRule = styles.match(/\.assistant-message-link\.app-link\s*\{([^}]*)\}/)?.[1] ?? ''

  expect(renderer).toContain('className="assistant-message-link"')
  expect(linkRule).toContain('color: var(--color-info-400)')
  expect(linkRule).toContain('text-decoration: underline')
  expect(styles).not.toContain('.unified-feed-message__text .app-link')
})

test('phone form controls avoid viewport zoom and honor display safe areas', async () => {
  const source = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const html = await Bun.file(new URL('../../index.html', import.meta.url)).text()

  expect(html).toContain('viewport-fit=cover')
  expect(source).toMatch(
    /@media \(max-width: 660px\)[\s\S]*?body :is\(input, textarea\)\s*\{[\s\S]*?font-size:\s*16px;/,
  )
  expect(source).toContain('env(safe-area-inset-bottom)')
})

test('phone startup uses one non-blocking bottom-corner loading notice', async () => {
  const source = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const noticeRule = source.match(/\.app-loading-notice\s*\{([^}]*)\}/)?.[1] ?? ''

  expect(noticeRule).toContain('pointer-events: none')
  expect(source).toMatch(
    /@media \(max-width: 660px\)[\s\S]*?\.app-loading-notice\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?bottom:\s*max\(12px, env\(safe-area-inset-bottom\)\);/,
  )
})
