import { expect, test } from 'bun:test'

const SOURCE_ROOT = new URL('../../', import.meta.url).pathname

test('application code consumes HeroUI through the local UI adapter layer', async () => {
  const directImports: string[] = []
  const nativeAtoms: string[] = []

  for (const pattern of ['**/*.ts', '**/*.tsx']) {
    const glob = new Bun.Glob(pattern)
    for await (const absolutePath of glob.scan({ absolute: true, cwd: SOURCE_ROOT })) {
      if (absolutePath.endsWith('.test.ts') || absolutePath.endsWith('.test.tsx')) continue
      const relativePath = absolutePath.slice(SOURCE_ROOT.length)
      const source = await Bun.file(absolutePath).text()

      if (!relativePath.startsWith('components/ui/') && source.includes("from '@heroui/")) {
        directImports.push(relativePath)
      }

      if (relativePath.startsWith('components/ui/')) continue
      const withoutHiddenFileInput = source.replace(
        /<input\s+[\s\S]*?className="composer-file-input"[\s\S]*?\/>/g,
        '',
      )
      if (/<(?:button|input|textarea|select|details|summary|form|label|a)\b/.test(withoutHiddenFileInput)) {
        nativeAtoms.push(relativePath)
      }
      if (/<(?:Link|NavLink)\b/.test(withoutHiddenFileInput)) nativeAtoms.push(relativePath)
    }
  }

  expect(directImports).toEqual([])
  expect(nativeAtoms).toEqual(['components/AssistantMarkdown.tsx'])
})

test('the only native input is the hidden image file picker', async () => {
  const source = await Bun.file(new URL('../AssistantPanel.tsx', import.meta.url)).text()
  const nativeInputs = source.match(/<input\b/g) ?? []

  expect(nativeInputs).toHaveLength(1)
  expect(source).toContain('className="composer-file-input"')
  expect(source).toContain('type="file"')
})
