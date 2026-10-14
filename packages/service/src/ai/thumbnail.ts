import { Type } from '@earendil-works/pi-ai'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { object } from '../../../contract/src/assistant.ts'
import type { ImageProvider, ImageRequest, PictureData } from './images.ts'
import type { WalletUsage } from './usage.ts'
import type { BrowserCall } from './types.ts'

export const DEFAULT_IMAGES_PER_DAY = 10

/** The image model as one wallet may use it. */
export interface WalletImages {
  /** null when an image can be made now, else what to tell the creator */
  refusal(): Promise<string | null>
  /** Counts one image against the wallet's day, whether or not the model delivers it. */
  generate(request: ImageRequest, signal?: AbortSignal): Promise<PictureData>
}

export const IMAGES_UNAVAILABLE = 'Making thumbnails is not set up on this assistant service (no image model is signed in). ' +
  'The creator can choose an image as the thumbnail in Scene settings.'

export function createWalletImages(provider: ImageProvider | undefined, usage: WalletUsage | undefined, perDay: number): WalletImages {
  return {
    async refusal() {
      if (provider === undefined || usage === undefined) return IMAGES_UNAVAILABLE
      if (!(await usage.exhausted())) return null
      return `This account has made today's ${perDay} thumbnail images. More can be made after ${(await usage.balance()).dailyResetAt}.`
    },
    async generate(request, signal) {
      if (provider === undefined || usage === undefined) throw new Error(IMAGES_UNAVAILABLE)
      await usage.record(1)
      return provider.generate(request, signal)
    }
  }
}

export function thumbnailPrompt({ brief, title, style }: { brief: string; title: string; style: string }): string {
  return [
    'Key art for a Decentraland game: a poster that sells the game, not a screenshot.',
    `Style: ${style}.`,
    `Title text, spelled exactly: "${title}".`,
    `Art direction: ${brief}`,
    'The attached pictures are views of the game\'s 3D scene: the first is a close view of the hero subject, the second a wide view ' +
      'of the whole scene. Keep its setting, hero subject, shapes and palette recognisable, ' +
      'but redraw it as polished key art with a dynamic composition.',
    'Composition rules:',
    '- Landscape, filled edge to edge. It is cropped to 16:9, and parts of Decentraland show only the central square, ' +
      'so the title and the key subject sit inside the middle 55% of the width, clear of the top and bottom edges.',
    '- The title in large, bold, readable lettering. No other text, no small print.',
    '- No UI, HUD, buttons, cursors, frames, borders, watermarks or logos.',
    '- Show the game\'s hook: what the player does and why it is fun.',
    '- Any people are Decentraland avatars: smooth stylised 3D characters with natural proportions and expressive faces, ' +
      'wearing streetwear, hoodies, sneakers and accessories. Not blocky, voxel or Lego-like figures.',
    '- Original art only: no characters, logos, art styles or trademarks from other games, films or brands ' +
      '(no Minecraft, Roblox, Fortnite or Lego look), and no real brand marks on clothes or shoes.'
  ].join('\n')
}

const point = Type.Object({ x: Type.Number(), y: Type.Number(), z: Type.Number() })

function isPoint(value: unknown): boolean {
  return object(value) && ['x', 'y', 'z'].every((axis) => typeof value[axis] === 'number' && Number.isFinite(value[axis]))
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() !== '' && value.length <= max ? value.trim() : null
}

type ThumbnailResult = { content: Array<{ type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string }>; details: Record<string, never> }

export async function makeThumbnail(args: unknown, call: BrowserCall, images: WalletImages, signal?: AbortSignal): Promise<ThumbnailResult> {
  if (!object(args)) throw new Error('Invalid thumbnail arguments')
  const brief = text(args.brief, 2000)
  const title = text(args.title, 60)
  const style = text(args.style, 80)
  const shots = Array.isArray(args.shots) ? args.shots : []
  if (brief === null || title === null || style === null || shots.length !== 2 ||
    !shots.every((shot) => object(shot) && isPoint(shot.from) && isPoint(shot.lookAt))) {
    throw new Error('make_thumbnail needs brief, title, style and 2 shots of {from, lookAt}: the hero subject close, then the whole scene wide.')
  }
  const refused = await images.refusal()
  if (refused !== null) return { content: [{ type: 'text', text: refused }], details: {} }
  const references: PictureData[] = []
  for (const shot of shots as Array<Record<string, unknown>>) {
    const view: unknown = JSON.parse(await call('view', { from: shot.from, lookAt: shot.lookAt, label: 'Framing the thumbnail' }, signal))
    if (!object(view) || typeof view.image !== 'string' || view.mimeType !== 'image/jpeg') throw new Error('The browser sent no picture.')
    references.push({ mimeType: 'image/jpeg', data: view.image })
  }
  const image = await images.generate({ prompt: thumbnailPrompt({ brief, title, style }), references }, signal)
  const saved: unknown = JSON.parse(await call('scene_request', {
    request: { type: 'saveThumbnail', image: image.data, mimeType: image.mimeType, preview: args.preview === true },
    label: 'Saving the thumbnail'
  }, signal))
  if (!object(saved)) throw new Error('The browser did not save the thumbnail.')
  const { preview, ...result } = saved
  const summary = { type: 'text' as const, text: `Saved as the scene thumbnail: ${JSON.stringify(result)}` }
  if (!object(preview) || typeof preview.image !== 'string') return { content: [summary], details: {} }
  return { content: [{ type: 'image', mimeType: 'image/jpeg', data: preview.image }, summary], details: {} }
}

export function thumbnailTool(call: BrowserCall, images: WalletImages): ToolDefinition {
  return {
    name: 'make_thumbnail', label: 'Make thumbnail',
    description: 'Make the scene\'s thumbnail: 16:9 key art painted by an image model from your brief and 2 views of the scene ' +
      '(from, lookAt in world metres): the hero subject close, then the whole scene wide;, saved as assets/images/thumbnail.jpg and set in scene.json. preview returns a small copy to check it.',
    parameters: Type.Object({
      brief: Type.String({ maxLength: 2000, description: 'Art direction: the game hook, hero subject, mood and palette' }),
      title: Type.String({ maxLength: 60, description: 'The title text, exactly as it should read' }),
      style: Type.String({ maxLength: 80 }),
      shots: Type.Array(Type.Object({ from: point, lookAt: point }), { minItems: 2, maxItems: 2 }),
      preview: Type.Optional(Type.Boolean()),
      label: Type.Optional(Type.String({ description: 'What you are doing now, for the creator, at most six words' }))
    }),
    execute: (_id, args, signal) => makeThumbnail(args, call, images, signal)
  }
}
