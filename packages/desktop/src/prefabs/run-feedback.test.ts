import { beforeEach, describe, expect, it, vi } from 'vitest'
import { advanceRun, freshRun, type RunState } from '../../runtime-modules/pure/runState'

const host = vi.hoisted(() => ({
  now: 1000,
  state: null as RunState | null,
  listeners: new Map<string, (result: Promise<boolean>) => void>(),
  visibility: new Map<number, { visible: boolean; propagateToChildren: boolean }>(),
  render: null as (() => unknown) | null
}))

vi.mock('@dcl/sdk/ecs', () => ({
  engine: { PlayerEntity: 1 },
  PlayerIdentityData: { getOrNull: () => ({ address: '0xada' }) },
  VisibilityComponent: { createOrReplace: (id: number, value: { visible: boolean; propagateToChildren: boolean }) => host.visibility.set(id, value) }
}))
vi.mock('@dcl/sdk/network', () => ({ isServer: () => false }))
vi.mock('@dcl/sdk/react-ecs', () => ({
  default: { createElement: (_component: unknown, props: unknown) => props },
  ReactEcsRenderer: { addUiRenderer: (_id: number, render: () => unknown) => { host.render = render } }
}))
vi.mock('~runtime/uiTheme', () => ({ UI_CANVAS: { virtualWidth: 1920, virtualHeight: 1080 } }))
vi.mock('~runtime/gameHud', () => ({ RunHud: () => null }))
vi.mock('~runtime/game', () => ({ game: {
  state: {}, now: () => host.now,
  onLocalAreaEnter: (name: string, fn: (result: Promise<boolean>) => void) => host.listeners.set(name, fn)
} }))
vi.mock('~runtime/runs', () => ({ createRun: vi.fn(), restartRun: vi.fn(), runOf: () => host.state }))
vi.mock('~runtime/sceneNames', () => ({
  namedEntity: (name: string) => ({ 'Orb 1': 10, 'Orb 1 Glow': 11 }[name] ?? null), namedPosition: vi.fn()
}))

beforeEach(() => {
  host.now = 1000
  host.state = advanceRun(freshRun(), { type: 'start' }, 500, { checkpoints: [], collectibles: ['Orb 1'] }).state
  host.listeners.clear()
  host.visibility.clear()
  host.render = null
})

describe('Run Progress presentation', () => {
  it.each([true, false])('hides the plain orb and updates the HUD before a 400 ms server reply (accepted=%s)', async (accepted) => {
    const { RunProgress } = await vi.importActual<{ RunProgress: new (src: string, entity: number) => {
      checkpointAreas: string; checkpointMarkers: string; collectibleAreas: string; collectibleVisuals: string
      start(): void; update(): void
    } }>('../../prefabs/run-progress/scripts/run-progress')
    const progress = new RunProgress('', 0)
    progress.checkpointAreas = ''
    progress.checkpointMarkers = ''
    progress.collectibleAreas = 'Orb 1'
    progress.collectibleVisuals = 'Orb 1 Glow'
    progress.start()
    progress.update()
    expect(host.visibility.get(11)?.visible).toBe(true)
    let answer!: (value: boolean) => void
    const validation = new Promise<boolean>((resolve) => { answer = resolve })
    host.listeners.get('Orb 1')!(validation)
    expect(host.state?.collected).toEqual([])
    expect(host.visibility.get(11)).toEqual({ visible: false, propagateToChildren: true })
    expect(host.visibility.has(10)).toBe(false)
    expect(host.render!()).toMatchObject({ collected: 1, notice: '1 / 1 collected' })
    host.now += 399
    progress.update()
    expect(host.visibility.get(11)?.visible).toBe(false)
    host.now += 1
    if (accepted) host.state = { ...host.state!, collected: ['Orb 1'] }
    answer(accepted)
    await validation
    progress.update()
    expect(host.visibility.get(11)?.visible).toBe(!accepted)
    expect(host.render!()).toMatchObject({ collected: accepted ? 1 : 0 })
    host.state = freshRun(null, 2)
    progress.update()
    expect(host.visibility.get(11)?.visible).toBe(true)
  })
})
