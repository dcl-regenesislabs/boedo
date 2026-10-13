import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { checkCanvasSize, stripVertexColors } from './build-passes'

describe('a model build', () => {
  it('takes only power-of-two canvas sides up to 512', () => {
    expect(() => checkCanvasSize(512, 64)).not.toThrow()
    for (const [w, h] of [[300, 128], [1024, 512], [256, 0], [128.5, 128]]) expect(() => checkCanvasSize(w, h)).toThrow(/power of two up to 512/)
  })

  it('drops vertex and instance colours and says so', () => {
    const geometry = new THREE.BoxGeometry()
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3), 3))
    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(), undefined, 2)
    instanced.setColorAt(0, new THREE.Color('red'))
    const root = new THREE.Group().add(new THREE.Mesh(geometry), instanced, new THREE.Mesh(new THREE.BoxGeometry()))
    expect(stripVertexColors(root)).toEqual([expect.stringMatching(/^Removed vertex colours from 2 parts/)])
    expect(geometry.getAttribute('color')).toBeUndefined()
    expect(instanced.instanceColor).toBeNull()
  })
})
