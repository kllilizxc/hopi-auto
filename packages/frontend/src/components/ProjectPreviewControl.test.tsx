import { expect, test } from 'bun:test'

test('one Preview control exposes every adapter-declared surface without topology semantics', async () => {
  const source = await Bun.file(
    new URL('./ProjectPreviewControl.tsx', import.meta.url),
  ).text()

  expect(source).toContain('<SelectField')
  expect(source).toContain('options={surfaces.map((surface)')
  expect(source).toContain("window.open(surface.url, '_blank', 'noopener,noreferrer')")
  expect(source).not.toMatch(/host|child|dependency/i)
})
