import { expect, it } from 'vitest'
import { publishedSize } from './deploy-size'

it('counts a file once per path but its bytes once per content, as publishing does', async () => {
  const same = new Uint8Array([1, 2, 3, 4])
  const files = new Map([['a.png', same], ['copy/a.png', new Uint8Array(same)], ['scene.json', new Uint8Array([9])]])
  expect(await publishedSize(files)).toEqual({ bytes: 5, files: 3 })
})
