import { expect, test } from 'bun:test'

test('cold loads show a pre-React surface before the application script', async () => {
  const html = await Bun.file(new URL('../index.html', import.meta.url)).text()
  const productHtml = await Bun.file(new URL('../../backend/src/product.html', import.meta.url)).text()
  const bootPosition = html.indexOf('class="app-boot"')
  const scriptPosition = html.indexOf('src="./src/main.tsx"')

  expect(bootPosition).toBeGreaterThan(0)
  expect(scriptPosition).toBeGreaterThan(bootPosition)
  expect(readBootStyle(productHtml)).toBe(readBootStyle(html))
})

test('Route, Docs, Projects, and Assistant load behind explicit boundaries', async () => {
  const app = await Bun.file(new URL('./App.tsx', import.meta.url)).text()
  const modules = await Bun.file(new URL('./routeModules.ts', import.meta.url)).text()
  const layout = await Bun.file(new URL('./components/Layout.tsx', import.meta.url)).text()

  for (const surface of ['RouteView', 'GoalDocsPage', 'ProjectHomePage']) {
    expect(app).toContain(`const ${surface} = lazy(`)
    expect(app).not.toContain(`import { ${surface} }`)
    expect(modules).toContain(`export const load${surface} = () => import(`)
  }
  expect(layout).toContain('const AssistantPanel = lazy(() =>')
  expect(app).toContain('<Suspense fallback={<RouteLoading />}>')
})

test('Route preload follows user intent and never competes with startup', async () => {
  const modules = await Bun.file(new URL('./routeModules.ts', import.meta.url)).text()
  const layout = await Bun.file(new URL('./components/Layout.tsx', import.meta.url)).text()
  const home = await Bun.file(new URL('./pages/ProjectHomePage.tsx', import.meta.url)).text()

  expect(modules).toContain('export const preloadRouteView = () => void loadRouteView()')
  expect(layout).toContain("onPointerEnter={() => warmGoalSurface(routeScope, 'route')}")
  expect(home).toContain('onPointerEnter={preloadRouteView}')
  expect(`${modules}\n${layout}\n${home}`).not.toContain('requestIdleCallback')
})

test('Goal navigation commits the route before warming its exact projection', async () => {
  const layout = await Bun.file(new URL('./components/Layout.tsx', import.meta.url)).text()
  const navigation = layout.slice(
    layout.indexOf('const navigateToGoalSurface = useCallback('),
    layout.indexOf('const goalForProject = useCallback('),
  )

  expect(navigation.indexOf('navigate(buildGoalRoute(scope, nextSurface))')).toBeGreaterThan(0)
  expect(navigation.indexOf('warmGoalSurface(scope, nextSurface)')).toBeGreaterThan(
    navigation.indexOf('navigate(buildGoalRoute(scope, nextSurface))'),
  )
  expect(layout).toContain('queryFn: () => readGoalRoute(scope.projectId, scope.goalId)')
})

function readBootStyle(html: string) {
  return html.match(/<style data-hopi-boot>([\s\S]*?)<\/style>/)?.[1]?.trim()
}
