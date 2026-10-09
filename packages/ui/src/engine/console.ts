// Direct console-command transport to the bevy engine. The engine lives either
// in this window (in-page editor) or in a same-origin iframe (host app) — the
// host calls setEngineWindow(iframe.contentWindow) and everything else is
// identical. This module is the single RPC seam between the editor UI and the
// engine.

interface EngineWindow extends Window {
  engine_console_command_args?: (cmd: string, args: string[]) => Promise<string>
  engine_console_command?: (line: string) => Promise<string>
  engine?: Record<string, (...args: unknown[]) => Promise<unknown>>
}

declare global {
  interface Window {
    engine_console_command_args?: (cmd: string, args: string[]) => Promise<string>
    engine_console_command?: (line: string) => Promise<string>
    engine?: Record<string, (...args: unknown[]) => Promise<unknown>>
  }
}

let engine: EngineWindow = window

const engineWindowListeners = new Set<(w: Window) => void>()

export function setEngineWindow(w: Window): void {
  if (w === engine) return
  engine = w as EngineWindow
  engineWindowListeners.forEach((cb) => cb(w))
}

// The viewport iframe swaps its window on every navigation.
export function onEngineWindow(cb: (w: Window) => void): () => void {
  engineWindowListeners.add(cb)
  return () => engineWindowListeners.delete(cb)
}

// Hosted mode: the page that owns the engine hands over a line-based console
// instead of a window to reach into.
let transport: ((line: string) => Promise<string>) | null = null

export function setConsoleTransport(send: ((line: string) => Promise<string>) | null): void {
  transport = send
}

// Rust's split_whitespace set, which is how the engine cuts a line into args.
const WHITESPACE = /[\s\u0085]/
const EACH_WHITESPACE = new RegExp(WHITESPACE, 'g')

// The engine re-joins a JSON argument's pieces with single spaces, so a run of
// spaces or a non-breaking space inside a string would not survive the trip.
// Escaped, the argument is one piece.
export function consoleLine(cmd: string, args: string[] = []): string {
  const parts = args.map((arg) => {
    if (!WHITESPACE.test(arg)) return arg
    try {
      return JSON.stringify(JSON.parse(arg)).replace(
        EACH_WHITESPACE,
        (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
      )
    } catch {
      return arg
    }
  })
  return [cmd, ...parts].join(' ')
}

// The window the engine runs in (this one, or the viewport iframe's) — for
// listeners that must attach to the engine's own document (cursor tracking,
// pointer-lock fallback), same-origin either way.
export function getEngineWindow(): Window {
  return engine
}

export async function consoleCommand(cmd: string, args: string[] = []): Promise<string> {
  if (transport !== null) return await transport(consoleLine(cmd, args))
  if (engine.engine_console_command_args !== undefined) {
    return await engine.engine_console_command_args(cmd, args)
  }
  if (engine.engine_console_command !== undefined) {
    return await engine.engine_console_command([cmd, ...args].join(' '))
  }
  throw new Error('engine console API not available yet')
}

export function engineReady(): boolean {
  if (transport !== null) return true
  try {
    return (
      engine.engine_console_command_args !== undefined ||
      engine.engine_console_command !== undefined
    )
  } catch {
    return false
  }
}
