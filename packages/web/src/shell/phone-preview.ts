import type { OpenPreview } from '@dcl-editor/contract'

// The Decentraland mobile explorer built for the web, on the open scene's preview realm. The host
// serves it beside the page (godot/), so it is same-origin and reads the realm from the page's
// service worker. It gets its own window, not a tab: a hidden page never gets a WebGPU adapter.
export interface PhonePreview {
  open: (realm: string, position: string) => Promise<OpenPreview>
  reload: () => void
}

const WINDOW = 'dcl-phone-preview'
// the page and the editor sit in different browsing context groups (COOP vs the app frame's
// isolation policy), so window.open's handle reads as closed: talk over a channel instead
const CHANNEL = 'dcl-phone-preview'
// the mobile app's canvas
const FEATURES = 'popup,width=1600,height=720'

export function createPhonePreview(pageDir: string): PhonePreview {
  const entry = new URL('godot/index.html', pageDir).href
  const channel = new BroadcastChannel(CHANNEL)
  let realmOpened: string | null = null
  return {
    open: async (realmUrl, position) => {
      const realm = realmUrl.replace(/\/$/, '')
      const served = await fetch(entry, { method: 'HEAD' }).then((r) => r.ok, () => false)
      if (!served) return { ok: false, reason: 'unavailable' }
      const args = ['--skip-lobby', '--guest-profile', '--realm', realm, '--location', position, '--preview']
      const opened = window.open(`${entry}?args=${encodeURIComponent(args.join(' '))}`, WINDOW, FEATURES)
      if (opened === null) return { ok: false, reason: 'unavailable' }
      realmOpened = realm
      return { ok: true }
    },
    // the realm socket nothing answers in a browser, so a new build is picked up by reloading
    reload: () => {
      if (realmOpened !== null) channel.postMessage({ type: 'reload', realm: realmOpened })
    }
  }
}
