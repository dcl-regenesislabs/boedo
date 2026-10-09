import { describe, expect, it } from 'vitest'
import { advanceRun, elapsedRun, freshRun } from '../../runtime-modules/pure/runState'

const rules = { checkpoints: ['First', 'Second'], collectibles: ['Red', 'Blue'] }

describe('timed runs', () => {
  it('requires a start, ordered checkpoints and distinct collectibles before finishing', () => {
    let state = freshRun()
    expect(advanceRun(state, { type: 'collect', id: 'Red' }, 100, rules).accepted).toBe(false)
    state = advanceRun(state, { type: 'start' }, 1000, rules).state
    expect(advanceRun(state, { type: 'start' }, 2000, rules).state.startedAt).toBe(1000)
    expect(advanceRun(state, { type: 'checkpoint', index: 1 }, 2000, rules).accepted).toBe(false)
    state = advanceRun(state, { type: 'checkpoint', index: 0 }, 2000, rules).state
    state = advanceRun(state, { type: 'collect', id: 'Red' }, 3000, rules).state
    expect(advanceRun(state, { type: 'collect', id: 'Red' }, 3000, rules).accepted).toBe(false)
    expect(advanceRun(state, { type: 'collect', id: 'Forged' }, 3000, rules).accepted).toBe(false)
    expect(advanceRun(state, { type: 'finish' }, 4000, rules).accepted).toBe(false)
    state = advanceRun(state, { type: 'checkpoint', index: 1 }, 4000, rules).state
    expect(advanceRun(state, { type: 'finish' }, 4500, rules).message).toContain('Collect every item')
    state = advanceRun(state, { type: 'collect', id: 'Blue' }, 5000, rules).state
    state = advanceRun(state, { type: 'finish' }, 6000, rules).state
    expect(state).toMatchObject({ phase: 'finished', elapsedMs: 5000, bestMs: 5000 })
    expect(elapsedRun(state, 20000)).toBe(5000)
    const again = advanceRun(state, { type: 'restart' }, 21000, rules).state
    expect(again).toEqual(freshRun(5000, 2))
  })

  it('keeps attempts independent and allows a course without pickups or checkpoints', () => {
    const other = freshRun()
    const started = advanceRun(freshRun(8000), { type: 'start' }, 1000, { checkpoints: [], collectibles: [] }).state
    const finished = advanceRun(started, { type: 'finish' }, 4000, { checkpoints: [], collectibles: [] }).state
    expect(finished.bestMs).toBe(3000)
    expect(other).toEqual(freshRun())
    expect(elapsedRun(started, 3000)).toBe(2000)
  })
})
