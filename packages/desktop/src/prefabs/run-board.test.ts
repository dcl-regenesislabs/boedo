import { describe, expect, it } from 'vitest'
import { runBoard } from '../../runtime-modules/pure/runBoard'
import { boardRows, renderPanel } from '../../prefabs/leaderboard/scripts/pure/board'

describe('course best-time leaderboard', () => {
  it('keeps one fastest time per player across repeated finishes', () => {
    const first = runBoard([], { player: '0xAda', bestMs: 12500 })
    const slower = runBoard(first, { player: '0xada', bestMs: 20000 })
    expect(slower).toEqual([{ player: '0xada', score: 12.5 }])
    expect(runBoard(slower, { player: '0xADA', bestMs: 10000 })).toEqual([{ player: '0xada', score: 10 }])
  })

  it('recovers valid saved rows, removes duplicates and bounds the shared board', () => {
    const saved = [null, { player: '', score: 1 }, { player: 'invalid', score: -1 }, { player: 'infinite', score: Infinity },
      ...Array.from({ length: 30 }, (_, i) => ({ player: `player${i}`, score: 30 - i })), { player: 'PLAYER29', score: 50 }]
    const rows = runBoard(saved)
    expect(rows).toHaveLength(25)
    expect(rows[0]).toEqual({ player: 'player29', score: 1 })
    expect(rows.at(-1)?.score).toBe(25)
  })

  it('paints the finisher\'s display name and a short wallet for a row without one', () => {
    const named = runBoard([], { player: '0x4b65000000000000000000000000000000006caa', bestMs: 59200, name: 'Ada' })
    const board = runBoard(named, { player: '0x1111000000000000000000000000000000002222', bestMs: 61000 })
    expect(renderPanel('Fastest Climbs', boardRows(board, 'asc', 8), 'asc', '')).toBe(
      'FASTEST CLIMBS\n\n1. Ada   0:59\n2. 0x1111…2222   1:01'
    )
  })
})
