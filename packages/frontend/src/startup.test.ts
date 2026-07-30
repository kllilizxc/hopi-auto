import { expect, test } from 'bun:test'

test('cold loads show a pre-React surface before the application script', async () => {
  const html = await Bun.file(new URL('../index.html', import.meta.url)).text()
  const productHtml = await Bun.file(
    new URL('../../backend/src/product.html', import.meta.url),
  ).text()
  const bootPosition = html.indexOf('class="app-boot"')
  const scriptPosition = html.indexOf('src="./src/main.tsx"')

  expect(bootPosition).toBeGreaterThan(0)
  expect(scriptPosition).toBeGreaterThan(bootPosition)
  expect(html).toContain('role="status"')
  expect(html).toContain('Opening workspace')
  expect(html).toMatch(/@media \(max-width: 660px\)[\s\S]*?\.app-boot__content\s*\{[\s\S]*?position: fixed;/)
  expect(html).toContain('bottom: max(12px, env(safe-area-inset-bottom))')
  expect(readBootStyle(productHtml)).toBe(readBootStyle(html))
  expect(productHtml).toContain('class="app-boot"')
  expect(productHtml).toContain('Loading the interface for this device…')
})

test('product surfaces and compact Assistant load behind explicit boundaries', async () => {
  const app = await Bun.file(new URL('./App.tsx', import.meta.url)).text()
  const layout = await Bun.file(new URL('./components/Layout.tsx', import.meta.url)).text()
  const assistant = await Bun.file(
    new URL('./components/AssistantPanel.tsx', import.meta.url),
  ).text()
  const build = await Bun.file(new URL('../build.ts', import.meta.url)).text()

  for (const page of ['BoardView', 'GoalDocsPage', 'ProjectHomePage']) {
    expect(app).toContain(`const ${page} = lazy(`)
    expect(app).not.toContain(`import { ${page} }`)
  }
  expect(app).not.toContain('GoalCreatePage')
  expect(app).toContain('<Route path="projects/:projectId" element={null} />')
  expect(app).toContain('<Suspense fallback={<RouteLoading />}>')
  expect(app).toContain('<AppLoadingNotice')
  expect(layout).toContain("const AssistantPanel = lazy(() =>")
  expect(layout).not.toContain("import { AssistantPanel } from './AssistantPanel'")
  expect(layout).toContain(
    'const shouldRenderAssistant = projectOnlyRoute || assistantDocked || assistantActivated',
  )
  expect(layout).toContain('setAssistantActivated(true)')
  expect(assistant).toContain("const WakeDebugPanel = lazy(() =>")
  expect(assistant).toContain("import('./WakeDebugPanel')")
  expect(build).toContain('splitting: true')
})

test('route preloads follow user intent instead of competing with startup', async () => {
  const routeModules = await Bun.file(new URL('./routeModules.ts', import.meta.url)).text()
  const layout = await Bun.file(new URL('./components/Layout.tsx', import.meta.url)).text()
  const projectHome = await Bun.file(new URL('./pages/ProjectHomePage.tsx', import.meta.url)).text()
  const startupSources = `${routeModules}\n${layout}\n${projectHome}`

  for (const route of [
    'BoardView',
    'GoalDocsPage',
    'ProjectHomePage',
    'AssistantPanel',
  ]) {
    expect(routeModules).toContain(`export const load${route} = () => import(`)
    expect(routeModules).toContain(`export const preload${route} = () => void load${route}()`)
  }
  expect(layout).toContain("onPointerEnter={() => warmGoalSurface(routeScope, 'board')}")
  expect(layout).toContain("onFocus={() => warmGoalSurface(routeScope, 'docs')}")
  expect(layout).toContain('onPointerDown={preloadAssistantPanel}')
  expect(projectHome).toContain('onPointerEnter={preloadBoardView}')
  expect(projectHome).toContain('onFocus={preloadAssistantPanel}')
  expect(startupSources).not.toContain('requestIdleCallback')
})

test('Goal navigation commits the route before warming its exact projection', async () => {
  const layout = await Bun.file(new URL('./components/Layout.tsx', import.meta.url)).text()
  const navigation = layout.slice(
    layout.indexOf('const navigateToGoalSurface = useCallback('),
    layout.indexOf('const goalForProject = useCallback('),
  )

  expect(layout).toContain('const prepareGoalSurface = useCallback(')
  expect(layout).toContain('queryClient.prefetchQuery({')
  expect(layout).toContain('await Promise.all([loadSurface, prefetch])')
  expect(navigation.indexOf('navigate(buildGoalRoute(scope, nextSurface))')).toBeGreaterThan(0)
  expect(navigation.indexOf('warmGoalSurface(scope, nextSurface)')).toBeGreaterThan(
    navigation.indexOf('navigate(buildGoalRoute(scope, nextSurface))'),
  )
  expect(layout).not.toContain('goalNavigationRequest')
  expect(layout).toContain('navigateToGoalSurface(routeScope, nextSurface)')
})

test('an empty Project centers the same Assistant that later docks beside its first Goal', async () => {
  const app = await Bun.file(new URL('./App.tsx', import.meta.url)).text()
  const layout = await Bun.file(new URL('./components/Layout.tsx', import.meta.url)).text()
  const styles = await Bun.file(new URL('./index.css', import.meta.url)).text()

  expect(app).toContain('<Route path="projects/:projectId" element={null} />')
  expect(app).toContain('path="projects/:projectId/goals/new"')
  expect(app).toContain('<Navigate to="../.." relative="path" replace />')
  expect(layout).toContain('const projectOnlyRoute = Boolean(assistantScope && !routeScope)')
  expect(layout).toContain("projectOnlyRoute && 'goal-workspace--project-only'")
  expect(layout).toContain('docked={assistantDockedForRoute}')
  expect(layout).toContain('scope={assistantScope}')
  expect(layout).toContain(
    'refetchInterval: projectOnlyRoute ? CANONICAL_POLL_INTERVAL_MS : shellPollInterval',
  )
  expect(layout).toContain('if (projectRouteGoalId) {')
  expect(layout).toContain(
    'navigateToGoalSurface({ projectId: routeProjectId, goalId: projectRouteGoalId }, surface)',
  )
  expect(styles).toContain('.goal-workspace--project-only > .assistant-drawer.docked')
  expect(styles).toContain('justify-self: center')
  expect(styles).toContain('grid-template-columns: clamp(410px, 27vw, 480px) minmax(0, 1fr)')
})

function readBootStyle(html: string) {
  return html.match(/<style data-hopi-boot>([\s\S]*?)<\/style>/)?.[1]?.trim()
}
