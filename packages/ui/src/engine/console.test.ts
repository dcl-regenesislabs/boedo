// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { consoleLine } from './console'

// What the engine does with a console line: cut it on whitespace, then join a
// trailing JSON argument's pieces back with single spaces.
function jsonArgAsTheEngineSeesIt(line: string, index: number): unknown {
  return JSON.parse(line.split(/\s+/).slice(index).join(' '))
}

it('carries a JSON argument through the engine’s whitespace split unchanged', () => {
  const value = { text: 'two  spaces and a no-break one', name: 'My Cube' }
  const line = consoleLine('set_component', ['512', 'TextShape', JSON.stringify(value)])
  expect(jsonArgAsTheEngineSeesIt(line, 3)).toEqual(value)
})
