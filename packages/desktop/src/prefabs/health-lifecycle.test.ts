import { describe, expect, it } from 'vitest'
import { advanceLives, freshLife } from '../../prefabs/health-respawn/scripts/pure/life'

describe('player death and respawn', () => {
  it('does not repeatedly kill a respawned player while the old position is still below the fall plane', () => {
    const first = advanceLives({ ada: 100 }, { ada: freshLife() }, new Set(['ada']), 1000, 100, 0, 1)
    expect(first.respawn).toEqual(['ada'])
    const stale = advanceLives(first.health, first.lives, new Set(['ada']), 1500, 100, 0, 1)
    expect(stale.respawn).toEqual([])
    expect(stale.lives.ada.deaths).toBe(1)
    const laterFall = advanceLives(stale.health, stale.lives, new Set(['ada']), 2500, 100, 0, 1)
    expect(laterFall.respawn).toEqual(['ada'])
    expect(laterFall.lives.ada.deaths).toBe(2)
  })
})
