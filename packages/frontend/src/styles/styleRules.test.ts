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
    uiSource.match(/:where\(\*:hover, \*:focus-within\)::-webkit-scrollbar-thumb\s*\{([^}]*)\}/)?.[1] ?? ''

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

test('Working states share one centered indicator implementation', async () => {
  const source = await Bun.file(new URL('./ui.css', import.meta.url)).text()
  const applicationSource = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const spinnerRule = source.match(/\.working-indicator__spinner\.app-spinner\s*\{([^}]*)\}/)?.[1] ?? ''
  const iconRule = source.match(/\.working-indicator__spinner\.app-spinner > svg\s*\{([^}]*)\}/)?.[1] ?? ''
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

test('Work cards keep running emphasis off the whole surface', async () => {
  const styles = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const board = await Bun.file(new URL('../pages/BoardView.tsx', import.meta.url)).text()
  const workingRule =
    styles.match(/\.work-card\.work-card--working\s*\{([^}]*)\}/)?.[1] ?? ''
  const badgeRule = styles.match(/\.badge-working\s*\{([^}]*)\}/)?.[1] ?? ''

  expect(board).toContain("badge === 'working' && 'work-card--working'")
  expect(board).toContain('<WorkingIndicator label={badge} />')
  expect(workingRule).not.toContain('animation:')
  expect(badgeRule).not.toContain('animation: running-glow')
  expect(styles).toContain('.work-card.work-card--working::before')
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
  expect(styles).toMatch(/@media \(max-width: 1280px\)[\s\S]*?\.goal-workspace\s*\{[\s\S]*?height:\s*100dvh;/)
  expect(styles).not.toContain('grid-template-rows: minmax(310px, 44vh)')
})

test('Project navigation exposes responsive recent shortcuts with one overflow Select', async () => {
  const styles = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const layout = await Bun.file(new URL('../components/Layout.tsx', import.meta.url)).text()

  expect(layout).toContain('selectProjectShortcuts(')
  expect(layout).toContain("'project-switcher__tabs'")
  expect(layout).toContain('<AppTabs.Indicator className="project-switcher__indicator" />')
  expect(layout).toContain('className="project-switcher__more"')
  expect(layout).toContain('placeholder={`More ${overflowProjects.length}`}')
  expect(layout).toContain("if (window.matchMedia(SINGLE_PROJECT_SHORTCUT_QUERY).matches) return 1")
  expect(layout).toContain("if (window.matchMedia(NARROW_PROJECT_SHORTCUT_QUERY).matches) return 2")
  expect(layout).toContain('const [recentProjects] = useState(readRecentProjects)')
  expect(layout).not.toContain('setRecentProjects(')
  expect(styles).toContain('.project-switcher__tabs.tabs')
  expect(styles).toContain('.project-switcher__indicator.tabs__indicator')
  expect(styles).toContain('.project-switcher__tab.tabs__tab[data-pressed="true"]')
  expect(styles).toContain('.project-switcher__more .app-select__value')
})

test('compact Kanban and Docs preserve every lane and evidence surface', async () => {
  const source = await Bun.file(new URL('../index.css', import.meta.url)).text()

  expect(source).toContain('scroll-snap-type: x mandatory')
  expect(source).toContain('grid-template-columns: repeat(4, var(--compact-lane-width))')
  expect(source).toContain('scroll-snap-stop: always')
  expect(source).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.evidence-panel\s*\{[\s\S]*?display:\s*block;/)
})

test('phone form controls avoid viewport zoom and honor display safe areas', async () => {
  const source = await Bun.file(new URL('../index.css', import.meta.url)).text()
  const html = await Bun.file(new URL('../../index.html', import.meta.url)).text()

  expect(html).toContain('viewport-fit=cover')
  expect(source).toMatch(/@media \(max-width: 660px\)[\s\S]*?body :is\(input, textarea\)\s*\{[\s\S]*?font-size:\s*16px;/)
  expect(source).toContain('env(safe-area-inset-bottom)')
})
