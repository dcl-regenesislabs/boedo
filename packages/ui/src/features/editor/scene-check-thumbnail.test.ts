import { expect, it } from 'vitest'
import { runSceneChecks } from './scene-checks'
import { context } from './scene-check-fixtures'

const built = { '512': { Transform: { position: { x: 8, y: 0, z: 8 } } } }
const noThumbnail = (over: Parameters<typeof context>[0]) => runSceneChecks(context(over)).filter((f) => f.id === 'no-thumbnail')

it('nudges a scene with content but no thumbnail towards the assistant, and nothing else', () => {
  expect(noThumbnail({ snapshot: built, thumbnailPath: null })).toEqual([expect.objectContaining({
    level: 'warning', title: 'No thumbnail yet', fix: { label: 'Make one with the assistant', action: 'make-thumbnail' }
  })])
  expect(noThumbnail({ snapshot: built, thumbnailPath: 'assets/images/thumbnail.jpg' })).toEqual([])
  expect(noThumbnail({ snapshot: built })).toEqual([])
  expect(noThumbnail({ snapshot: { '0': {} }, thumbnailPath: null })).toEqual([])
})
