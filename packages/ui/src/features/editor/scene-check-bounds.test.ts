import { expect, it } from 'vitest'
import { runSceneChecks } from './scene-checks'
import type { SceneCheckContext } from './scene-checks'

const at = (x: number, y: number, z: number, parent?: number) => ({ Transform: { position: { x, y, z }, parent } })
const tower: SceneCheckContext = {
  snapshot: { '5': at(0, 0, 0), '512': at(24, 16, 24), '513': at(8, 49, 8) },
  prefabs: [], scripts: {}, gameConfig: null, parcels: [{ x: 0, y: 0 }]
}
const outside = (ctx: SceneCheckContext) => runSceneChecks(ctx).filter(f => f.id === 'outside-scene-bounds')

it('warns about entity origins past the parcels or the height limit, and keeps only the height one after expansion', () => {
  const before = outside(tower)
  expect(before.map(f => f.entityId).sort()).toEqual(['512', '513'])
  expect(before.every(f => f.level === 'warning')).toBe(true)
  const expanded = { ...tower, parcels: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] }
  expect(outside(expanded).map(f => f.entityId)).toEqual(['513'])
})

it('reports an out-of-bounds parent once, not each of its children', () => {
  const snapshot = { ...tower.snapshot, '514': at(1, 0, 1, 512), '515': at(0, 1, 0, 514) }
  expect(outside({ ...tower, snapshot }).map(f => f.entityId).sort()).toEqual(['512', '513'])
})
