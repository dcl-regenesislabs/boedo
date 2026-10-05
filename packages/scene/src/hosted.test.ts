import { afterEach, describe, expect, it, vi } from 'vitest'
import { type LiveSceneInfo } from './bevy-api/interface'
import { BevyApi } from './bevy-api'
import { resolveInspectableScene } from './current-scene'
import { hostedAmong, setHosted } from './hosted'

vi.mock('./bevy-api', () => ({ BevyApi: { liveSceneInfo: vi.fn() } }))

const scene = (hash: string, flags: Partial<LiveSceneInfo> = {}): LiveSceneInfo => ({
  hash,
  title: hash,
  parcels: [{ x: 0, y: 0 }],
  isPortable: false,
  isBroken: false,
  isBlocked: false,
  isSuper: false,
  sdkVersion: '7',
  ...flags
})

const editor = scene('editor', { isSuper: true, isPortable: true })
const hostHud = scene('hud', { isSuper: true, isPortable: true })
const controller = scene('controller', { isPortable: true })

// Hosted, this scene runs on an engine where the player is already signed in:
// the automatic login would replace their session, so it runs standalone only.
describe('hosted', () => {
  afterEach(() => setHosted(true))

  it('is decided by another privileged scene being live', () => {
    expect(hostedAmong([editor, controller, scene('project')])).toBe(false)
    expect(hostedAmong([hostHud, editor, controller, scene('project')])).toBe(true)
  })

  it('only ever targets a preview scene, not the deployed one the player stands in', async () => {
    const live = vi.mocked(BevyApi.liveSceneInfo)

    live.mockResolvedValue([hostHud, editor, scene('bafkreideployed')])
    expect((await resolveInspectableScene()).scene).toBeUndefined()

    live.mockResolvedValue([hostHud, editor, scene('bafkreideployed', { parcels: [{ x: 5, y: 5 }] }), scene('b64-cHJvamVjdA==')])
    expect((await resolveInspectableScene()).scene?.hash).toBe('b64-cHJvamVjdA==')

    setHosted(false)
    live.mockResolvedValue([editor, scene('bafkreideployed')])
    expect((await resolveInspectableScene()).scene?.hash).toBe('bafkreideployed')
  })
})
