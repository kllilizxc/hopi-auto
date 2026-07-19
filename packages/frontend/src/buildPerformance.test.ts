import { expect, test } from 'bun:test'

test('production builds gate persistent and lazy delivery budgets', async () => {
  const source = await Bun.file(new URL('../build.ts', import.meta.url)).text()

  expect(source).toContain('INITIAL_JS_BUDGET_BYTES = 800 * 1024')
  expect(source).toContain('INITIAL_CSS_BUDGET_BYTES = 320 * 1024')
  expect(source).toContain('ROUTE_JS_BUDGET_BYTES = 96 * 1024')
  expect(source).toContain("item.kind === 'dynamic-import'")
  expect(source).toContain("item.kind === 'import-statement'")
  expect(source).toContain("new URL('./dist/performance-budget.json', import.meta.url)")
  expect(source).toContain("enforceBudget('Initial JavaScript'")
  expect(source).toContain("enforceBudget('Initial CSS'")
})
