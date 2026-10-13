import { describe, expect, it } from 'vitest'
import { checkCanvasSize } from './build-passes'

describe('a model build', () => {
  it('takes only power-of-two canvas sides up to 512', () => {
    expect(() => checkCanvasSize(512, 64)).not.toThrow()
    for (const [w, h] of [[300, 128], [1024, 512], [256, 0], [128.5, 128]]) expect(() => checkCanvasSize(w, h)).toThrow(/power of two up to 512/)
  })
})
