import ReactEcs, { ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { UI_CANVAS, sceneUiTheme } from '~runtime/uiTheme'
import { UiPanel, UiText } from '~runtime/uiComponents'
import { formatScore, shortName, type BoardRow, type BoardSort } from './pure/board'

export function mountLeaderboardHud(entity: Entity, position: 'left' | 'right', read: () => {
  title: string; rows: BoardRow[]; sort: BoardSort; empty: string
}): void {
  ReactEcsRenderer.addUiRenderer(entity, () => {
    const theme = sceneUiTheme()
    const board = read()
    const rows = board.rows.slice(0, 10)
    return <UiEntity uiTransform={{ positionType: 'absolute', width: '100%', height: '100%', padding: 28,
      justifyContent: position === 'left' ? 'flex-start' : 'flex-end', alignItems: 'center', pointerFilter: 'none' }}>
      <UiPanel theme={theme} uiTransform={{ width: 420, height: 116 + Math.max(1, rows.length) * 40 }}>
        <UiText value={board.title} color={theme.text} size={26} height={40} />
        <UiText value={board.sort === 'asc' ? 'FASTEST TIMES' : 'HIGH SCORES'} color={theme.muted} size={14} height={24} />
        {rows.length === 0 && <UiText value={board.empty} color={theme.muted} size={16} height={40} />}
        {rows.map((row) => <UiEntity key={row.player} uiTransform={{ width: '100%', height: 40, pointerFilter: 'none' }}>
          <UiText value={String(row.rank).padStart(2, '0')} color={theme.accentText} size={17} mono uiTransform={{ width: 42 }} height={40} />
          <UiText value={shortName(row.player)} color={theme.text} size={18} uiTransform={{ width: 212 }} height={40} />
          <UiText value={formatScore(row.score, board.sort)} color={theme.text} size={18} mono align="middle-right" uiTransform={{ width: 116 }} height={40} />
        </UiEntity>)}
      </UiPanel>
    </UiEntity>
  }, UI_CANVAS)
}
