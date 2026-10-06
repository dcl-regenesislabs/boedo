import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteConfirmSkipped, skipDeleteConfirm } from '../panels/delete-confirm'
import { dismissPlayEditWarning } from './autosave'

// A host can keep the origin's storage out of the editor's process (the explorer's web shell does):
// any read throws, and the editor must keep working, only without remembering choices.
describe('editor with blocked storage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('still asks before deleting and still dismisses the play-mode warning', () => {
    vi.stubGlobal('localStorage', new Proxy({}, { get: () => { throw new Error('localStorage is not available to the app') } }))
    expect(deleteConfirmSkipped()).toBe(false)
    expect(() => skipDeleteConfirm()).not.toThrow()
    expect(() => dismissPlayEditWarning(true)).not.toThrow()
  })
})
