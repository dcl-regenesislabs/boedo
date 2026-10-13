// Curated views for the core visual components (Material, meshes, gltf, text,
// light, nft, billboard, visibility). Each entry is a ViewConfig rendered by the
// shared CuratedView; anything not registered here falls back to SchemaEditor.
import type { ComponentView } from './types'
import { curatedView, COLLIDER_BITS, type SliderSpec, type ViewConfig } from './curated'

const pct: SliderSpec = { min: 0, max: 1, step: 0.01 }

// Material slider/label overlays at a path prefix — GltfNodeModifiers embeds the
// same Material message per node modifier ('modifiers.*.material.').
function materialSliders(prefix: string): Record<string, SliderSpec> {
  return {
    [`${prefix}material.pbr.metallic`]: pct,
    [`${prefix}material.pbr.roughness`]: pct,
    [`${prefix}material.pbr.alphaTest`]: pct,
    [`${prefix}material.unlit.alphaTest`]: pct
  }
}

const gltfContainer: ViewConfig = {
  groups: [
    { title: 'Model', fields: ['src'] },
    { title: 'Colliders', fields: ['visibleMeshesCollisionMask', 'invisibleMeshesCollisionMask'] }
  ],
  labels: {
    visibleMeshesCollisionMask: 'visible',
    invisibleMeshesCollisionMask: 'invisible'
  },
  masks: {
    visibleMeshesCollisionMask: { bits: COLLIDER_BITS, default: 0 },
    invisibleMeshesCollisionMask: { bits: COLLIDER_BITS, default: 3 }
  },
  files: { src: { ext: ['glb', 'gltf'] } },
  docs: {
    src: 'Path to the .glb/.gltf model in the scene files.',
    visibleMeshesCollisionMask: 'Which collision layers the model’s visible meshes participate in.',
    invisibleMeshesCollisionMask: 'Which collision layers the model’s invisible collider meshes participate in.'
  }
}

const gltfNodeModifiers: ViewConfig = {
  groups: [{ fields: ['modifiers'] }],
  labels: {
    modifiers: 'node modifiers',
    'modifiers.*.path': 'node path',
    'modifiers.*.material.material': 'mode'
  },
  sliders: materialSliders('modifiers.*.'),
  docs: {
    modifiers: 'Per-node overrides applied to meshes inside the loaded glTF.',
    'modifiers.*.path': 'Path of the glTF node this override targets.'
  }
}

const meshRenderer: ViewConfig = {
  groups: [{ fields: ['mesh'] }],
  labels: { mesh: 'shape' },
  docs: { mesh: 'Primitive shape rendered by the engine (box, sphere, cylinder or plane).' }
}

const meshCollider: ViewConfig = {
  groups: [{ fields: ['mesh', 'collisionMask'] }],
  labels: { mesh: 'shape', collisionMask: 'collision layers' },
  masks: { collisionMask: { bits: COLLIDER_BITS, default: 3 } },
  docs: {
    mesh: 'Primitive collider shape. Complex shapes need a GltfContainer instead.',
    collisionMask: 'Which collision layers this collider participates in.'
  }
}

const notPreviewed = ' Not shown in the editor preview; other clients may use it.'

const material: ViewConfig = {
  groups: [
    { fields: ['material'] },
    { title: 'Surface', fields: ['material.pbr.albedoColor', '@finish'] },
    { title: 'Glow', fields: ['material.pbr.emissiveColor', 'material.pbr.emissiveIntensity'] },
    { fields: ['material.pbr.texture'] },
    {
      title: 'Advanced',
      collapsed: true,
      fields: [
        'material.pbr.metallic',
        'material.pbr.roughness',
        'material.pbr.transparencyMode',
        'material.pbr.alphaTest',
        'material.pbr.castShadows',
        'material.pbr.emissiveTexture',
        'material.pbr.bumpTexture',
        'material.pbr.alphaTexture',
        'material.pbr.specularIntensity',
        'material.pbr.directIntensity',
        'material.pbr.reflectivityColor',
        'gltf'
      ]
    }
  ],
  labels: {
    material: 'mode',
    'material.pbr.albedoColor': 'color',
    'material.pbr.emissiveColor': 'color',
    'material.pbr.emissiveIntensity': 'strength',
    'material.pbr.transparencyMode': 'transparency',
    gltf: 'GLTF material',
    'gltf.gltfSrc': 'file'
  },
  presets: {
    '@finish': {
      label: 'finish',
      doc: 'How shiny the surface is. Advanced has the exact metallic and roughness.',
      options: [
        { label: 'Matte', values: { 'material.pbr.metallic': 0, 'material.pbr.roughness': 1 } },
        { label: 'Satin', values: { 'material.pbr.metallic': 0, 'material.pbr.roughness': 0.5 } },
        { label: 'Glossy', values: { 'material.pbr.metallic': 0, 'material.pbr.roughness': 0.15 } },
        { label: 'Metal', values: { 'material.pbr.metallic': 1, 'material.pbr.roughness': 0.3 } }
      ]
    }
  },
  defaults: {
    'material.pbr.metallic': 0.5,
    'material.pbr.roughness': 0.5,
    'material.pbr.emissiveIntensity': 2,
    'material.pbr.emissiveColor': { r: 0, g: 0, b: 0 },
    'material.pbr.alphaTest': 0.5
  },
  sliders: { ...materialSliders(''), 'material.pbr.emissiveIntensity': { min: 0, max: 5, step: 0.1 } },
  files: {
    'material.pbr.texture.tex.texture.src': { ext: ['png', 'jpg', 'jpeg'] },
    'material.pbr.emissiveTexture.tex.texture.src': { ext: ['png', 'jpg', 'jpeg'] },
    'material.pbr.bumpTexture.tex.texture.src': { ext: ['png', 'jpg', 'jpeg'] },
    'material.pbr.alphaTexture.tex.texture.src': { ext: ['png', 'jpg', 'jpeg'] },
    'material.unlit.texture.tex.texture.src': { ext: ['png', 'jpg', 'jpeg'] },
    'material.unlit.alphaTexture.tex.texture.src': { ext: ['png', 'jpg', 'jpeg'] },
    'gltf.gltfSrc': { ext: ['glb', 'gltf'] }
  },
  docs: {
    material: 'Lighting model: unlit (flat, ignores lights) or PBR (lit like the real world).',
    'material.pbr.albedoColor': 'Base color. A is opacity: 1 solid, 0 invisible.',
    'material.pbr.emissiveColor': 'Color the surface gives off on its own. Black means no glow.',
    'material.pbr.emissiveIntensity': 'How bright the glow is. Above about 1 it blooms and can wash out the color.',
    'material.pbr.texture': 'Image drawn over the base color.',
    'material.pbr.metallic': 'How metallic the surface is (0 dielectric → 1 metal).',
    'material.pbr.roughness': 'Surface microroughness (0 mirror → 1 matte).',
    'material.pbr.transparencyMode': 'How transparency is resolved. Auto blends when opacity is below 1.',
    'material.pbr.alphaTest': 'Alpha cutoff for alpha-test transparency. Setting it switches Auto to a cutout.',
    'material.pbr.castShadows': 'Whether the surface casts shadows.',
    'material.pbr.emissiveTexture': 'Image that drives the glow.',
    'material.pbr.bumpTexture': 'Normal map for surface detail.',
    'material.pbr.alphaTexture': 'Image whose alpha sets the opacity.',
    'material.pbr.specularIntensity': 'Strength of specular reflections.' + notPreviewed,
    'material.pbr.directIntensity': 'Intensity of direct lighting on the material.' + notPreviewed,
    'material.pbr.reflectivityColor': 'Tint of reflections on the surface.' + notPreviewed,
    gltf: 'Use a material from a glTF file. Only applies once a file is chosen.'
  }
}

const textShape: ViewConfig = {
  groups: [
    { title: 'Text', fields: ['text', 'font', 'fontSize', 'textColor', 'textAlign'] },
    {
      title: 'Layout',
      fields: [
        'width',
        'height',
        'textWrapping',
        'lineSpacing',
        'lineCount',
        'paddingTop',
        'paddingRight',
        'paddingBottom',
        'paddingLeft',
        'fontAutoSize'
      ]
    },
    {
      title: 'Effects',
      fields: ['outlineWidth', 'outlineColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'shadowColor']
    }
  ],
  docs: {
    text: 'The text content to display.',
    font: 'Typeface used to render the text.',
    fontSize: 'Font size of the text.',
    textColor: 'Color of the text.',
    textAlign: 'Horizontal and vertical alignment within the text box.',
    width: 'Available horizontal space for the text box.',
    height: 'Available vertical space for the text box.',
    textWrapping: 'Wrap text onto new lines when it reaches the border.',
    lineSpacing: 'Extra distance between lines.',
    lineCount: 'Maximum number of lines to display.',
    fontAutoSize: 'Auto-fit the font size to the width/height instead of a fixed size.',
    outlineWidth: 'Width of the stroke outlining each letter.',
    outlineColor: 'Color of the letter outline.',
    shadowBlur: 'Blurriness of the drop shadow.',
    shadowOffsetX: 'Horizontal offset of the drop shadow.',
    shadowOffsetY: 'Vertical offset of the drop shadow.',
    shadowColor: 'Color of the drop shadow.'
  }
}

const billboard: ViewConfig = {
  groups: [{ fields: ['billboardMode'] }],
  labels: { billboardMode: 'mode' },
  docs: { billboardMode: 'Which axes auto-rotate to face the camera (none, X, Y, Z, or all).' }
}

const visibility: ViewConfig = {
  groups: [{ fields: ['visible', 'propagateToChildren'] }],
  docs: {
    visible: 'Whether the entity is rendered.',
    propagateToChildren: 'Apply this visibility to descendants that have no visibility component of their own.'
  }
}

const lightSource: ViewConfig = {
  groups: [
    { title: 'Light', fields: ['active', 'color', 'intensity', 'range'] },
    { fields: ['type'] },
    { title: 'Shadows', fields: ['shadow', 'shadowMaskTexture'] }
  ],
  labels: { shadowMaskTexture: 'shadow mask' },
  docs: {
    active: 'Whether the light is on.',
    color: 'Tint of the emitted light.',
    intensity: 'Light intensity, in candela.',
    range: 'How far the light travels, in meters (-1 = unlimited).',
    type: 'Point light (radiates in all directions) or spot light (a cone).',
    shadow: 'Whether the light casts shadows.',
    shadowMaskTexture: 'Texture mask projected through the light (caustics, gobos, soft shadows).'
  }
}

const nftShape: ViewConfig = {
  groups: [{ fields: ['urn', 'style', 'color'] }],
  labels: { style: 'frame style' },
  docs: {
    urn: 'NFT URI: urn:decentraland:<chain>:<standard>:<contract>:<tokenId>.',
    style: 'Picture-frame style around the NFT.',
    color: 'Background color shown behind transparent pixels.'
  }
}

export const coreViews: Record<string, ComponentView> = {
  GltfContainer: curatedView(gltfContainer),
  GltfNodeModifiers: curatedView(gltfNodeModifiers),
  MeshRenderer: curatedView(meshRenderer),
  MeshCollider: curatedView(meshCollider),
  Material: curatedView(material),
  TextShape: curatedView(textShape),
  Billboard: curatedView(billboard),
  VisibilityComponent: curatedView(visibility),
  LightSource: curatedView(lightSource),
  NftShape: curatedView(nftShape)
}
