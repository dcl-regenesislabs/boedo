import type { Entity } from '@dcl/sdk/ecs'
import type { ColorHex } from '~runtime/authoring'
import { setUiTheme } from '~runtime/uiTheme'

export class UiTheme {
  constructor(
    public src: string,
    public entity: Entity,
    public accentColor: ColorHex = '#FF2D55',
    public appearance: 'Dark' | 'Light' = 'Dark'
  ) {}

  start(): void {
    setUiTheme(this.entity, this.accentColor, this.appearance)
  }
}
