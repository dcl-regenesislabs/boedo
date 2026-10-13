import { describe, expect, it } from 'vitest'
import { libraryMaterialName, surface } from './materials'

describe('library material names', () => {
  it('are <Name>_MAT, suffixed by each setting that differs from the scan', () => {
    const scan = { color: 'ffffff', ...surface('red-brick'), relief: true }
    expect(libraryMaterialName('red-brick', scan)).toBe('RedBrick_MAT')
    expect(libraryMaterialName('red-brick', { ...scan, color: 'aa3300', relief: false, roughness: 0.9, metalness: 0.25 }))
      .toBe('RedBrick_MAT_TintAA3300_Flat_R90_M25')
  })
})
