// Regenerates src/three/materials/ from ambientCG (CC0): each 1K set becomes T_<Name>_D.jpg (colour,
// 1024 px unless the pair would pass 700 KB) and T_<Name>_N.jpg (relief, 512 px), its roughness and
// metalness averaged into properties.json, plus CREDITS.md.
// Run from the repo root: node packages/ui/scripts/pack-materials.mjs (needs unzip and Chromium).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const SETS = {
  'stone-blocks': 'Bricks066', 'red-brick': 'Bricks085', 'old-brick': 'Bricks097', cobblestone: 'PavingStones150',
  rock: 'Rock058', 'mossy-rock': 'Rock064', planks: 'Planks037A', wood: 'Wood092', bark: 'Bark014',
  'roof-tiles': 'RoofingTiles014A', concrete: 'Concrete034', marble: 'Marble012', 'floor-tiles': 'Tiles141',
  metal: 'Metal032', 'rusty-metal': 'Metal041B', 'metal-plate': 'DiamondPlate009', grass: 'Grass001',
  sand: 'Ground054', gravel: 'Gravel043', snow: 'Snow014', ice: 'Ice002'
}
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/three/materials')
const MAX_MATERIAL_BYTES = 700 * 1024
const pascal = (name) => name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('')
// one flat folder of Decentraland-named textures (T_<Name>_D colour, T_<Name>_N relief)
for (const entry of fs.readdirSync(out, { withFileTypes: true })) {
  if (entry.isDirectory() || entry.name.endsWith('.jpg')) fs.rmSync(path.join(out, entry.name), { recursive: true, force: true })
}
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'materials-'))

const browser = await chromium.launch()
const page = await browser.newPage()
const properties = {}
for (const [name, id] of Object.entries(SETS)) {
  const zip = path.join(work, `${id}.zip`)
  const response = await fetch(`https://ambientcg.com/get?file=${id}_1K-JPG.zip`)
  if (!response.ok) throw new Error(`${id}: ${response.status}`)
  fs.writeFileSync(zip, Buffer.from(await response.arrayBuffer()))
  execFileSync('unzip', ['-q', '-o', zip, '-d', path.join(work, id)])
  const map = (m) => {
    const file = path.join(work, id, `${id}_1K-JPG_${m}.jpg`)
    return fs.existsSync(file) ? `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}` : null
  }
  const packed = await page.evaluate(async ({ color, normal, rough, metal }) => {
    const draw = async (src, size) => {
      const image = new Image()
      image.src = src
      await image.decode()
      const canvas = new OffscreenCanvas(size, size)
      const g = canvas.getContext('2d')
      g.drawImage(image, 0, 0, size, size)
      return [canvas, g]
    }
    const jpg = async (canvas, quality) => {
      const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer())
      let text = ''
      for (const b of bytes) text += String.fromCharCode(b)
      return btoa(text)
    }
    // a dark scan is lifted to a mid brightness, so a white tint looks natural and tints only darken
    const colour = async (size) => {
      const [canvas, g] = await draw(color, size)
      const px = g.getImageData(0, 0, size, size)
      let sum = 0
      for (let i = 0; i < px.data.length; i += 4) sum += (0.2126 * px.data[i] + 0.7152 * px.data[i + 1] + 0.0722 * px.data[i + 2]) / 255
      const mean = sum / (px.data.length / 4)
      if (mean < 0.4) {
        for (let i = 0; i < px.data.length; i += 4) for (let c = 0; c < 3; c++) px.data[i + c] = Math.min(255, (px.data[i + c] * 0.4) / mean)
        g.putImageData(px, 0, 0)
      }
      return jpg(canvas, 0.85)
    }
    const average = async (src) => {
      if (src === null) return 0
      const data = (await draw(src, 512))[1].getImageData(0, 0, 512, 512).data
      let total = 0
      for (let i = 0; i < data.length; i += 4) total += data[i] / 255
      return Math.round((total / (data.length / 4)) * 100) / 100
    }
    // relief carries geometry, not colour: 512 px is enough, but it needs a higher quality than colour
    return {
      color: { 1024: await colour(1024), 512: await colour(512) },
      normal: await jpg((await draw(normal, 512))[0], 0.92),
      roughness: await average(rough), metalness: await average(metal)
    }
  }, { color: map('Color'), normal: map('NormalGL'), rough: map('Roughness'), metal: map('Metalness') })
  const bytes = (b64) => Buffer.from(b64, 'base64')
  const normal = bytes(packed.normal)
  // 1024 is Decentraland's recommended texture size; a material whose pair would pass 700 KB keeps 512
  const color = bytes(packed.color[1024]).length + normal.length <= MAX_MATERIAL_BYTES ? bytes(packed.color[1024]) : bytes(packed.color[512])
  fs.writeFileSync(path.join(out, `T_${pascal(name)}_D.jpg`), color)
  fs.writeFileSync(path.join(out, `T_${pascal(name)}_N.jpg`), normal)
  properties[name] = { roughness: packed.roughness, metalness: packed.metalness }
  console.log(name, id, `${Math.round((color.length + normal.length) / 1024)} KB`, color.length === bytes(packed.color[1024]).length ? '1024' : '512')
}
fs.writeFileSync(path.join(out, 'properties.json'), `${JSON.stringify(properties, null, 2)}\n`)
await browser.close()
fs.rmSync(work, { recursive: true, force: true })

const rows = Object.entries(SETS).map(([name, id]) => `| \`${name}\` | \`T_${pascal(name)}\` | [${id}](https://ambientcg.com/view?id=${id}) |`)
fs.writeFileSync(path.join(out, 'CREDITS.md'), `# Material credits

Every material here is a photo-scanned set from [ambientCG](https://ambientcg.com), released under
[CC0 1.0](https://docs.ambientcg.com/license/). Each is two textures named the Decentraland way:
\`T_<Name>_D.jpg\` (colour, 1024 px unless the pair would pass 700 KB, then 512) and \`T_<Name>_N.jpg\`
(relief, 512 px). The scan's roughness and metalness are averaged into \`properties.json\`, and a dark
scan's colour is lifted to a mid brightness.
Regenerate with \`node packages/ui/scripts/pack-materials.mjs\`.

| Material | Files | ambientCG set |
|---|---|---|
${rows.join('\n')}
`)
