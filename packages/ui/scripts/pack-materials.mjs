// Regenerates src/three/materials/ from ambientCG (CC0): each 1K set becomes 512 px color.jpg,
// normal.jpg and orm.jpg (roughness in green, metalness in blue), plus CREDITS.md.
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
    const [ormCanvas, rg] = await draw(rough)
    const r = rg.getImageData(0, 0, S, S)
    const m = metal === null ? null : (await draw(metal))[1].getImageData(0, 0, S, S)
    for (let i = 0; i < r.data.length; i += 4) {
      const roughness = r.data[i]
      r.data[i] = 255
      r.data[i + 1] = roughness
      r.data[i + 2] = m === null ? 0 : m.data[i]
    }
    rg.putImageData(r, 0, 0)
    return { color: await jpg(colorCanvas), normal: await jpg(normalCanvas), orm: await jpg(ormCanvas) }
  }, { color: map('Color'), normal: map('NormalGL'), rough: map('Roughness'), metal: map('Metalness') })
  fs.mkdirSync(path.join(out, name), { recursive: true })
  for (const [file, data] of Object.entries(packed)) fs.writeFileSync(path.join(out, name, `${file}.jpg`), Buffer.from(data, 'base64'))
  console.log(name, id)
}
await browser.close()
fs.rmSync(work, { recursive: true, force: true })

const rows = Object.entries(SETS).map(([name, id]) => `| \`${name}\` | [${id}](https://ambientcg.com/view?id=${id}) |`)
fs.writeFileSync(path.join(out, 'CREDITS.md'), `# Material credits

Every material here is a photo-scanned set from [ambientCG](https://ambientcg.com), released under
[CC0 1.0](https://docs.ambientcg.com/license/). Scaled to 512 px; \`orm.jpg\` packs roughness (green)
and metalness (blue) the way glTF reads them, and a dark scan's colour is lifted to a mid brightness.
Regenerate with \`node packages/ui/scripts/pack-materials.mjs\`.

| Material | ambientCG set |
|---|---|
${rows.join('\n')}
`)
