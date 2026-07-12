import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppScrollShadow } from './ScrollShadow'

test('scroll lists use the HeroUI mask-image primitive through the local adapter', () => {
  const markup = renderToStaticMarkup(
    <AppScrollShadow orientation="horizontal" size={18} className="example-list">
      Content
    </AppScrollShadow>,
  )

  expect(markup).toContain('scroll-shadow')
  expect(markup).toContain('scroll-shadow--horizontal')
  expect(markup).toContain('app-scroll-shadow example-list')
  expect(markup).toContain('--scroll-shadow-size:18px')
  expect(markup).toContain('data-slot="scroll-shadow"')
})

test('automatic scroll lists begin vertically until layout selects the overflowing axis', () => {
  const markup = renderToStaticMarkup(
    <AppScrollShadow orientation="auto">Content</AppScrollShadow>,
  )

  expect(markup).toContain('scroll-shadow--vertical')
})
