// Prints the explorer's PINNED_EDITOR for a published version of the web editor, read back from
// the CDN the page will load it from:  node packages/web/scripts/pin.mjs <version> [host...]
// (--base <url> reads a staged copy instead, e.g. to check a build before publishing)
import crypto from 'node:crypto'

const args = process.argv.slice(2)
const at = args.indexOf('--base')
const override = at === -1 ? undefined : args.splice(at, 2)[1]
const [version, ...hosts] = args
if (version === undefined) {
  console.error('usage: node packages/web/scripts/pin.mjs <version> [host...]')
  process.exit(1)
}
const base = override ?? `https://cdn.jsdelivr.net/npm/@dcl-regenesislabs/web-editor@${version}/`

async function fetchOk(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res
}

const editorJs = Buffer.from(await (await fetchOk(`${base}editor.js`)).arrayBuffer())
const integrity = `sha384-${crypto.createHash('sha384').update(editorJs).digest('base64')}`
// jsDelivr answers 404 for the extensionless `scene/about` (the pinned page never reads it)
const about = await (await fetch(`${base}scene/about`).then((res) =>
  res.ok || override !== undefined ? res : fetchOk(`https://unpkg.com/@dcl-regenesislabs/web-editor@${version}/scene/about`)
)).json()
const urn = about?.configurations?.scenesUrn?.[0]
const entity = typeof urn === 'string' ? /^urn:decentraland:entity:([^?]+)/.exec(urn)?.[1] : undefined
if (entity === undefined) throw new Error(`${base}scene/about names no scene entity`)

const pin = { base, editorJsIntegrity: integrity, editorSceneEntity: entity, hosts }
console.log(`export const PINNED_EDITOR = ${JSON.stringify(pin, null, 2)} as (EditorPin & { hosts: string[] }) | null`)
