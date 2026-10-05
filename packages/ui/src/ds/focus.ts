// What Tab can land on inside `root`, in document order.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

export function focusables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.closest('[hidden], [inert]') === null)
}

// Tab and Shift+Tab cycle inside `box` instead of leaving it.
export function cycleFocus(e: { key: string; shiftKey: boolean; preventDefault(): void }, box: HTMLElement): void {
  if (e.key !== 'Tab') return
  const items = focusables(box)
  const root = box.getRootNode() as Document | ShadowRoot
  const active = root.activeElement
  if (items.length === 0) {
    e.preventDefault()
    box.focus()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  if (e.shiftKey && (active === first || active === box)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}
