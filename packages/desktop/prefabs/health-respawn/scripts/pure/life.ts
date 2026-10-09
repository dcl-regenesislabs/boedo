import { clampMax, type HealthMap } from './health'

export interface LifeState {
  life: number
  deaths: number
  dead: boolean
  respawnAt: number
  protectedUntil: number
}

export type LifeMap = Record<string, LifeState>

export function freshLife(): LifeState {
  return { life: 1, deaths: 0, dead: false, respawnAt: 0, protectedUntil: 0 }
}

export function readLives(value: unknown): LifeMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const result: LifeMap = {}
  for (const [player, entry] of Object.entries(value)) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    if (typeof row.dead !== 'boolean' || ![row.life, row.deaths, row.respawnAt, row.protectedUntil]
      .every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) continue
    result[player] = {
      life: row.life as number, deaths: row.deaths as number, dead: row.dead,
      respawnAt: row.respawnAt as number, protectedUntil: row.protectedUntil as number
    }
  }
  return result
}

export function advanceLives(
  health: HealthMap, lives: LifeMap, fallen: ReadonlySet<string>, now: number,
  maxHealth: number, delaySeconds: number, protectionSeconds: number
): { health: HealthMap; lives: LifeMap; respawn: string[]; changed: boolean } {
  const nextHealth = { ...health }
  const nextLives = { ...lives }
  const respawn: string[] = []
  const delay = Number.isFinite(delaySeconds) ? Math.max(0, Math.min(60, delaySeconds)) * 1000 : 0
  const protection = Number.isFinite(protectionSeconds) ? Math.max(0, Math.min(30, protectionSeconds)) * 1000 : 1000
  let changed = false
  for (const [player, hp] of Object.entries(health)) {
    let life = lives[player] ?? freshLife()
    if (!life.dead && (hp <= 0 || (fallen.has(player) && now >= life.protectedUntil))) {
      life = { ...life, dead: true, deaths: life.deaths + 1, respawnAt: now + delay }
      nextHealth[player] = 0
      changed = true
    }
    if (life.dead && now >= life.respawnAt) {
      life = { ...life, life: life.life + 1, dead: false, respawnAt: 0, protectedUntil: now + protection }
      nextHealth[player] = clampMax(maxHealth)
      respawn.push(player)
      changed = true
    }
    nextLives[player] = life
  }
  return { health: nextHealth, lives: nextLives, respawn, changed }
}
