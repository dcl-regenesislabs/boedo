import { readKey, writeKey } from '../core/persist'
// The Delete key's "are you sure", and the opt-out for creators who don't want
// to be asked. Split out of Dialogs.tsx because shortcuts.ts reads the opt-out
// and must not pull a React module into the keydown path.
const SKIP_KEY = 'eui:delete-confirm-skipped'

export function deleteConfirmSkipped(): boolean {
  return readKey(SKIP_KEY) === '1'
}

export function skipDeleteConfirm(): void {
  writeKey(SKIP_KEY, '1')
}
