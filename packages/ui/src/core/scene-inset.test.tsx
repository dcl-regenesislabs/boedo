import { expect, it, vi } from 'vitest'
import { mount } from '../test/render'
import { BevyApi } from '../engine/bevy-api-web'
import { useSceneInsetRef, type InsetSide } from './scene-inset'

// happy-dom lays nothing out, so each panel's rect comes from its props
function Panel(props: { side: InsetSide; rect: { left: number; right: number; bottom: number } }): JSX.Element {
  const insetRef = useSceneInsetRef(props.side)
  return <div ref={(el) => {
    if (el !== null) el.getBoundingClientRect = () => ({ ...props.rect, top: 0, width: props.rect.right - props.rect.left, height: 40, x: 0, y: 0, toJSON: () => ({}) })
    insetRef(el)
  }} />
}

it('tells the engine the space the editor panels leave, following them as they open and close', async () => {
  Object.assign(window, { innerWidth: 1920 })
  const setSceneInset = vi.spyOn(BevyApi, 'setInteractableArea').mockImplementation(() => {})
  const view = mount(<>
    <Panel side="left" rect={{ left: 12, right: 312, bottom: 1000 }} />
    <Panel side="right" rect={{ left: 1580, right: 1920, bottom: 1080 }} />
    <Panel side="top" rect={{ left: 700, right: 1200, bottom: 106 }} />
  </>)
  await view.settle()
  expect(setSceneInset).toHaveBeenLastCalledWith({ left: 312, top: 106, right: 340, bottom: 0 })

  view.render(<Panel side="top" rect={{ left: 700, right: 1200, bottom: 106 }} />)
  await view.settle()
  expect(setSceneInset).toHaveBeenLastCalledWith({ left: 0, top: 106, right: 0, bottom: 0 })
  view.unmount()
})
