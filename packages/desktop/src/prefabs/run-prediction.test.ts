import { describe, expect, it } from 'vitest'
import { RunPrediction } from '../../runtime-modules/pure/runPrediction'
import { advanceRun, freshRun } from '../../runtime-modules/pure/runState'

const rules = { checkpoints: ['First'], collectibles: ['Red', 'Blue'] }
const running = advanceRun(freshRun(8000), { type: 'start' }, 1000, rules).state

describe('local run feedback', () => {
  it('rebases multiple pending actions and ignores reordered rejection replies after confirmation', () => {
    const prediction = new RunPrediction(rules)
    prediction.reconcile(running, 1200)
    const red = prediction.predict({ type: 'collect', id: 'Red' }, 1200).id!
    prediction.predict({ type: 'collect', id: 'Blue' }, 1250)
    const confirmed = advanceRun(running, { type: 'collect', id: 'Red' }, 1600, rules).state
    prediction.reconcile(confirmed, 1600)
    expect(prediction.reject(red)).toBe(false)
    expect(prediction.view(1600)?.collected).toEqual(['Red', 'Blue'])
    prediction.reconcile(confirmed, 4250)
    expect(prediction.view(4250)?.collected).toEqual(['Red'])
  })

  it('clears pending work on restart and cannot restore it with a stale attempt or reply', () => {
    const prediction = new RunPrediction(rules)
    prediction.reconcile(running, 1200)
    const old = prediction.predict({ type: 'collect', id: 'Red' }, 1200).id!
    prediction.reconcile(freshRun(8000, 2), 1600)
    prediction.predict({ type: 'start' }, 1700)
    prediction.predict({ type: 'collect', id: 'Red' }, 1800)
    prediction.reconcile(running, 1850)
    expect(prediction.reject(old)).toBe(false)
    expect(prediction.view(1850)).toMatchObject({ attempt: 2, collected: ['Red'] })
  })

  it('predicts checkpoints and completion without saving a personal best', () => {
    const prediction = new RunPrediction(rules)
    prediction.reconcile(running, 1200)
    prediction.predict({ type: 'checkpoint', index: 0 }, 1200)
    expect(prediction.predict({ type: 'finish' }, 1300).id).toBeNull()
    prediction.predict({ type: 'collect', id: 'Red' }, 1400)
    prediction.predict({ type: 'collect', id: 'Blue' }, 1500)
    prediction.predict({ type: 'finish' }, 1600)
    expect(prediction.view(1800)).toMatchObject({ phase: 'finished', elapsedMs: 600, bestMs: 8000 })
    const restart = prediction.predict({ type: 'restart' }, 1900).id!
    expect(prediction.view(1900)).toEqual(freshRun(8000, 2))
    prediction.reject(restart)
    expect(prediction.view(2000)?.phase).toBe('finished')
  })
})
