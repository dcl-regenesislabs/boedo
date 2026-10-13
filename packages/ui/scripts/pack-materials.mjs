// Regenerates src/three/materials/ from ambientCG (CC0): each 1K set becomes 512 px color.jpg and
// normal.jpg, its roughness and metalness averaged into properties.json, plus CREDITS.md.
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
    const S = 512
    const draw = async (src) => {
      const image = new Image()
      image.src = src
      await image.decode()
      const canvas = new OffscreenCanvas(S, S)
      const g = canvas.getContext('2d')
      g.drawImage(image, 0, 0, S, S)
      return [canvas, g]
    }
    const jpg = async (canvas) => {
      const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })).arrayBuffer())
      let text = ''
      for (const b of bytes) text += String.fromCharCode(b)
      return btoa(text)
    }
    const [colorCanvas, cg] = await draw(color)
    // a dark scan is lifted to a mid brightness, so a white tint looks natural and tints only darken
    const px = cg.getImageData(0, 0, S, S)
    let sum = 0
    for (let i = 0; i < px.data.length; i += 4) sum += (0.2126 * px.data[i] + 0.7152 * px.data[i + 1] + 0.0722 * px.data[i + 2]) / 255
    const mean = sum / (px.data.length / 4)
    if (mean < 0.4) {
      for (let i = 0; i < px.data.length; i += 4) for (let c = 0; c < 3; c++) px.data[i + c] = Math.min(255, (px.data[i + c] * 0.4) / mean)
      cg.putImageData(px, 0, 0)
    }
    const [normalCanvas] = await draw(normal)
    const average = async (src) => {
      if (src === null) return 0
      const data = (await draw(src))[1].getImageData(0, 0, S, S).data
      let total = 0
      for (let i = 0; i < data.length; i += 4) total += data[i] / 255
      return Math.round((total / (data.length / 4)) * 100) / 100
    }
    return { color: await jpg(colorCanvas), normal: await jpg(normalCanvas), roughness: await average(rough), metalness: await average(metal) }
  }, { color: map('Color'), normal: map('NormalGL'), rough: map('Roughness'), metal: map('Metalness') })
  fs.rmSync(path.join(out, name), { recursive: true, force: true })
  fs.mkdirSync(path.join(out, name), { recursive: true })
  for (const file of ['color', 'normal']) fs.writeFileSync(path.join(out, name, `${file}.jpg`), Buffer.from(packed[file], 'base64'))
  properties[name] = { roughness: packed.roughness, metalness: packed.metalness }
  console.log(name, id, properties[name])
}
fs.writeFileSync(path.join(out, 'properties.json'), `${JSON.stringify(properties, null, 2)}\n`)
await browser.close()
fs.rmSync(work, { recursive: true, force: true })

const rows = Object.entries(SETS).map(([name, id]) => `| \`${name}\` | [${id}](https://ambientcg.com/view?id=${id}) |`)
fs.writeFileSync(path.join(out, 'CREDITS.md'), `# Material credits

Every material here is a photo-scanned set from [ambientCG](https://ambientcg.com), released under
[CC0 1.0](https://docs.ambientcg.com/license/). Scaled to 512 px, a colour and a normal map each; the
scan's roughness and metalness are averaged into \`properties.json\`, and a dark scan's colour is lifted
to a mid brightness.
Regenerate with \`node packages/ui/scripts/pack-materials.mjs\`.

| Material | ambientCG set |
|---|---|
${rows.join('\n')}
`)
