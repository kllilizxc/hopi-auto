import tailwind from 'bun-plugin-tailwind'
import { rm } from 'node:fs/promises'

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
