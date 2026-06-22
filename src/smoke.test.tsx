import { expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import App from './App'

test('renders the app shell', () => {
  const markup = renderToStaticMarkup(<App />)

  expect(markup).toContain('ELISA Lab')
  expect(markup).toContain('Upload CSV or Excel')
  expect(markup).toContain('Upload CSV')
  expect(markup).toContain('Confirm plate')
  expect(markup).toContain('Assign wells')
  expect(markup).toContain('Configure curve')
  expect(markup).toContain('Results')
  expect(markup).toContain('Export')
})
