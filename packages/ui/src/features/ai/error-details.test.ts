import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { ErrorDetails } from './ErrorDetails'

it('shows a hosted timeout only once in the error dialog', () => {
  const message = 'A browser action timed out. The turn stopped; check the scene before retrying.'
  const html = renderToStaticMarkup(createElement(ErrorDetails, { message, hosted: true }))
  expect(html.split(message)).toHaveLength(2)
})

it('retains the underlying desktop error when its hint is different', () => {
  const message = 'CLI subprocess timed out after 60000ms'
  const html = renderToStaticMarkup(createElement(ErrorDetails, { message, hosted: false }))
  expect(html).toContain('The request timed out. Try again.')
  expect(html).toContain(message)
})
