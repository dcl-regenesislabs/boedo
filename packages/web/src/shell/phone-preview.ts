import type { OpenPreview } from '@dcl-editor/contract'
import { previewEntityId } from '@dcl-editor/scene-compiler'

// The Decentraland mobile explorer built for the web, on the open scene's preview realm. The host
// serves it beside the page (godot/), so it is same-origin and reads the realm from the page's
// service worker. It gets its own window, not a tab: a hidden page never gets a WebGPU adapter.
export interface PhonePreview {
  open: (realm: string, position: string) => Promise<OpenPreview>
  built: (projectId: string) => Promise<void>
}

const WINDOW = 'dcl-phone-preview'
// the page and the editor sit in different browsing context groups (COOP vs the app frame's
// isolation policy), so window.open's handle reads as closed: talk over a channel instead
const CHANNEL = 'dcl-phone-preview'
// the mobile app's canvas
const FEATURES = 'popup,width=1600,height=720'

export function createPhonePreview(
  pageDir: string,
  realmIdOf: (projectId: string) => Promise<string>,
  machineId: (realmId: string) => Promise<string>
): PhonePreview {
  const entry = new URL('godot/index.html', pageDir).href
  const channel = new BroadcastChannel(CHANNEL)
  let realmOpened: string | null = null
  return {
    open: async (realmUrl, position) => {
      const realm = realmUrl.replace(/\/$/, '')
      const served = await fetch(entry, { method: 'HEAD' }).then((r) => r.ok, () => false)
      if (!served) return { ok: false, reason: 'unavailable' }
      // a preview deep link, as the desktop QR opens the mobile app: that is what makes it listen
      // for scene updates, which --realm/--preview alone do not
      const args = ['--skip-lobby', '--guest-profile', '--fake-deeplink', `decentraland://open?preview=${realm}&position=${position}`]
      const opened = window.open(`${entry}?args=${encodeURIComponent(args.join(' '))}`, WINDOW, FEATURES)
      if (opened === null) return { ok: false, reason: 'unavailable' }
      realmOpened = realm
      return { ok: true }
    },
    // the page stands in for the preview server's socket and hands this on as its scene update
    built: async (projectId) => {
      if (realmOpened === null) return
      const realmId = await realmIdOf(projectId)
      channel.postMessage({ type: 'scene-updated', realm: realmOpened, entityId: previewEntityId(realmId, await machineId(realmId)) })
    }
  }
}
