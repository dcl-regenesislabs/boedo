import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { connectPreview } from './preview-cdp.mjs'
import { movementKeys, playerPosition, steerJump } from './movement-keys.ts'

const { values } = parseArgs({ options: {
  cdp: { type: 'string', default: 'http://127.0.0.1:9222' },
  frame: { type: 'string', default: '/app.html' },
  out: { type: 'string', default: '/tmp/bevy-preview-report' },
  prompt: { type: 'string' }, scenario: { type: 'string' },
  timeout: { type: 'string', default: '120' }, help: { type: 'boolean' }
} })
if (values.help) {
  console.log('Attach to an open local preview: --cdp URL --out DIR [--prompt FILE] [--scenario JSON] [--timeout SECONDS]. No prompt means no model call. Leaves the browser open.')
  process.exit(0)
}
const endpoint = new URL(values.cdp)
if (!['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('Use a local browser CDP endpoint.')
const timeout = Number(values.timeout) * 1000
if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 1800000) throw new Error('timeout must be 1–1800 seconds.')
const invocationDir = process.env.INIT_CWD ?? process.cwd()
const inputPath = (value) => path.resolve(invocationDir, value)
const out = inputPath(values.out)
await fs.mkdir(out, { recursive: true, mode: 0o700 })
const report = { checks: [], gameplayAssertions: 0, assistant: null }
let frame
const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function check(name, run) {
  const start = Date.now()
  try {
    const detail = await run()
    report.checks.push({ name, ok: true, ms: Date.now() - start, detail })
    console.log(`PASS ${name}`)
  } catch (error) {
    report.checks.push({ name, ok: false, ms: Date.now() - start, error: error.message, detail: error.cause })
    console.log(`FAIL ${name}: ${error.message}`)
    if (frame) await frame.screenshot().then((png) => fs.writeFile(path.join(out, 'failure.png'), png, { mode: 0o600 })).catch((captureError) => {
      console.warn(`[preview] Failure screenshot unavailable: ${captureError.message}`)
    })
    throw error
  } finally { await save() }
}
const command = (line) => frame.evaluate(async (line) => {
  return await Promise.race([
    window.engine_console_command(line),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Engine command timed out')), 15000))
  ])
}, line)

try {
  await check('connect', async () => {
    frame = await connectPreview(values.cdp, values.frame)
    if (!await frame.evaluate(() => !!window.editorShell && !!document.querySelector('#editor-ui-host'))) throw new Error('Enter the world and open a project in the editor before running preview checks.')
    await command('/player_position')
    return 'Existing browser and service; credentials stay in the service.'
  })
  await check('repeated engine screenshots', async () => {
    const samples = []
    for (let index = 0; index < 3; index++) {
      const { lit, png } = await frame.evaluate(async () => {
        const base64 = (await Promise.race([
          window.engine_console_command('/screenshot'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Engine screenshot timed out')), 15000))
        ])).trim()
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = new OffscreenCanvas(32, 32)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(bitmap, 0, 0, 32, 32)
        bitmap.close()
        const { data } = ctx.getImageData(0, 0, 32, 32)
        let lit = 0
        for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 24) lit++
        return { lit, png: lit < 10 ? base64 : null }
      })
      samples.push(lit)
      if (lit < 10) {
        await fs.writeFile(path.join(out, 'engine-failure.png'), Buffer.from(png, 'base64'), { mode: 0o600 })
        throw new Error(`Capture ${index + 1} is nearly black (${lit}/1024 lit samples). Check renderer before editing the scene.`)
      }
      await pause(300)
    }
    return { litSamples: samples }
  })
  if (values.prompt) await check('assistant turn', async () => {
    const prompt = await fs.readFile(inputPath(values.prompt), 'utf8')
    await frame.evaluate(() => {
      const stats = window.__previewRun = { tools: {}, errors: [], done: null }
      window.__previewUnsubscribe = window.editorShell.onAiEvent((event) => {
        if (event.kind === 'tool') stats.tools[event.tool] = (stats.tools[event.tool] ?? 0) + 1
        if (event.kind === 'error') stats.errors.push(event.message)
        if (event.kind === 'done') stats.done = event.ok
      })
    })
    try {
      await frame.evaluate((text) => {
        const root = document.querySelector('#editor-ui-host')?.shadowRoot
        const textarea = [...root.querySelectorAll('textarea')].at(-1)
        if (!textarea) throw new Error('Open the assistant panel first.')
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, text)
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      }, prompt)
      await pause(200)
      await frame.evaluate(() => {
        const send = document.querySelector('#editor-ui-host')?.shadowRoot?.querySelector('[aria-label="Send"]')
        if (!send || send.disabled) throw new Error('Assistant Send button unavailable.')
        send.click()
      })
      const end = Date.now() + timeout
      let lastStatus = 0
      while (Date.now() < end) {
        report.assistant = await frame.evaluate(() => window.__previewRun)
        if (report.assistant.done !== null) {
          if (!report.assistant.done) throw new Error(report.assistant.errors.at(-1) ?? 'Assistant turn failed')
          return report.assistant
        }
        if (Date.now() - lastStatus > 30000) {
          console.log(`Assistant working: ${Object.values(report.assistant.tools).reduce((a, b) => a + b, 0)} tool calls`)
          lastStatus = Date.now()
          await save()
        }
        await pause(1000)
      }
      await frame.evaluate(() => window.editorShell.aiStop())
      throw new Error('Assistant deadline reached; turn stopped. Inspect the saved scene before retrying.')
    } finally { await frame.evaluate(() => window.__previewUnsubscribe?.()) }
  })
  if (values.scenario) {
    const scenario = JSON.parse(await fs.readFile(inputPath(values.scenario), 'utf8'))
    for (const step of scenario.steps) await check(step.name, async () => {
      if (!(Array.isArray(step.hud) && step.hud.length > 0 && step.hud.every((text) => typeof text === 'string' && text.length > 0)) && !step.position) throw new Error('Each gameplay step needs a nonempty HUD or position assertion.')
      if (step.position && (!['x', 'y', 'z'].every((axis) => Number.isFinite(step.position[axis])) || !Number.isFinite(step.position.tolerance ?? 1) || (step.position.tolerance ?? 1) < 0)) throw new Error('Position requires finite x/y/z and a nonnegative tolerance.')
      if (step.click && !['x', 'y'].every((axis) => Number.isFinite(step.click[axis]) && step.click[axis] >= 0)) throw new Error('Click requires positive viewport pixel coordinates.')
      const ms = step.durationMs ?? 300
      if (!Number.isFinite(ms) || ms < 0 || ms > 5000) throw new Error('durationMs must be 0–5000.')
      if (step.walk && !['x', 'y', 'z'].every((axis) => Number.isFinite(step.walk[axis]))) throw new Error('Walk requires finite x/y/z.')
      if (step.toward && !['x', 'y', 'z'].every((axis) => Number.isFinite(step.toward[axis]))) throw new Error('toward requires finite x/y/z.')
      if (step.keys && (!Array.isArray(step.keys) || step.keys.length > 4 || step.keys.some((key) => !['w', 'a', 's', 'd', 'Space', 'e', 'f', 'Shift'].includes(key)))) throw new Error('Choose up to four supported gameplay keys.')
      const settleMs = step.settleMs ?? 300
      if (!Number.isFinite(settleMs) || settleMs < 0 || settleMs > 5000) throw new Error('settleMs must be 0–5000.')
      if (step.click) await frame.click(step.click.x, step.click.y)
      let keys = step.keys
      if (step.toward) {
        const snapshot = JSON.parse(await command('/crdt_snapshot'))
        const camera = snapshot['2']?.Transform?.rotation
        const from = playerPosition(await command('/player_position'))
        if (!camera || !from) throw new Error('Player position or camera unavailable.')
        keys = movementKeys(from, step.toward, camera)
      }
      const input = async () => {
        if (keys) {
          await frame.evaluate(() => document.querySelector('canvas').focus())
          try {
            await frame.keys(keys.map(key => ({ key, down: true })))
            await pause(ms)
          } finally { await frame.keys(keys.map(key => ({ key, down: false }))) }
        } else await pause(ms)
      }
      if (step.walk && step.jump) {
        const snapshot = JSON.parse(await command('/crdt_snapshot'))
        const camera = snapshot['2']?.Transform?.rotation
        if (!camera) throw new Error('Player camera unavailable.')
        const held = new Set()
        await steerJump(step.walk, camera, {
          position: async () => playerPosition(await command('/player_position')),
          keys: async (keys) => {
            const changes = []
            for (const key of held) if (!keys.includes(key)) { changes.push({ key, down: false }); held.delete(key) }
            for (const key of keys) if (!held.has(key)) { changes.push({ key, down: true }); held.add(key) }
            if (changes.length) await frame.keys(changes)
          }
        }, AbortSignal.timeout(6000))
      } else {
        await input()
        if (step.walk) await command(`/walk_player_to ${step.walk.x} ${step.walk.y} ${step.walk.z} 5`)
      }
      await pause(settleMs)
      const position = await command('/player_position')
      const snapshot = JSON.parse(await command('/crdt_snapshot'))
      const hud = [...new Set(Object.values(snapshot).flatMap((components) => typeof components.UiText?.value === 'string' ? [components.UiText.value] : []))]
      const visibility = Object.fromEntries([...(step.hidden ?? []), ...(step.shown ?? [])].map(id => [id, snapshot[id]?.VisibilityComponent]))
      const observed = { position, hud, ...(Object.keys(visibility).length ? { visibility } : {}) }
      for (const [ids, visible] of [[step.hidden ?? [], false], [step.shown ?? [], true]]) {
        for (const id of ids) if (visibility[id]?.visible !== visible || visibility[id]?.propagateToChildren !== true) throw new Error(`Entity ${id} and its children should be ${visible ? 'visible' : 'hidden'}`, { cause: observed })
      }
      for (const expected of step.hud ?? []) if (!hud.some((line) => line.includes(expected))) throw new Error(`HUD missing: ${expected}`, { cause: observed })
      for (const forbidden of step.notHud ?? []) if (hud.some((line) => line.includes(forbidden))) throw new Error(`Unexpected HUD: ${forbidden}`, { cause: observed })
      if (step.position) {
        const parsed = /\(\s*([-\d.e+]+),\s*([-\d.e+]+),\s*([-\d.e+]+)\s*\)/i.exec(position)
        if (!parsed || Math.hypot(...['x', 'y', 'z'].map((axis, i) => Number(parsed[i + 1]) - step.position[axis])) > (step.position.tolerance ?? 1)) throw new Error(`Unexpected player position: ${position}`, { cause: observed })
      }
      report.gameplayAssertions++
      return observed
    })
  }
} catch (error) {
  process.exitCode = 1
  if (report.checks.at(-1)?.ok !== false) {
    const message = error instanceof Error ? error.message : String(error)
    report.checks.push({ name: 'harness', ok: false, ms: 0, error: message })
    console.error(`FAIL harness: ${message}`)
  }
}
await save()
frame?.close()
console.log(`${report.checks.filter((check) => check.ok).length}/${report.checks.length} checks passed; ${report.gameplayAssertions} gameplay assertions. Report: ${path.join(out, 'report.json')}`)
// Disconnect CDP without closing the user's browser or its unsaved project.
process.exit(process.exitCode ?? 0)
