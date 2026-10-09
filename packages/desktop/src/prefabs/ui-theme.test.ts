import { describe, expect, it } from 'vitest'
import { createUiTheme, themeColorBinding, type UiColor } from '../../runtime-modules/pure/uiTheme'

// WCAG 2.x relative luminance, independent of the module under test.
const channel = (v: number) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
const luminance = (c: UiColor) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
const contrast = (a: UiColor, b: UiColor) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)

describe('scene UI theme', () => {
  it.each(['Dark', 'Light'] as const)('keeps button and small accent text readable in %s mode', (mode) => {
    for (const accent of ['#FF2D55', '#FFC459', '#000000', '#FFFFFF', '#777777', '#00FF00', '#0000FF']) {
      const t = createUiTheme(accent, mode)
      expect(contrast(t.accent, t.onAccent), accent).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t.accentHover, t.onAccent), accent).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t.accentText, t.panel), accent).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t.accentText, t.tint), accent).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t.muted, t.panel), accent).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('derives the entire accent palette from one color and has a valid fallback', () => {
    const rose = createUiTheme('#FF2D55')
    const mint = createUiTheme('#59E0AC')
    expect(mint.accent).not.toEqual(rose.accent)
    expect(mint.tint).not.toEqual(rose.tint)
    expect(mint.accentText).not.toEqual(rose.accentText)
    expect(mint.panel).toEqual(rose.panel)
    expect(createUiTheme('broken')).toEqual(rose)
  })
})

it('keeps distinct semantic roles for colors that currently look identical', () => {
  const theme = createUiTheme('#FFFFFF', 'Dark', '#00FF00')
  expect(theme.accent).toEqual(theme.accentText)
  expect(themeColorBinding(theme.accent)).toEqual({ token: 'accent', fallbackAccent: '#00FF00' })
  expect(themeColorBinding(theme.accentText)?.token).toBe('accentText')
  expect(themeColorBinding({ ...theme.accent })).toBeUndefined()
})
