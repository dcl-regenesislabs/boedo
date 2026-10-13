// Players can take damage and respawn. The server owns everyone's hit points and
// decides who died; a client only moves its own player when the server says so,
// because moving an avatar is the one thing only that player's client can do.
//
// Hit points live in `game.state.health` — one wallet → points map every player
// can read, which is what makes a health bar or a "who is still alive" check a
// plain read instead of a message. Other server code hurts a player through
// damage() below; the sweep here notices the zero and respawns them.
import { Transform, type Entity } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { movePlayerTo } from '~system/RestrictedActions'
import { game, type Player } from '~runtime/game'
import { clearRespawnPoint, onLocalRespawn, onPlayerRespawn, respawnPlayer } from '~runtime/respawn'
import type { Vec3 } from '~runtime/pure/worldTransform'
import { asHealthMap, clampMax, deadPlayers } from './pure/health'
import { advanceLives, freshLife, readLives, type LifeMap } from './pure/life'
import { HEALTH_KEY, LIFE_KEY } from './health'

const SWEEP_S = 0.5
const NO_POINT = "Players won't respawn anywhere until you pick a respawn point."

// One Health & Respawn owns the roster. A second copy would revive everyone the
// first one just killed, half a second apart.
let claimed = false

export class HealthRespawn {
  private primary = false

  constructor(
    public src: string,
    public entity: Entity,
    /** Where players come back. Pick the pad or marker they should land on. */
    public respawnAt: Entity = 0 as Entity,
    /** Hit points a player starts every life with. */
    public maxHealth: number = 100,
    /** Players who fall below this height die. Leave at 0 to switch it off. */
    public dieBelowHeight: number = 0,
    /** Seconds to remain dead before returning to the latest checkpoint. */
    public respawnDelay: number = 0,
    /** Seconds of protection after a respawn. */
    public protectionSeconds: number = 1,
    /** Show hit points on Run Progress's HUD. Turn off when nothing in the game deals damage. */
    public healthBar: boolean = true
  ) {}

  start(): void {
    // Claimed before the branch: each side keeps its own `claimed`, and the copy
    // that answers a respawn must be the same one whose params drive the sweep.
    this.primary = !claimed
    claimed = true
    if (!this.primary) {
      console.log('[healthRespawn] a second Health & Respawn is placed — only the first tracks health')
      return
    }
    if (this.respawnAt === (0 as Entity)) console.log(`[healthRespawn] ${NO_POINT}`)
    if (isServer()) {
      onPlayerRespawn((player) => this.restore(player))
      game.onReady(() => game.setState({ [HEALTH_KEY]: {}, [LIFE_KEY]: {}, healthMax: clampMax(this.maxHealth), healthBar: this.healthBar !== false }))
      game.onPlayerJoin((player) => this.revive(player))
      game.onPlayerLeave((player) => {
        const map = { ...asHealthMap(game.state[HEALTH_KEY]) }
        const lives = { ...readLives(game.state[LIFE_KEY]) }
        delete map[player]
        delete lives[player]
        clearRespawnPoint(player)
        game.setState({ [HEALTH_KEY]: map, [LIFE_KEY]: lives })
      })
      game.onRoundStart(() => {
        const map = asHealthMap(game.state[HEALTH_KEY])
        const full: Record<string, number> = {}
        const lives: LifeMap = {}
        for (const player of Object.keys(map)) {
          full[player] = clampMax(this.maxHealth)
          lives[player] = freshLife()
        }
        game.setState({ [HEALTH_KEY]: full, [LIFE_KEY]: lives })
      })
      game.every(SWEEP_S, () => this.sweep())
      return
    }
    onLocalRespawn((position) => this.goHome(position))
  }

  private sweep(): void {
    const map = asHealthMap(game.state[HEALTH_KEY])
    const fallen = new Set(deadPlayers(map, (player) => game.positionOf(player), this.deathPlane))
    const next = advanceLives(map, readLives(game.state[LIFE_KEY]), fallen, game.now(), this.maxHealth, this.respawnDelay, this.protectionSeconds)
    if (!next.changed) return
    game.setState({ [HEALTH_KEY]: next.health, [LIFE_KEY]: next.lives })
    for (const player of next.respawn) respawnPlayer(player)
  }

  private get deathPlane(): number {
    return Number.isFinite(this.dieBelowHeight) ? this.dieBelowHeight : 0
  }

  private revive(player: Player): void {
    game.setState({
      [HEALTH_KEY]: { ...asHealthMap(game.state[HEALTH_KEY]), [player]: clampMax(this.maxHealth) },
      [LIFE_KEY]: { ...readLives(game.state[LIFE_KEY]), [player]: freshLife() }
    })
  }

  private restore(player: Player): void {
    const health = asHealthMap(game.state[HEALTH_KEY])
    if (health[player] === undefined) return
    const lives = readLives(game.state[LIFE_KEY])
    const life = lives[player] ?? freshLife()
    const protection = Number.isFinite(this.protectionSeconds) ? Math.max(0, Math.min(30, this.protectionSeconds)) : 1
    game.setState({
      [HEALTH_KEY]: { ...health, [player]: clampMax(this.maxHealth) },
      [LIFE_KEY]: { ...lives, [player]: {
        ...life, life: life.life + (life.dead ? 1 : 0), dead: false, respawnAt: 0,
        protectedUntil: game.now() + protection * 1000
      } }
    })
  }

  private goHome(requested: Vec3 | null): void {
    const point = this.respawnAt === (0 as Entity) ? null : Transform.getOrNull(this.respawnAt)
    const position = requested ?? point?.position
    if (position === undefined) {
      console.log(`[healthRespawn] ${NO_POINT}`)
      return
    }
    void movePlayerTo({ newRelativePosition: { ...position } }).catch((error: unknown) => {
      console.log(`[healthRespawn] could not move the player: ${String(error)}`)
    })
  }
}
