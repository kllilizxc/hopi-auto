import tailwind from 'bun-plugin-tailwind'
import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const INITIAL_JS_BUDGET_BYTES = 800 * 1024
const INITIAL_CSS_BUDGET_BYTES = 320 * 1024
const ROUTE_JS_BUDGET_BYTES = 96 * 1024

await rm(new URL('./dist', import.meta.url), { force: true, recursive: true })

const result = await Bun.build({
  entrypoints: ['./index.html'],
  outdir: './dist',
  target: 'browser',
  minify: true,
  splitting: true,
  plugins: [tailwind],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const htmlOutput = result.outputs.find(
  (output) => output.loader === 'html' && output.path.endsWith('index.html'),
)
if (!htmlOutput) throw new Error('Frontend build did not emit index.html')

const outputs = new Map(result.outputs.map((output) => [resolve(output.path), output]))
const html = await Bun.file(htmlOutput.path).text()
const htmlDirectory = dirname(htmlOutput.path)
const initialScripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((match) =>
  resolve(htmlDirectory, match[1] ?? ''),
)
const initialStyles = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((match) =>
  resolve(htmlDirectory, match[1] ?? ''),
)
const transpiler = new Bun.Transpiler({ loader: 'js' })
const importCache = new Map<string, ReturnType<typeof transpiler.scanImports>>()

async function importsFor(path: string) {
  const cached = importCache.get(path)
  if (cached) return cached
  const imports = transpiler.scanImports(await Bun.file(path).text())
  importCache.set(path, imports)
  return imports
}

async function staticGraph(entrypoints: string[]) {
  const visited = new Set<string>()
  const dynamic = new Set<string>()
  async function visit(path: string) {
    if (visited.has(path) || !outputs.has(path)) return
    visited.add(path)
    for (const item of await importsFor(path)) {
      if (!item.path.startsWith('.')) continue
      const dependency = resolve(dirname(path), item.path)
      if (item.kind === 'dynamic-import') dynamic.add(dependency)
      else if (item.kind === 'import-statement') await visit(dependency)
    }
  }
  for (const entrypoint of entrypoints) await visit(entrypoint)
  return { files: visited, dynamic }
}

function byteSize(paths: Iterable<string>) {
  let total = 0
  for (const path of paths) total += outputs.get(path)?.size ?? 0
  return total
}

const initialGraph = await staticGraph(initialScripts)
const initialJsBytes = byteSize(initialGraph.files)
const initialCssBytes = byteSize(initialStyles)
const routeGraphs = await Promise.all(
  [...initialGraph.dynamic].map(async (entrypoint) => {
    const graph = await staticGraph([entrypoint])
    const routeFiles = [...graph.files].filter((path) => !initialGraph.files.has(path))
    return {
      entrypoint: entrypoint.split(/[\\/]/).at(-1) ?? entrypoint,
      bytes: byteSize(routeFiles),
    }
  }),
)
const largestRoute = routeGraphs.toSorted((left, right) => right.bytes - left.bytes)[0] ?? {
  entrypoint: 'none',
  bytes: 0,
}

function enforceBudget(label: string, actual: number, budget: number) {
  if (actual <= budget) return
  throw new Error(
    `${label} is ${formatKib(actual)}, exceeding the ${formatKib(budget)} performance budget`,
  )
}

function formatKib(bytes: number) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

enforceBudget('Initial JavaScript', initialJsBytes, INITIAL_JS_BUDGET_BYTES)
enforceBudget('Initial CSS', initialCssBytes, INITIAL_CSS_BUDGET_BYTES)
enforceBudget(`Largest lazy route (${largestRoute.entrypoint})`, largestRoute.bytes, ROUTE_JS_BUDGET_BYTES)

const performanceBudget = {
  initialJsBytes,
  initialCssBytes,
  largestRoute,
  budgets: {
    initialJsBytes: INITIAL_JS_BUDGET_BYTES,
    initialCssBytes: INITIAL_CSS_BUDGET_BYTES,
    routeJsBytes: ROUTE_JS_BUDGET_BYTES,
  },
}
await Bun.write(
  new URL('./dist/performance-budget.json', import.meta.url),
  `${JSON.stringify(performanceBudget, null, 2)}\n`,
)
console.log(
  `Frontend budget · initial JS ${formatKib(initialJsBytes)} · CSS ${formatKib(initialCssBytes)} · largest route ${formatKib(largestRoute.bytes)}`,
)
