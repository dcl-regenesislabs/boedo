// What other scripts call to read and change a player's hit points. It lives
// beside health-respawn.ts rather than in it because a prefab's script file
// exports exactly one class — the runtime constructs the first function-valued
// export, so a helper sitting next to the class could be built instead of it.
import { game, type Player } from '~runtime/game'
import { afterDamage, asHealthMap } from './pure/health'
import { readLives, type LifeState } from './pure/life'

export const HEALTH_KEY = 'health'
export const LIFE_KEY = 'healthLife'

export function lifeOf(player: Player): LifeState | null {
  return readLives(game.state[LIFE_KEY])[player] ?? null
}

/** Hit points a player has right now. 0 means they are on their way back. */
export function healthOf(player: Player): number {
  return asHealthMap(game.state[HEALTH_KEY])[player] ?? 0
}

/**
 * Hurt a player. Call it from server code — a client cannot change anyone's
 * health. At zero the placed Health & Respawn sends them back to its respawn
 * point on their next sweep.
 */
export function damage(player: Player, amount: number): void {
  const life = lifeOf(player)
  if (life?.dead || (life !== null && game.now() < life.protectedUntil)) return
  game.setState({ [HEALTH_KEY]: afterDamage(asHealthMap(game.state[HEALTH_KEY]), player, amount) })
}

export function heal(player: Player, amount: number): void {
  const map = asHealthMap(game.state[HEALTH_KEY])
  if (map[player] === undefined || map[player] <= 0 || lifeOf(player)?.dead || !Number.isFinite(amount)) return
  const max = typeof game.state.healthMax === 'number' ? game.state.healthMax : 100
  game.setState({ [HEALTH_KEY]: { ...map, [player]: Math.min(max, map[player] + Math.max(0, Math.round(amount))) } })
}

export function kill(player: Player): void {
  const map = asHealthMap(game.state[HEALTH_KEY])
  if (map[player] === undefined || lifeOf(player)?.dead) return
  game.setState({ [HEALTH_KEY]: { ...map, [player]: 0 } })
}
