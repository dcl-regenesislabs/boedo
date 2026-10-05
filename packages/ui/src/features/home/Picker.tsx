// Roblox/creator-hub-style home: a left rail (Scenes / Worlds / Settings /
// Account) and a content area. No logs here — those live in the in-scene
// Build/Server drawer.
import { useEffect, useRef, useState } from 'react'
import type { HostState, ProjectImportResult, ProjectInfo } from '@dcl-editor/contract'
import { Button, LinkButton, SearchField, Select, Toast } from '../../ds'
import { useAuth } from '../account/auth'
import { ensureWorlds } from '../worlds/worlds-store'
import { AccountBadge, AccountSection } from '../account/account'
import { WorldsSection } from '../worlds/WorldsSection'
import { PublishModal } from '../publish/PublishModal'
import { SceneCard, FolderIcon } from './SceneCard'
import { UpdateBadge } from '../update/UpdateBadge'
import { WhatsNewToast } from '../update/WhatsNewToast'
import dclLogo from '../../assets/dcl-logo.png'
import { NewSceneModal } from './NewSceneModal'
import { useStore } from '../../core/store'
import { Welcome, welcomeGate } from './Welcome'
import { OpsDashboard } from '../ops/OpsDashboard'
import { canSeeOps } from '../ops/ops-access'
import { ImportResultModal } from '../sync/ImportResultModal'
import { syncLine, useSyncStatus } from '../sync/sync'

type HomeSection = 'scenes' | 'worlds' | 'account' | 'ops'

type SortKey = 'recent' | 'name' | 'parcels'

const PlusIcon = (): JSX.Element => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
)

const NAV: Array<[HomeSection, string]> = [
  ['scenes', 'Scenes'],
  ['worlds', 'Worlds'],
  ['account', 'Account']
]

const SORTERS: Record<SortKey, (a: ProjectInfo, b: ProjectInfo) => number> = {
  recent: (a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0),
  name: (a, b) => a.title.localeCompare(b.title),
  parcels: (a, b) => b.parcels - a.parcels
}

// Roblox/creator-hub-style home: a left rail (Scenes / Settings / Account) and a
// content area. No logs here — those live in the in-scene Build/Server drawer.
export function Picker(): JSX.Element {
  const shell = window.editorShell
  const [cfg, setCfg] = useState<HostState | null>(null)
  const [section, setSection] = useState<HomeSection>('scenes')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState<{ path: string; name: string } | null>(null)
  const [publish, setPublish] = useState<{ dir: string; title: string; world: string | null } | null>(null)
  const [worldsFocus, setWorldsFocus] = useState<string | null>(null) // deep-link into a world's detail
  const [trash, setTrash] = useState<ProjectInfo[]>([])
  const [imported, setImported] = useState<ProjectImportResult | null>(null)
  const removeTimer = useRef<ReturnType<typeof setTimeout>>()
  const refresh = (): void => {
    void shell?.getState().then(setCfg)
    void shell?.trashedProjects?.().then(setTrash)
  }
  // the list is read again when the account's copy adds, removes or replaces a scene
  const sync = useSyncStatus()
  const listRevision = sync?.revision
  useEffect(refresh, [listRevision])
  // Prefetch the worlds inventory the moment the home screen loads (and on
  // sign-in) so the Worlds tab is already populated — no skeleton on first
  // open. Idempotent: WorldsSection's own ensureWorlds() then finds it warm.
  const auth = useAuth()
  const welcome = useStore(() => welcomeGate.needed)
  useEffect(ensureWorlds, [auth.wallet])
  if (shell === undefined) {
    return <div className="eui-boot">Editor host — pass ?realm=…&systemScene=… to attach to a running stack</div>
  }
  if (welcome) return <Welcome />

  // scenes are folders the creator picks, or the shell keeps them itself
  const folders = shell.pickFolder !== undefined
  const newLabel = folders ? 'New or open scene' : 'New scene'

  // Undo-able remove: hide the card, commit the removal after a grace period.
  const requestRemove = (p: ProjectInfo): void => {
    setPending({ path: p.path, name: p.title })
    clearTimeout(removeTimer.current)
    removeTimer.current = setTimeout(() => {
      void shell.removeFromRecents?.(p.path).then(refresh)
      setPending(null)
    }, 4500)
  }
  const undoRemove = (): void => {
    clearTimeout(removeTimer.current)
    setPending(null)
  }

  const all = (cfg?.projects ?? []).filter((p) => p.path !== pending?.path)
  const q = search.trim().toLowerCase()
  const filtered =
    q === '' ? all : all.filter((p) => `${p.title} ${p.world ?? ''} ${p.path}`.toLowerCase().includes(q))
  const sorted = [...filtered].sort(SORTERS[sort])
  const favs = sorted.filter((p) => p.favourite === true)
  const recents = sorted.filter((p) => p.favourite !== true)

  const runImport = (kind: 'zip' | 'folder'): void => {
    void shell.importProject?.(kind).then((result) => {
      if (result === null) return
      setImported(result)
      refresh()
    })
  }
  const importActions = shell.importProject !== undefined && (
    <div className="eui-home-cta">
      <Button variant="secondary" size="md" tip="A .zip of a scene folder, from the desktop editor or an export" onClick={() => runImport('zip')}>
        Import .zip
      </Button>
      {shell.canImportFolder === true && (
        <Button variant="secondary" size="md" tip="A scene folder on this computer" onClick={() => runImport('folder')}>
          Import folder
        </Button>
      )}
    </div>
  )
  const line = sync === null ? null : syncLine(sync)

  const card = (p: ProjectInfo): JSX.Element => (
    <SceneCard
      key={p.path}
      p={p}
      sync={sync?.projects[p.path] ?? p.sync}
      shell={shell}
      onOpen={() => void shell.openProject(p.path)}
      onChanged={refresh}
      onRemove={requestRemove}
      onPublish={() => setPublish({ dir: p.path, title: p.title, world: p.world })}
    />
  )

  const nav = canSeeOps(auth.wallet) ? [...NAV, ['ops', 'Ops'] as [HomeSection, string]] : NAV

  return (
    <div className="eui-home">
      <nav className="eui-home-rail">
        <div className="eui-home-brand">
          <img className="eui-home-logo" src={dclLogo} alt="" />
          <span>Decentraland Studio</span>
        </div>
        {nav.map(([key, label]) => (
          <button
            key={key}
            className={`eui-home-navitem ${section === key ? 'on' : ''}`}
            onClick={() => {
              setWorldsFocus(null) // manual nav always lands on the worlds grid
              setSection(key)
            }}
          >
            {label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <UpdateBadge />
      </nav>

      <div className="eui-home-account">
        <AccountBadge size="lg" onAccount={() => setSection('account')} />
      </div>

      <main className="eui-home-main">
        {section === 'scenes' && (
          <>
            <header className="eui-home-head">
              <div>
                <h1>Your scenes</h1>
                <p>Create, open and manage your Decentraland scenes.</p>
                {line !== null && <p className={`eui-home-sync ${line.tone}`}>{line.text}</p>}
              </div>
              {all.length > 0 && importActions}
            </header>

            {all.length > 0 && (
              <div className="eui-home-toolbar">
                <SearchField size="lg" className="eui-home-search" value={search} onChange={setSearch} placeholder="Search scenes…" />
                <span style={{ flex: 1 }} />
                <span className="eui-home-sortby">Sort by</span>
                <Select
                  density="large"
                  value={sort}
                  onChange={(v) => setSort(v as SortKey)}
                  options={[
                    { value: 'recent', label: 'Last opened' },
                    { value: 'name', label: 'Name' },
                    { value: 'parcels', label: 'Parcels' }
                  ]}
                  aria-label="Sort"
                />
              </div>
            )}

            {favs.length > 0 && (
              <>
                <div className="eui-home-shelf">Favourites</div>
                <div className="eui-scene-grid">{favs.map(card)}</div>
              </>
            )}

            {favs.length > 0 && <div className="eui-home-shelf">Recent</div>}
            {all.length > 0 && (
              <div className="eui-scene-grid">
                {recents.map(card)}
              </div>
            )}

            {all.length === 0 && (
              <div className="eui-home-first">
                <FolderIcon />
                <p className="t">Create your first scene</p>
                <p className="s">
                  {folders
                    ? 'Pick a starter, or open an existing scene folder.'
                    : shell.importProject !== undefined
                      ? 'Pick a starter to begin, or import a scene you already have.'
                      : 'Pick a starter to begin.'}
                </p>
                <Button variant="primary" size="md" onClick={() => setCreating(true)}>+ New scene</Button>
                {importActions}
              </div>
            )}
            {q !== '' && sorted.length === 0 && all.length > 0 && (
              <p className="eui-home-empty">No scenes match “{search}”.</p>
            )}
            {/* The new-scene action used to be the first tile of the grid, where it
                scrolled away with the list and read as another scene. As a floating
                button it stays reachable from anywhere in the list. The first-run
                screen keeps its own CTA — nothing to float over yet. */}
            {all.length > 0 && (
              <button
                className="eui-home-fab"
                aria-label={newLabel}
                data-tip={newLabel}
                onClick={() => setCreating(true)}
              >
                <PlusIcon />
                <span className="eui-sr-only">{newLabel}</span>
              </button>
            )}
            {trash.length > 0 && (
              <>
                <div className="eui-home-shelf">Trash</div>
                <div className="eui-scene-grid">
                  {trash.map((p) => (
                    <div key={p.path} className="eui-scene-card trashed">
                      <div className="eui-scene-thumb">
                        {p.thumbnail !== null ? <img src={p.thumbnail} alt="" /> : <div className="eui-scene-thumb-fallback"><FolderIcon /></div>}
                      </div>
                      <div className="eui-scene-meta">
                        <span className="eui-scene-name">{p.title}</span>
                        <span className="eui-scene-sub">
                          <LinkButton onClick={() => void shell.restoreProject?.(p.path).then(refresh)}>Restore</LinkButton>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {section === 'worlds' && (
          <WorldsSection
            key={worldsFocus ?? 'all'}
            projects={cfg?.projects ?? []}
            initialWorld={worldsFocus}
            onOpenScene={(dir) => void shell.openProject(dir)}
            onPublishScene={(p, world) => setPublish({ dir: p.path, title: p.title, world })}
          />
        )}

        {section === 'account' && <AccountSection />}
        {section === 'ops' && canSeeOps(auth.wallet) && <OpsDashboard />}
      </main>

      {creating && (
        <NewSceneModal
          shell={shell}
          onOpenExisting={
            folders
              ? () => {
                  setCreating(false)
                  void shell.pickProject()
                }
              : undefined
          }
          onClose={() => setCreating(false)}
          onCreated={(dir) => {
            setCreating(false)
            void shell.openProject(dir)
          }}
        />
      )}
      {publish !== null && (
        <PublishModal
          dir={publish.dir}
          sceneTitle={publish.title}
          currentWorld={publish.world}
          onClose={() => {
            setPublish(null)
            refresh() // the publish wrote worldConfiguration.name — refresh badges
          }}
          onManageWorld={(name) => {
            setPublish(null)
            refresh()
            setWorldsFocus(name)
            setSection('worlds')
          }}
        />
      )}
      {pending !== null && (
        <Toast>
          Removed “{pending.name}”
          <button className="eui-link" onClick={undoRemove}>Undo</button>
        </Toast>
      )}
      {imported !== null && (
        <ImportResultModal
          result={imported}
          onClose={() => setImported(null)}
          onOpen={(id) => {
            setImported(null)
            void shell.openProject(id)
          }}
        />
      )}
      {pending === null && <WhatsNewToast />}
    </div>
  )
}
