import { expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import App from './App'

test('renders the app shell', () => {
  const markup = renderToStaticMarkup(<App />)

  expect(markup).toContain('<h1>ELISA analysis</h1>')
})
