// The Script card stands on every authored entity, component or not: a creator
// who has to find "asset-packs::Script" in the icon-only component picker never
// finds it at all, which is why a scriptless entity used to answer "what does
// this do?" with "No components on this entity".
import { SCRIPT_COMPONENT } from '@scene/allowed-components'
import { isReservedEntity } from '@dcl-editor/contract'
import { reactive } from '../core/store'

// Scene root, Player and Camera are engine surfaces, not entities a creator writes scripts for.
export function isAuthoredEntity(entityId: string): boolean {
  return Number.isFinite(Number(entityId)) && !isReservedEntity(entityId)
}

// Whether the inspector draws a Script card for an entity that has no Script
// component yet. The first script created through it adds the component. A
// code-spawned entity is left out: the code rebuilds it on every run, so a
// script attached here would not survive to the next one.
export function synthesizesScriptCard(
  entityId: string,
  comps: Record<string, unknown> | undefined,
  isCode: boolean
): boolean {
  return !isCode && isAuthoredEntity(entityId) && comps?.[SCRIPT_COMPONENT] === undefined
}

// The right-click gesture has to land ON the button that creates the script:
// opening the card and leaving the creator to hunt for its primary action is the
// same burial the card exists to end. The nonce lets the same entity be asked
// twice; the card clears it once the focus has been taken.
export const scriptFocus = reactive<{ entityId: string | null; nonce: number }>({
  entityId: null,
  nonce: 0
})

export function focusScriptCreate(entityId: string): void {
  scriptFocus.entityId = entityId
  scriptFocus.nonce++
}

export function clearScriptFocus(): void {
  if (scriptFocus.entityId !== null) scriptFocus.entityId = null
}

// Same shape as the menu's other code-entity refusals (entity-menu.ts): what the
// code does, and therefore why the gesture would not stick.
export const TIP_ADD_SCRIPT =
  'Your code rebuilds this on every run, so a script added here would be gone the next time it starts.'
