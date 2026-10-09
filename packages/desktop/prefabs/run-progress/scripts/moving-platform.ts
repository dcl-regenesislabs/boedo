import { Transform, type Entity } from '@dcl/sdk/ecs'
import { game } from '~runtime/game'

export class MovingPlatform {
  private origin: { x: number; y: number; z: number } | null = null

  constructor(
    public src: string,
    public entity: Entity,
    public axis: 'x' | 'y' | 'z' = 'x',
    public distance: number = 2,
    public periodSeconds: number = 6
  ) {}

  start(): void {
    const transform = Transform.getOrNull(this.entity)
    if (transform !== null) this.origin = { ...transform.position }
  }

  update(): void {
    if (this.origin === null || !['x', 'y', 'z'].includes(this.axis)) return
    const transform = Transform.getMutableOrNull(this.entity)
    if (transform === null) return
    const period = Number.isFinite(this.periodSeconds) ? Math.max(2, this.periodSeconds) : 6
    const distance = Number.isFinite(this.distance) ? Math.max(0, Math.min(16, this.distance)) : 0
    transform.position[this.axis] = this.origin[this.axis] + Math.sin(game.now() / 1000 / period * Math.PI * 2) * distance
  }
}
