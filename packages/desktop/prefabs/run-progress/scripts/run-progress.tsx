import ReactEcs, { ReactEcsRenderer } from '@dcl/sdk/react-ecs'
import { engine, PlayerIdentityData, VisibilityComponent, type Entity } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { game } from '~runtime/game'
import { RunHud } from '~runtime/gameHud'
import { UI_CANVAS } from '~runtime/uiTheme'
import type { ColorHex, EntityName, EntityNames, ZoneName, ZoneNames } from '~runtime/authoring'
import { createRun, restartRun, runOf } from '~runtime/runs'
import { namedEntity, namedPosition } from '~runtime/sceneNames'
import { elapsedRun, freshRun, type RunAction, type RunState } from '~runtime/pure/runState'
import { RunPrediction } from '~runtime/pure/runPrediction'

function list(value: string): string[] {
  return value.split(',').map((name) => name.trim()).filter(Boolean)
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export class RunProgress {
  private items: string[] = []
  private points: string[] = []
  private visuals: string[] = []
  private prediction: RunPrediction | null = null
  private notice = ''
  private noticeUntil = 0
  private pending = false
  private lastVisual = ''

  constructor(
    public src: string,
    public entity: Entity,
    public courseId: string = 'course',
    public title: string = 'Sky Lantern Run',
    public objective: string = 'Collect every orb and reach the finish',
    public startArea: ZoneName = 'Start',
    public finishArea: ZoneName = 'Finish',
    public startMarker: EntityName = 'Start Spawn',
    public checkpointAreas: ZoneNames = 'Checkpoint 1, Checkpoint 2, Checkpoint 3',
    public checkpointMarkers: EntityNames = 'Spawn 1, Spawn 2, Spawn 3',
    public collectibleAreas: ZoneNames = 'Orb 1, Orb 2, Orb 3, Orb 4, Orb 5',
    public accentColor: ColorHex = '#FFC459',
    public collectibleVisuals: EntityNames = ''
  ) {}

  start(): void {
    this.items = list(this.collectibleAreas)
    this.points = list(this.checkpointAreas)
    this.visuals = list(this.collectibleVisuals)
    if (this.visuals.length !== 0 && this.visuals.length !== this.items.length) throw new Error('Each collectible area needs a matching visual name.')
    const markers = list(this.checkpointMarkers)
    if (this.points.length !== markers.length) throw new Error('Each checkpoint area needs a matching spawn marker.')
    if (isServer()) {
      createRun({
        id: this.courseId, startArea: this.startArea, finishArea: this.finishArea,
        startPosition: namedPosition(this.startMarker),
        checkpoints: this.points.map((area, index) => ({ area, position: namedPosition(markers[index]) })),
        collectibles: this.items
      })
      return
    }
    this.prediction = new RunPrediction({ checkpoints: this.points, collectibles: this.items })
    const watch = (area: string, action: RunAction) => game.onLocalAreaEnter(area, (validation) => {
      this.current()
      const predicted = this.prediction!.predict(action, game.now())
      if (predicted.message) this.say(predicted.message)
      this.update()
      void validation.then((accepted) => {
        this.current()
        if (!accepted && predicted.id !== null && this.prediction!.reject(predicted.id)) {
          this.say('Progress could not be confirmed. Try again.')
          this.update()
        }
      })
    })
    watch(this.startArea, { type: 'start' })
    watch(this.finishArea, { type: 'finish' })
    this.points.forEach((area, index) => watch(area, { type: 'checkpoint', index }))
    this.items.forEach((id) => watch(id, { type: 'collect', id }))
    ReactEcsRenderer.addUiRenderer(this.entity, () => this.render(), UI_CANVAS)
  }

  update(): void {
    if (isServer()) return
    const state = this.current()
    if (state === null) return
    const signature = `${state.attempt}:${state.collected.join(',')}`
    if (signature === this.lastVisual) return
    let complete = true
    for (const [index, name] of this.items.entries()) {
      const entity = namedEntity(this.visuals[index] ?? name)
      if (entity === null) { complete = false; continue }
      VisibilityComponent.createOrReplace(entity, { visible: !state.collected.includes(name), propagateToChildren: true })
    }
    if (complete) this.lastVisual = signature
  }

  private player(): string {
    return (PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address ?? '').toLowerCase()
  }

  private current(): RunState | null {
    const state = runOf(this.courseId, this.player())
    this.prediction?.reconcile(state, game.now())
    return this.prediction?.view(game.now()) ?? state
  }

  private say(text: string): void {
    this.notice = text
    this.noticeUntil = game.now() + 3500
  }

  private restart(): void {
    const state = runOf(this.courseId, this.player())
    if (state === null || this.pending) return
    this.pending = true
    this.current()
    const predicted = this.prediction?.predict({ type: 'restart' }, game.now())
    this.update()
    void restartRun(this.courseId, state.attempt).then((result) => {
      if (record(result).ok !== true) throw new Error('Restart was refused')
    }).catch((error: unknown) => {
      if (predicted?.id != null) this.prediction?.reject(predicted.id)
      this.say('Restart failed. Try again.')
      console.log(`[runProgress] restart failed: ${String(error)}`)
    }).finally(() => { this.pending = false })
  }

  private render(): ReactEcs.JSX.Element {
    const player = this.player()
    const state = this.current() ?? freshRun()
    const health = record(game.state.health)[player]
    const life = record(record(game.state.healthLife)[player])
    return <RunHud
      title={this.title} objective={this.objective} phase={state.phase}
      elapsedMs={elapsedRun(state, game.now())} bestMs={state.bestMs}
      checkpoint={state.checkpoint} checkpoints={this.points.length}
      collected={state.collected.length} collectibles={this.items.length}
      health={typeof health === 'number' ? health : null}
      maxHealth={typeof game.state.healthMax === 'number' ? game.state.healthMax : 100}
      respawnSeconds={life.dead === true && typeof life.respawnAt === 'number' ? Math.max(0, life.respawnAt - game.now()) / 1000 : 0}
      notice={game.now() < this.noticeUntil ? this.notice : ''}
      accentColor={this.accentColor} restart={() => this.restart()}
    />
  }
}
