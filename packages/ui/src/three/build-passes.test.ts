import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { checkCanvasSize, mergeStatic, partNamer, singleSided, stripVertexColors } from './build-passes'

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

  it('gives a double-sided part a one-sided back copy and turns a back-sided part around', () => {
    const plane = new THREE.PlaneGeometry()
    const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })
    const card = new THREE.Mesh(plane, material)
    card.position.set(1, 2, 3)
    const inside = new THREE.Mesh(plane, new THREE.MeshStandardMaterial({ side: THREE.BackSide }))
    singleSided(new THREE.Group().add(card, inside))
    const [back] = card.children
    expect(back).toBeInstanceOf(THREE.Mesh)
    expect(back.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([1, 2, 3])
    for (const mesh of [back, inside] as THREE.Mesh[]) {
      expect([...(mesh.geometry.index?.array ?? [])].slice(0, 3)).toEqual([0, 1, 2])
      expect(mesh.geometry.getAttribute('normal').getZ(0)).toBe(-1)
      expect(sidesOf(mesh)).toEqual([THREE.FrontSide])
    }
    expect([...(plane.index?.array ?? [])].slice(0, 3)).toEqual([0, 2, 1])
    expect(material.side).toBe(THREE.FrontSide)
  })

  it('names unnamed parts <Model>_PartNN, keeps the script\'s names and never makes a collider name', () => {
    const namer = partNamer('gate_collider')
    const pivot = namer.name(new THREE.Group())
    const door = Object.assign(new THREE.Mesh(), { name: 'Door' })
    const root = new THREE.Group().add(Object.assign(new THREE.Group(), { name: pivot }).add(new THREE.Mesh()), door,
      Object.assign(new THREE.Mesh(), { name: 'GateCollider_Part02' }))
    namer.nameAll(root)
    expect(pivot).toBe('GateCollider_Part01')
    expect(root.name).toBe('')
    expect(root.children.map((node) => node.name)).toEqual(['GateCollider_Part01', 'Door', 'GateCollider_Part02'])
    expect(root.children[0].children[0].name).toBe('GateCollider_Part03')
  })

  it('merges five or more static unnamed parts sharing a material, in place, and leaves the rest', () => {
    const material = new THREE.MeshStandardMaterial()
    const box = new THREE.BoxGeometry()
    const root = new THREE.Group()
    root.position.set(0, 1, 0)
    const parts = [0, 1, 2, 3, 4].map((x) => {
      const part = new THREE.Mesh(box, material)
      part.position.x = x * 2
      return part
    })
    parts[1].scale.set(-1, 1, 1)
    const knob = Object.assign(new THREE.Mesh(box, new THREE.MeshBasicMaterial()), { name: 'Knob' })
    knob.position.y = 1
    parts[1].add(knob)
    const wheel = Object.assign(new THREE.Mesh(box, material), { name: 'Wheel' })
    const other = [0, 1, 2, 3].map(() => new THREE.Mesh(box, new THREE.MeshBasicMaterial()))
    const group = new THREE.Group().add(...parts)
    root.add(group, wheel, ...other)
    const clip = new THREE.AnimationClip('Spin', 1, [new THREE.NumberKeyframeTrack('Wheel.position[x]', [0], [0])])
    root.updateMatrixWorld(true)
    const before = new THREE.Box3().setFromObject(root)
    mergeStatic(root, [clip])
    const merged = root.children.at(-1) as THREE.Mesh
    expect(root.children.map((node) => node.uuid)).toEqual([group, wheel, ...other, merged].map((node) => node.uuid))
    expect(merged.geometry.getAttribute('position').count).toBe(5 * box.getAttribute('position').count)
    expect(new THREE.Box3().setFromObject(root)).toEqual(before)
    expect(group.children).toEqual([knob])
    expect(knob.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([2, 2, 0])
    // every face still faces the way its normals say
    const { position, normal } = merged.geometry.attributes
    const index = merged.geometry.index?.array ?? []
    const [a, b, c, n] = [0, 1, 2, 3].map(() => new THREE.Vector3())
    for (let i = 0; i < index.length; i += 3) {
      a.fromBufferAttribute(position, index[i]); b.fromBufferAttribute(position, index[i + 1]); c.fromBufferAttribute(position, index[i + 2])
      expect(n.subVectors(c, b).cross(a.clone().sub(b)).dot(new THREE.Vector3().fromBufferAttribute(normal, index[i]))).toBeGreaterThan(0)
    }
  })
})

const sidesOf = (mesh: THREE.Mesh): THREE.Side[] => [mesh.material].flat().map((m) => m.side)
