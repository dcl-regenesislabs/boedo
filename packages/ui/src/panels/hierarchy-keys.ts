// The hierarchy as a keyboard tree: arrows walk the rows (the selection follows),
// Enter/Space select, Right/Left open and close, Shift+F10 or the menu key opens the menu.
import type { KeyboardEvent } from 'react'
import { uiSelectEntity } from '../actions/selection'
import { isMod } from '../lib/keys'

export function treeRows(tree: Element | null): HTMLElement[] {
  return [...(tree?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])]
}

export function focusRow(row: HTMLElement | undefined): void {
  const id = row?.dataset.entity
  if (row === undefined || id === undefined) return
  uiSelectEntity(id, false, false)
  row.focus()
  row.scrollIntoView({ block: 'nearest' })
}

export function onTreeRowKey(
  e: KeyboardEvent<HTMLElement>,
  row: { id: string; depth: number; hasKids: boolean; expanded: boolean; toggle: () => void; openMenu: (at: { x: number; y: number }) => void }
): void {
  // a key the editor already answered (Return renames on a Mac) is not the row's
  if (e.target !== e.currentTarget || e.defaultPrevented) return
  const el = e.currentTarget
  const rows = treeRows(el.closest('[role="tree"]'))
  const at = rows.indexOf(el)
  const key = e.key === 'F10' && e.shiftKey ? 'ContextMenu' : e.key
  if (key === 'Enter' || key === ' ') uiSelectEntity(row.id, e.shiftKey, isMod(e))
  else if (key === 'ArrowDown') focusRow(rows[at + 1])
  else if (key === 'ArrowUp') focusRow(rows[at - 1])
  else if (key === 'Home') focusRow(rows[0])
  else if (key === 'End') focusRow(rows.at(-1))
  else if (key === 'ArrowRight' && row.hasKids && !row.expanded) row.toggle()
  else if (key === 'ArrowRight') focusRow(row.hasKids ? rows[at + 1] : undefined)
  else if (key === 'ArrowLeft' && row.hasKids && row.expanded) row.toggle()
  else if (key === 'ArrowLeft') focusRow(rows.slice(0, at).reverse().find((r) => Number(r.getAttribute('aria-level')) < row.depth + 1))
  else if (key === 'ContextMenu') {
    const r = el.getBoundingClientRect()
    row.openMenu({ x: r.left + 24, y: r.bottom })
  } else return
  e.preventDefault()
  e.stopPropagation()
}
