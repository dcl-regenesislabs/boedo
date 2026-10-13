import { object } from '@dcl-editor/contract'
import { state } from '@scene/state'
import { syncFrozenState } from '@scene/inspector'
import { uiPlay } from '@ui/actions/playback'
import { restartScene } from '@ui/boot/boot'
import { consoleCommand, getEngineWindow } from '@ui/engine/console'
import { cmd } from '@ui/engine/cmd'
import { hostV1 } from '@ui/engine/hosted'
import { errorLines, isServerError } from '@ui/features/editor/log-roles'
import { steerJump, playerPosition, type Point } from './movement-keys'

const KEYS: Record<string, { key: string; code: string; keyCode: number }> = {
  W: { key: 'w', code: 'KeyW', keyCode: 87 }, A: { key: 'a', code: 'KeyA', keyCode: 65 },
  S: { key: 's', code: 'KeyS', keyCode: 83 }, D: { key: 'd', code: 'KeyD', keyCode: 68 },
  Space: { key: ' ', code: 'Space', keyCode: 32 }, E: { key: 'e', code: 'KeyE', keyCode: 69 },
  F: { key: 'f', code: 'KeyF', keyCode: 70 }, Shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 }
}

function duration(value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 5000) throw new Error('durationMs must be between 0 and 5000.')
  return value
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    signal.throwIfAborted()
    await new Promise((resolve) => setTimeout(resolve, Math.min(50, until - Date.now())))
  }
  signal.throwIfAborted()
}

function canvas(): HTMLCanvasElement {
  const target = getEngineWindow().document.querySelector('canvas')
  if (target === null) throw new Error('The engine canvas is not available for playtesting.')
  target.focus()
  return target
}

async function input(keys: unknown, ms: number, signal: AbortSignal): Promise<void> {
  if (!Array.isArray(keys) || keys.length > 4 || keys.some((key) => typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(KEYS, key))) {
    throw new Error('Choose up to four keys: W, A, S, D, Space, E, F, Shift.')
  }
  const target = canvas()
  const held = [...new Set(keys as string[])]
  try {
    for (const key of held) target.dispatchEvent(new KeyboardEvent('keydown', { ...KEYS[key], bubbles: true }))
    await wait(ms, signal)
  } finally {
    for (const key of held) target.dispatchEvent(new KeyboardEvent('keyup', { ...KEYS[key], bubbles: true }))
  }
}

async function status(): Promise<unknown> {
  const [position, snapshot, logs] = await Promise.all([consoleCommand('player_position'), cmd.crdtSnapshot(), cmd.sceneLogs(100)])
  const hud = [...new Set(Object.values(snapshot).flatMap((components) => {
    const text = components.UiText
    return object(text) && typeof text.value === 'string' ? [text.value] : []
  }))].slice(0, 80)
  return {
    playing: !state.frozen,
    position: playerPosition(position),
    hud, errors: errorLines(logs).slice(-20),
    serverErrors: hostV1()?.previewServerLogs?.(0).filter(isServerError).slice(-20).map((line) => line.msg) ?? []
  }
}

async function jumpTo(to: Point, signal: AbortSignal): Promise<void> {
  const snapshot = await cmd.crdtSnapshot()
  const transform = snapshot['2']?.Transform
  const rotation = object(transform) && object(transform.rotation) ? transform.rotation : null
  if (rotation === null || ![rotation.x, rotation.y, rotation.z, rotation.w].every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('The player camera orientation is unavailable.')
  const camera = { x: Number(rotation.x), y: Number(rotation.y), z: Number(rotation.z), w: Number(rotation.w) }
  const target = canvas()
  const held = new Set<string>()
  const setKeys = (keys: string[]) => {
    for (const key of held) if (!keys.includes(key)) {
      target.dispatchEvent(new KeyboardEvent('keyup', { ...KEYS[key], bubbles: true }))
      held.delete(key)
    }
    for (const key of keys) if (!held.has(key)) {
      held.add(key)
      target.dispatchEvent(new KeyboardEvent('keydown', { ...KEYS[key], bubbles: true }))
    }
  }
  const end = Date.now() + 5000
  await steerJump(to, camera, {
    keys: setKeys,
    position: async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const raw = await Promise.race([
          consoleCommand('player_position'),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Player position timed out.')), Math.max(1, end - Date.now())) })
        ])
        return playerPosition(raw)
      } finally { clearTimeout(timer) }
    }
  }, signal)
}

export async function playtest(request: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted()
  const action = request.action
  if (action === 'start') {
    await restartScene()
    signal.throwIfAborted()
    await uiPlay()
    await syncFrozenState()
    if (state.frozen) throw new Error(`Play did not start: ${state.saveStatus}`)
    await wait(1200, signal)
  } else if (action === 'stop') {
    await restartScene()
  } else if (action !== 'status') {
    if (state.frozen) throw new Error('Start playtesting before sending player input.')
    if (action === 'input') await input(request.keys, duration(request.durationMs, 300), signal)
    else if (action === 'wait') await wait(duration(request.durationMs, 1000), signal)
    else if (action === 'walk') {
      const to = request.to
      if (!object(to) || ![to.x, to.y, to.z].every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('walk requires a finite to: {x, y, z} in world metres.')
      if (request.jump === true) await jumpTo({ x: Number(to.x), y: Number(to.y), z: Number(to.z) }, signal)
      else {
        await consoleCommand('walk_player_to', [String(to.x), String(to.y), String(to.z), '5']).catch(async () => {
          const at = await consoleCommand('player_position').catch(() => 'unknown')
          throw new Error(`The walk stopped before ${to.x} ${to.y} ${to.z}: something blocks the way or the target is higher than a step. The player is at ${at}. Walk around it, or use jump:true to reach a platform.`)
        })
      }
    } else if (action === 'click') {
      const { x, y } = request
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) throw new Error('click x and y must be fractions of the viewport from 0 to 1.')
      const target = canvas()
      const rect = target.getBoundingClientRect()
      // Bevy expects canvas pixels for synthetic pointer events, including on Retina displays.
      const point = { clientX: rect.left + x * target.width, clientY: rect.top + y * target.height, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }
      target.dispatchEvent(new PointerEvent('pointermove', point))
      try {
        target.dispatchEvent(new PointerEvent('pointerdown', { ...point, button: 0, buttons: 1 }))
        await wait(100, signal)
      } finally {
        target.dispatchEvent(new PointerEvent('pointerup', { ...point, button: 0, buttons: 0 }))
      }
    } else throw new Error('Unknown playtest action.')
    await wait(300, signal)
  }
  return status()
}
