import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppBreathingIndicator, AppLoadingNotice, WorkingIndicator } from './Feedback'

test('the breathing indicator is a quiet decorative loading primitive', () => {
  const markup = renderToStaticMarkup(<AppBreathingIndicator className="assistant-waiting" />)

  expect(markup).toContain('app-breathing-indicator assistant-waiting')
  expect(markup).toContain('aria-hidden="true"')
  expect(markup).not.toContain('<svg')
})

test('the working indicator owns the shared running Spinner and optional label', () => {
  const labelledMarkup = renderToStaticMarkup(<WorkingIndicator label="Working" />)
  const iconOnlyMarkup = renderToStaticMarkup(<WorkingIndicator />)

  expect(labelledMarkup).toContain('working-indicator')
  expect(labelledMarkup).toContain('working-indicator__spinner')
  expect(labelledMarkup).toContain('working-indicator__label')
  expect(labelledMarkup).toContain('aria-hidden="true"')
  expect(labelledMarkup).toContain('>Working</span>')
  expect(iconOnlyMarkup).toContain('aria-label="Working"')
})

test('the shared loading notice stays non-modal and uses the breathing primitive', () => {
  const markup = renderToStaticMarkup(
    <AppLoadingNotice detail="Reading the latest projection…" label="Loading Goal" />,
  )

  expect(markup).toContain('app-loading-notice')
  expect(markup).toContain('app-loading-notice__indicator')
  expect(markup).toContain('role="status"')
  expect(markup).toContain('Loading Goal')
  expect(markup).not.toContain('app-spinner')
})
