import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const WALLET = /^0x[a-f0-9]{40}$/
const DAY_MS = 24 * 60 * 60 * 1000

// high while the assistant is in preview: a guard against runaway use, not a quota anyone meets
export const DEFAULT_USAGE_LIMITS = { daily: 50_000, weekly: 200_000 }

export interface UsageBalance {
  dailyPercent: number
  dailyResetAt: string
  weeklyPercent: number
  weeklyResetAt: string
}

export interface WalletUsage {
  balance(): Promise<UsageBalance>
  exhausted(): Promise<boolean>
  record(cost: number): Promise<UsageBalance>
}

export interface UsageMeter {
  forWallet(wallet: string): WalletUsage
}

interface Spent {
  day: number
  daily: number
  week: number
  weekly: number
}

// weeks start on Monday, 00:00 UTC (1970-01-01 was a Thursday)
const dayOf = (now: number): number => Math.floor(now / DAY_MS)
const weekOf = (now: number): number => Math.floor((dayOf(now) + 3) / 7)

export function createUsageMeter(dir: string, limits = DEFAULT_USAGE_LIMITS, now = Date.now): UsageMeter {
  const cache = new Map<string, Promise<Spent>>()
  let writes: Promise<unknown> = Promise.resolve()

  function load(wallet: string): Promise<Spent> {
    let spent = cache.get(wallet)
    if (spent === undefined) {
      spent = readFile(join(dir, `${wallet}.json`), 'utf8')
        .then((text) => JSON.parse(text) as Spent)
        .catch(() => ({ day: 0, daily: 0, week: 0, weekly: 0 }))
      cache.set(wallet, spent)
    }
    return spent.then((s) => {
      const t = now()
      if (s.day !== dayOf(t)) Object.assign(s, { day: dayOf(t), daily: 0 })
      if (s.week !== weekOf(t)) Object.assign(s, { week: weekOf(t), weekly: 0 })
      return s
    })
  }

  const percent = (spent: number, limit: number): number => Math.min(100, Math.round((spent / limit) * 1000) / 10)
  const view = (s: Spent): UsageBalance => ({
    dailyPercent: percent(s.daily, limits.daily),
    dailyResetAt: new Date((s.day + 1) * DAY_MS).toISOString(),
    weeklyPercent: percent(s.weekly, limits.weekly),
    weeklyResetAt: new Date(((s.week + 1) * 7 - 3) * DAY_MS).toISOString()
  })

  return {
    forWallet(raw) {
      const wallet = raw.toLowerCase()
      if (!WALLET.test(wallet)) throw new Error('Invalid wallet')
      return {
        balance: async () => view(await load(wallet)),
        exhausted: async () => {
          const s = await load(wallet)
          return s.daily >= limits.daily || s.weekly >= limits.weekly
        },
        async record(cost) {
          const s = await load(wallet)
          if (Number.isFinite(cost) && cost > 0) {
            s.daily += cost
            s.weekly += cost
            const snapshot = JSON.stringify(s)
            const target = join(dir, `${wallet}.json`)
            const next = writes.then(async () => {
              await mkdir(dir, { recursive: true, mode: 0o700 })
              await writeFile(`${target}.tmp`, snapshot, { mode: 0o600 })
              await rename(`${target}.tmp`, target)
            })
            writes = next.catch(() => {})
            await next
          }
          return view(s)
        }
      }
    }
  }
}
