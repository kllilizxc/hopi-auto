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
  expect(layout).toContain("const AssistantPanel = lazy(() =>")
  expect(layout).not.toContain("import { AssistantPanel } from './AssistantPanel'")
  expect(layout).toContain('const shouldRenderAssistant = assistantDocked || assistantActivated')
  expect(layout).toContain('setAssistantActivated(true)')
  expect(build).toContain('splitting: true')
})

function readBootStyle(html: string) {
  return html.match(/<style data-hopi-boot>([\s\S]*?)<\/style>/)?.[1]?.trim()
}
