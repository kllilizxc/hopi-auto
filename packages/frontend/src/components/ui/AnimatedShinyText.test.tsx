import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnimatedShinyText } from './AnimatedShinyText'

test('exposes the Magic UI shimmer width without changing its text', () => {
  const markup = renderToStaticMarkup(
    <AnimatedShinyText shimmerWidth={140}>Running Work</AnimatedShinyText>,
  )

  expect(markup).toContain('class="animated-shiny-text"')
  expect(markup).toContain('--shiny-width:140px')
  expect(markup).toContain('Running Work')
})
