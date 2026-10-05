import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NAME_COMPONENT } from '@scene/custom-components'
import { state, type Snapshot } from '@scene/state'
import { HierarchyPanel } from './HierarchyPanel'
import { act } from 'react'
import { mount } from '../test/render'

const ZOMBIE_ID = 'a1'

const row = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  [NAME_COMPONENT]: { value: name },
  Transform: {},
  ...extra
})

function panel(): ReturnType<typeof mount> {
  return mount(
    <HierarchyPanel
      onNewEntity={() => {}}
      onCreatePrefab={() => {}}
      onView={() => {}}
    />
  )
}

function marksOf(view: ReturnType<typeof mount>, name: string): string[] {
  const label = view.all('.eui-row .label').find((el) => el.textContent?.includes(name) === true)
  const marks = label?.parentElement?.querySelector('.row-marks')
  return Array.from(marks?.querySelectorAll('.eui-ds-chip') ?? []).map((c) => c.textContent ?? '')
}

beforeEach(() => {
  state.status = 'ready'
  state.snapshot = {}
  state.selected = new Set<string>()
  state.expandedEntities = new Set<string>()
})

afterEach(() => {
  state.snapshot = {}
  state.selected = new Set<string>()
})

describe('HierarchyPanel prefab button', () => {
  it('says what the button would do once something is selected', () => {
    state.snapshot = { '512': row('Bench') } as Snapshot
    state.selected = new Set(['512'])
    const view = panel()
    const button = view.find('.eui-head-actions .eui-btn.icon:not([disabled])[data-tip]')
    expect(view.all('[data-tip="Create a prefab from the selection"]')).toHaveLength(1)
    expect(button).not.toBeNull()
    view.unmount()
  })

  it('says what is missing while nothing is selected, instead of going quiet', () => {
    state.snapshot = { '512': row('Bench') } as Snapshot
    state.selected = new Set<string>()
    const view = panel()
    const button = view.find('[data-tip="Select entities to create a prefab from them"]')
    expect(button?.hasAttribute('disabled')).toBe(true)
    view.unmount()
  })
})

describe('HierarchyPanel Game Config', () => {
  it('reaches the scene root Game Config, which the tree itself never shows', () => {
    state.snapshot = { '0': { 'inspector::Nodes': {} }, '512': row('Bench') } as Snapshot
    const view = panel()
    // the root is not a row — the head button is the only way in. The two
    // folders are always here, so the entity row is the only NON-folder one.
    expect(view.all('.eui-row:not(.eui-tree-folder)')).toHaveLength(1)
    expect(view.find('.eui-modal')).toBeNull()
    view.click(view.find('[aria-label="Game Config"]'))
    expect(view.find('.eui-modal')?.textContent).toContain('Game Config')
    view.unmount()
  })
})

describe('HierarchyPanel keyboard', () => {
  it('rows are a tree the arrows walk, selecting as they go, and Shift+F10 opens the row menu', () => {
    state.snapshot = { '512': row('Bench'), '513': row('Lamp') } as Snapshot
    const view = panel()
    const items = view.all('[role="treeitem"]')
    expect(items.map((el) => el.getAttribute('aria-selected'))).toEqual(['false', 'false'])
    const press = (target: HTMLElement, key: string, shiftKey = false): void => {
      act(() => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
      })
    }
    press(items[0], 'Enter')
    press(view.all('[role="treeitem"]')[0], 'ArrowDown')
    expect([...state.selected]).toEqual([view.all('[role="treeitem"]')[1].dataset.entity])
    expect(view.all('[role="treeitem"]').map((el) => el.getAttribute('tabindex'))).toEqual(['-1', '0'])
    press(view.all('[role="treeitem"]')[1], 'F10', true)
    expect(view.find('.eui-ctx')).not.toBeNull()
    view.unmount()
  })
})
