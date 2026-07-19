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
  const build = await Bun.file(new URL('../build.ts', import.meta.url)).text()

  for (const page of ['BoardView', 'GoalDocsPage', 'GoalCreatePage', 'ProjectHomePage']) {
    expect(app).toContain(`const ${page} = lazy(`)
    expect(app).not.toContain(`import { ${page} }`)
  }
  expect(app).toContain('<Suspense fallback={<RouteLoading />}>')
  expect(app).toContain('<AppLoadingNotice')
  expect(layout).toContain("const AssistantPanel = lazy(() =>")
  expect(layout).not.toContain("import { AssistantPanel } from './AssistantPanel'")
  expect(layout).toContain('const shouldRenderAssistant = assistantDocked || assistantActivated')
  expect(layout).toContain('setAssistantActivated(true)')
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
    'GoalCreatePage',
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
  expect(projectHome).toContain('onFocus={preloadGoalCreatePage}')
  expect(startupSources).not.toContain('requestIdleCallback')
})

test('routine Goal navigation warms data without replacing the current surface', async () => {
  const layout = await Bun.file(new URL('./components/Layout.tsx', import.meta.url)).text()

  expect(layout).toContain('const prepareGoalSurface = useCallback(')
  expect(layout).toContain('const cached = queryClient.getQueryData(queryKey) !== undefined')
  expect(layout).toContain('queryClient.prefetchQuery({')
  expect(layout).toContain('await Promise.all([loadSurface, prefetch])')
  expect(layout).toContain('const request = ++goalNavigationRequest.current')
  expect(layout).toContain('if (request === goalNavigationRequest.current)')
  expect(layout).toContain('navigateToGoalSurface(routeScope, nextSurface)')
})

function readBootStyle(html: string) {
  return html.match(/<style data-hopi-boot>([\s\S]*?)<\/style>/)?.[1]?.trim()
}
