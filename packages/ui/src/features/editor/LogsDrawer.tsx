import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cmd } from '../../engine/cmd'
import { useStore } from '../../core/store'
import { chrome } from '../../core/chrome'
import { BUILD_TAB_EMPTY, GAME_TAB_EMPTY, GAME_TAB_TIP, PROBLEM_MARKER, gameTabLines, isServerError, lastSeconds, type RelayedLine } from './log-roles'
import { stripAnsi } from './scene-health'
import { SearchField, Segmented, labelTip } from '../../ds'
import { launchParam } from '../../boot/launch-params'
import { getHost, hostV1 } from '../../engine/hosted'
import { PreviewStorage } from './PreviewStorage'

// Bottom-docked log drawer: the inspected scene's own console output (what the
// scene prints while running) and the shared copy's lines lifted out of the
// build stream, plus the local stack's server output when the electron shell is
// present. Open/close is owned by Editor and toggled from the topbar — no
// floating button.
//
// The scene tab is called Game because that is what its lines are about, and
// each one shows which copy of the scene printed it (log-roles.ts). `initialTab`
// is where an opening lands — the Game strip's Logs button asks for Game; an
// opening that asks for nothing keeps the tab the creator last chose. `openKey`
// counts the openings, so asking for the same tab twice still lands there: the
// creator who clicks Logs, browses Build, then clicks Logs again means it.
export type LogsTab = 'scene' | 'server' | 'storage'

// One line per relayed entry, so this is a line count — it used to be a chunk
// count, which made the visible backlog a fraction of what it reads as. Matches
// the shell's own cap (main.ts) so the drawer never throws away history the
// shell still holds. See log-roles.ts for why each entry keeps its arrival time.
const MAX_SHELL_LINES = 4000

interface ShellLine {
  text: string
  /** wall-clock arrival, or null for the backlog that predates this drawer */
  ms: number | null
}

export function LogsDrawer(props: {
  open: boolean
  onClose: () => void
  initialTab?: LogsTab
  openKey?: number
}): JSX.Element | null {
  const shell = window.editorShell
  const { open, onClose, initialTab, openKey } = props
  const [tab, setTab] = useState<LogsTab>(initialTab ?? (shell !== undefined ? 'server' : 'scene'))
  const [serverLogs, setServerLogs] = useState<ShellLine[]>([])
  const [sceneLogs, setSceneLogs] = useState('')
  // hosted: the preview's scene server runs in the page, where the shell's stream never reaches
  const [hostServerLogs, setHostServerLogs] = useState<ShellLine[]>([])
  const [who, setWho] = useState<'all' | 'client' | 'server'>('all')
  const [query, setQuery] = useState('')
  const pre = useRef<HTMLPreElement>(null)
  const sceneEpochMs = useRef<number | null>(null)
  useEffect(() => {
    if (shell === undefined) return
    void shell.getState().then((s) => setServerLogs(s.logs.map((text) => ({ text, ms: null }))))
    shell.onStackLog((line) =>
      setServerLogs((prev) => [...prev.slice(-MAX_SHELL_LINES), { text: line, ms: Date.now() }])
    )
  }, [])
  useEffect(() => {
    const read = hostV1()?.previewServerLogs
    if (read === undefined || !open || tab !== 'scene') return
    let after = 0
    const poll = (): void => {
      const lines = read(after)
      if (lines.length === 0) return
      after = lines[lines.length - 1].seq
      const now = Date.now()
      const rows = lines.map((line) => ({
        text: `[server] ${line.level === 'system' || isServerError(line) ? `${PROBLEM_MARKER} ` : ''}${line.msg}`,
        ms: now
      }))
      setHostServerLogs((prev) => [...prev, ...rows].slice(-MAX_SHELL_LINES))
    }
    setHostServerLogs([])
    poll()
    const t = setInterval(poll, 2000)
    return () => clearInterval(t)
  }, [open, tab])
  useEffect(() => {
    if (open && initialTab !== undefined) setTab(initialTab)
  }, [open, openKey, initialTab])
  useEffect(() => {
    if (!open || tab !== 'scene') return
    let live = true
    const poll = async (): Promise<void> => {
      try {
        const reply = await cmd.sceneLogs(200)
        if (!live) return
        const seconds = lastSeconds(reply)
        if (seconds !== null) sceneEpochMs.current = Date.now() - seconds * 1000
        setSceneLogs(reply)
      } catch {
        /* engine not ready yet */
      }
    }
    void poll()
    const t = setInterval(() => void poll(), 2000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [open, tab])
  useEffect(() => {
    if (pre.current !== null) pre.current.scrollTop = pre.current.scrollHeight
  }, [serverLogs, sceneLogs, open, tab])
  const dock = useStore(() => chrome.rightDock)
  const dockBottom = useStore(() => chrome.rightDockBottom)
  const [drawer, setDrawer] = useState<HTMLDivElement | null>(null)
  const [drawerTop, setDrawerTop] = useState(Infinity)
  useEffect(() => {
    if (drawer === null) return
    const measure = (): void => setDrawerTop(drawer.getBoundingClientRect().top)
    const observer = new ResizeObserver(measure)
    observer.observe(drawer)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [drawer])
  if (!open) return null
  // hosted, the preview realm serves the scene's storage itself
  const host = getHost()
  const realm = host === null ? null : launchParam('realm')
  const epoch = sceneEpochMs.current
  const relayed: RelayedLine[] = [...serverLogs, ...hostServerLogs].map((line) => ({
    text: line.text,
    at: line.ms === null || epoch === null ? null : (line.ms - epoch) / 1000
  }))
  const all = tab === 'scene' ? gameTabLines(sceneLogs, relayed) : []
  const quiet = !all.some((row) => row.role !== null || row.text.trim() !== '')
  const needle = query.trim().toLowerCase()
  const rows = all.filter(
    (row) =>
      (who === 'all' || (who === 'server') === (row.role === 'server')) &&
      (needle === '' || row.text.toLowerCase().includes(needle))
  )
  function logText(): ReactNode {
    if (tab === 'scene') {
      if (quiet) return GAME_TAB_EMPTY
      if (rows.length === 0) return 'No lines match.'
      return rows.map((line, i) => (
        <span key={i} className={line.error ? 'eui-logs-line error' : 'eui-logs-line'}>
          {line.role !== null && <span className={`eui-logs-role ${line.role}`}>[{line.role}]</span>}
          {line.text}
          {'\n'}
        </span>
      ))
    }
    if (serverLogs.length > 0) return serverLogs.map((line) => stripAnsi(line.text)).join('\n')
    return BUILD_TAB_EMPTY
  }
  return (
    <div ref={setDrawer} className="eui-logs-drawer" style={{ right: dockBottom > drawerTop ? dock : 0 }}>
      <div className="eui-logs-tabs">
        {shell !== undefined && (
          <button className={tab === 'server' ? 'on' : ''} onClick={() => setTab('server')}>
            Build
          </button>
        )}
        <button className={tab === 'scene' ? 'on' : ''} onClick={() => setTab('scene')} data-tip={GAME_TAB_TIP}>
          Game
        </button>
        {realm !== null && (
          <button className={tab === 'storage' ? 'on' : ''} onClick={() => setTab('storage')}>
            Storage
          </button>
        )}
        <span className="eui-logs-spacer" />
        {tab === 'scene' && (
          <>
            <Segmented
              aria-label="Which copy printed it"
              value={who}
              onChange={setWho}
              options={[
                { value: 'all', label: 'All' },
                { value: 'client', label: 'Client' },
                { value: 'server', label: 'Server' }
              ]}
            />
            <SearchField size="sm" className="eui-logs-search" placeholder="Search logs" value={query} onChange={setQuery} />
          </>
        )}
        <button onClick={onClose} {...labelTip('Hide logs')}>
          ✕
        </button>
      </div>
      {tab === 'storage' && realm !== null ? (
        <div className="eui-logs-body">
          <PreviewStorage realm={realm} player={host?.identity().address?.toLowerCase() ?? null} />
        </div>
      ) : (
        <pre ref={pre} className="eui-logs-body">
          {logText()}
        </pre>
      )}
    </div>
  )
}
