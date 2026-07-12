import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppDisclosure } from './Disclosure'

test('collapsed disclosures do not render expensive body content', () => {
  let bodyRenderCount = 0

  function Body() {
    bodyRenderCount += 1
    return <span>expensive command output</span>
  }

  const markup = renderToStaticMarkup(
    <AppDisclosure summary="Command">
      <Body />
    </AppDisclosure>,
  )

  expect(bodyRenderCount).toBe(0)
  expect(markup).not.toContain('expensive command output')
})

test('expanded disclosures render their body content', () => {
  const markup = renderToStaticMarkup(
    <AppDisclosure defaultExpanded summary="Command">
      <span>command output</span>
    </AppDisclosure>,
  )

  expect(markup).toContain('command output')
})
