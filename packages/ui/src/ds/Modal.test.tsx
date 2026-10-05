import { describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'
import { mount } from '../test/render'
import { act } from 'react'

const press = (target: Element | null): void => {
  if (target === null) throw new Error('press: target not found')
  act(() => {
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  })
}

describe('Modal scrim close', () => {
  it('closes on a click that starts and ends on the scrim', () => {
    const onClose = vi.fn()
    const view = mount(
      <Modal title="t" onClose={onClose}>
        <input />
      </Modal>
    )
    const scrim = view.find('.eui-modal-backdrop')
    press(scrim)
    view.click(scrim)
    expect(onClose).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('stays open when a press starts inside and releases on the scrim', () => {
    const onClose = vi.fn()
    const view = mount(
      <Modal title="t" onClose={onClose}>
        <input />
      </Modal>
    )
    press(view.find('input'))
    // a press/release across elements fires click on their common ancestor
    view.click(view.find('.eui-modal-backdrop'))
    expect(onClose).not.toHaveBeenCalled()
    view.unmount()
  })

  it('ignores the scrim entirely while scrimClose is off', () => {
    const onClose = vi.fn()
    const view = mount(
      <Modal title="t" onClose={onClose} scrimClose={false}>
        <input />
      </Modal>
    )
    const scrim = view.find('.eui-modal-backdrop')
    press(scrim)
    view.click(scrim)
    expect(onClose).not.toHaveBeenCalled()
    view.unmount()
  })
})

describe('Modal focus', () => {
  it('is a labelled dialog that keeps Tab inside and gives focus back when it closes', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const view = mount(
      <Modal title="Rename" onClose={() => {}} closeX>
        <input />
      </Modal>
    )
    const dialog = view.find('[role="dialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Rename')
    const input = view.find('input')
    input?.focus()
    act(() => {
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(view.find('.eui-modal-x'))
    view.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
