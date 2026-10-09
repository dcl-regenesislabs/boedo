import { state, setSnapshotComponents, type Snapshot } from '@scene/state'
import { subscribe } from '@scene/reactive'
import { createUiTheme, type UiAppearance, type UiColorToken } from '../../../desktop/runtime-modules/pure/uiTheme'
import { scriptsOn } from '../script/references'
import { parseLayout } from '../script/parser'
import { isRecord } from '../prefabs/format'
import { cmd } from './cmd'
import { log } from '../log'

interface ThemeSettings { accent: string; appearance: UiAppearance }
interface ThemePatch { id: string; name: string; value: Record<string, unknown> }

function themeSettings(snapshot: Snapshot): ThemeSettings | undefined {
  for (const id of Object.keys(snapshot).sort((a, b) => Number(a) - Number(b))) {
    const script = scriptsOn(snapshot, id).find(s => /\/ui-theme\.ts$/.test(s.path))
    if (script === undefined) continue
    const params = parseLayout(script.layout)?.params
    return {
      accent: typeof params?.accentColor?.value === 'string' ? params.accentColor.value : '#FF2D55',
      appearance: params?.appearance?.value === 'Light' ? 'Light' : 'Dark'
    }
  }
}

// Snapshot components are replaced on write, so a malformed binding warns once per value.
const reportedBindings = new WeakSet<object>()

function themePreviewPatches(snapshot: Snapshot): ThemePatch[] {
  const settings = themeSettings(snapshot)
  const patches: ThemePatch[] = []
  for (const [id, components] of Object.entries(snapshot)) {
    const component = components['editor::UiThemeBinding']
    if (!isRecord(component) || typeof component.value !== 'string') continue
    let bindings: unknown
    try { bindings = JSON.parse(component.value) } catch (error) {
      if (!reportedBindings.has(component)) log.warn(`skipping malformed editor::UiThemeBinding on entity ${id}`, error)
      reportedBindings.add(component)
      continue
    }
    if (!isRecord(bindings)) continue
    for (const [role, binding] of Object.entries(bindings)) {
      if (!isRecord(binding) || typeof binding.token !== 'string' || typeof binding.fallbackAccent !== 'string') continue
      const theme = createUiTheme(settings?.accent ?? binding.fallbackAccent, settings?.appearance ?? 'Dark')
      if (!Object.prototype.hasOwnProperty.call(theme, binding.token) || binding.token === 'radius' || binding.token === 'gap') continue
      const color = theme[binding.token as UiColorToken]
      const name = role === 'text' ? 'UiText' : role === 'background' ? 'UiBackground' : role === 'border' ? 'UiTransform' : undefined
      const before = name === undefined ? undefined : components[name]
      if (name === undefined || !isRecord(before)) continue
      const fields = role === 'border' ? ['borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor'] : ['color']
      const unchanged = fields.every(field => {
        const previous = before[field]
        return isRecord(previous) && (['r', 'g', 'b', 'a'] as const).every(channel =>
          typeof previous[channel] === 'number' && Math.abs(previous[channel] - color[channel]) < 0.000001)
      })
      if (unchanged) continue
      const value = { ...before }
      for (const field of fields) value[field] = color
      patches.push({ id, name, value })
    }
  }
  return patches
}

export function startThemePreview(): () => void {
  let stopped = false
  let running = false
  let pending = false
  let generation = 0
  let scene = state.scene
  let frozen = state.frozen
  let snapshot = state.snapshot
  const eligible = () => !stopped && state.status === 'ready' && state.frozen
  const drain = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      while (pending && eligible()) {
        pending = false
        const current = generation
        const sent: Array<ThemePatch & { before: unknown }> = []
        try {
          for (const patch of themePreviewPatches(state.snapshot)) {
            if (current !== generation || !eligible()) break
            const before = state.snapshot[patch.id]?.[patch.name]
            await cmd.setComponent(patch.id, patch.name, JSON.stringify(patch.value))
            if (current !== generation || !eligible()) break
            sent.push({ ...patch, before })
          }
        } finally {
          setSnapshotComponents(sent.filter(patch => state.snapshot[patch.id]?.[patch.name] === patch.before))
        }
      }
    } catch (error) {
      log.warn('could not preview the scene UI theme', error)
    } finally { running = false }
  }
  const check = (): void => {
    const changed = scene !== state.scene || frozen !== state.frozen
    if (changed) {
      generation++
      scene = state.scene
      frozen = state.frozen
    }
    if ((!changed && snapshot === state.snapshot) || !eligible()) return
    snapshot = state.snapshot
    pending = true
    void drain()
  }
  const unsubscribe = subscribe(check)
  pending = true
  void drain()
  return () => { stopped = true; generation++; unsubscribe() }
}
