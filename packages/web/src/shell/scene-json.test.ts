import { expect, it } from 'vitest'
import { applyAssistantSettings } from './scene-json'

const raw = { display: { title: 'Tower' }, scene: { parcels: ['0,0'], base: '0,0' }, main: 'bin/index.js' }

it('lets the assistant grow the scene into one connected area, keeping its base and the rest of scene.json', () => {
  expect(applyAssistantSettings(raw, { parcels: ['0,0', '1,0', '0,1', '1,1'] })).toEqual({
    display: { title: 'Tower' }, scene: { parcels: ['0,0', '1,0', '0,1', '1,1'], base: '0,0' }, main: 'bin/index.js'
  })
  expect(applyAssistantSettings(raw, { parcels: ['5,5', '5,6'] }).scene).toEqual({ parcels: ['5,5', '5,6'], base: '5,5' })
  expect(() => applyAssistantSettings(raw, { parcels: ['0,0', '2,0'] })).toThrow('connected')
  expect(() => applyAssistantSettings(raw, { parcels: ['0,0', '1,0'], base: '3,3' })).toThrow('base')
  expect(() => applyAssistantSettings(raw, { parcels: ['0,0', '0,0'] })).toThrow('duplicates')
  expect(() => applyAssistantSettings(raw, { parcels: 'everything' })).toThrow('parcels')
})
