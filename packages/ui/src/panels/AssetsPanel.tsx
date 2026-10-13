import { useEffect, useRef, useState } from 'react'
import { state } from '@scene/state'
import { useStore } from '../core/store'
import { uiCheckModelRefs, uiFetchCatalog, uiImportAsset, uiLoadLocalModels, uiPlaceLocalModel, uiImportFiles } from '../actions/assets'
import { opendclUrl } from '../assets'
import { Button, ContextMenu, IconButton, LinkButton, MenuItem, Modal, SearchField, Select, Shelf } from '../ds'
import { deleteProjectFile, fileUsers, filesDeletedWith, olderBuilds, unusedModelsKey } from '../project-file-use'
import { onDataLayerWrite } from '../engine/datalayer'
import { canAskAssistant, prefillAssistant } from './ai-store'
import { threeAvailable } from '../three/client'
import { LeftTabs, type LeftView } from './left-view'
import { ensurePrefabsLoaded } from './prefab-store'
import { SearchEmpty } from './SearchEmpty'
import { catalogMatches, countPrefabMatches, matchHint } from './search-hints'
import { IconRefresh } from '../icons'

const PAGE_SIZE = 60

// Enough of your own files to recognise the section, few enough that the Catalog
// header below it stays on the first screen. A search is the one time the long
// list IS the answer, so it lifts the cap.
const LOCAL_PREVIEW = 7

const ModelGlyph = (): JSX.Element => (
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 2.5 21 7v10l-9 4.5L3 17V7l9-4.5Z"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
    <path d="M3 7l9 4.5L21 7M12 11.5V21.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
)

function CatalogGrid(props: { entries: typeof state.assetCatalog; resetKey: string }): JSX.Element {
  const [visible, setVisible] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => setVisible(PAGE_SIZE), [props.resetKey])
  useEffect(() => {
    const el = sentinelRef.current
    if (el === null) return
    const io = new IntersectionObserver((hits) => {
      if (hits.some((h) => h.isIntersecting)) setVisible((v) => v + PAGE_SIZE)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [props.entries.length, visible])
  return (
    <div className="eui-asset-grid">
      {props.entries.slice(0, visible).map((a) => (
        <div
          key={a.id}
          className="eui-asset"
          data-tip={`${a.name} — ${a.pack}`}
          onClick={() => void uiImportAsset(a.id, a.name)}
        >
          {a.thumbnail !== null && a.thumbnail !== undefined ? (
            <img src={opendclUrl(a.thumbnail)} crossOrigin="anonymous" loading="lazy" />
          ) : (
            <div style={{ width: 56, height: 56, background: 'var(--input)', borderRadius: 6 }} />
          )}
          <span className="name">{a.name}</span>
          <span className="pack">{a.pack}</span>
        </div>
      ))}
      {visible < props.entries.length && <div ref={sentinelRef} className="eui-asset-sentinel" />}
    </div>
  )
}

function LocalGrid(props: { list: string[]; older: string[]; onUploaded: () => void }): JSX.Element {
  const [pending, setPending] = useState<{ files: File[]; missing: string[] } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const [doomed, setDoomed] = useState<{ path: string; also: string[]; users: string[] | null; unchecked?: boolean; busy?: boolean; error?: string } | null>(null)
  const [sweep, setSweep] = useState<{ busy?: boolean; error?: string } | null>(null)
  const confirmSweep = async (): Promise<void> => {
    setSweep({ busy: true })
    try {
      for (const path of props.older) await deleteProjectFile(path)
      setSweep(null)
      props.onUploaded()
    } catch (e) {
      setSweep({ error: e instanceof Error ? e.message : String(e) })
      props.onUploaded()
    }
  }
  const askDelete = (path: string): void => {
    setMenu(null)
    setDoomed({ path, also: [], users: null })
    void Promise.all([fileUsers(path), filesDeletedWith(path)]).then(
      ([u, also]) => setDoomed((d) => (d?.path === path ? { path, also, users: [...u.entities.map((e) => `entity ${e}`), ...u.scripts.map((f) => `script ${f}`)] } : d)),
      () => setDoomed((d) => (d?.path === path ? { path, also: [], users: [], unchecked: true } : d))
    )
  }
  const confirmDelete = async (path: string): Promise<void> => {
    setDoomed((d) => (d === null ? d : { ...d, busy: true }))
    try {
      await deleteProjectFile(path)
      setDoomed(null)
      props.onUploaded()
    } catch (e) {
      setDoomed((d) => (d === null ? d : { ...d, busy: false, error: e instanceof Error ? e.message : String(e) }))
    }
  }
  const fileRef = useRef<HTMLInputElement>(null)
  const carryRef = useRef<File[]>([])

  useEffect(() => {
    const el = fileRef.current
    if (el === null) return
    const clearCarry = (): void => {
      carryRef.current = []
    }
    el.addEventListener('cancel', clearCarry)
    return () => el.removeEventListener('cancel', clearCarry)
  }, [])

  const upload = async (files: File[]): Promise<void> => {
    await uiImportFiles(files)
    props.onUploaded()
  }

  const onFile = async (e: { target: HTMLInputElement }): Promise<void> => {
    const picked = Array.from(e.target.files ?? [])
    if (fileRef.current !== null) fileRef.current.value = ''
    const carried = carryRef.current
    carryRef.current = []
    if (picked.length === 0) return
    const byName = new Map<string, File>()
    for (const f of [...carried, ...picked]) byName.set(f.name.toLowerCase(), f)
    const files = [...byName.values()]
    const missing = await uiCheckModelRefs(files)
    if (missing.length > 0) {
      setPending({ files, missing })
      return
    }
    await upload(files)
  }

  return (
    <>
      <div className="eui-asset-grid">
        <label
          className="eui-asset eui-asset-upload"
          data-tip="Add models (.glb / .gltf, with their textures and .bin), images, sounds (.mp3 .ogg .wav), videos (.mp4) or data files like a manifest.json"
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2,.mp3,.ogg,.wav,.mp4,.json,.txt,.md,model/gltf-binary"
            style={{ display: 'none' }}
            onChange={(e) => void onFile(e)}
          />
          <div className="glyph">+</div>
          <span className="name">Import files</span>
          <span className="pack">from your computer</span>
        </label>
        {threeAvailable() && canAskAssistant() && (
          <button type="button" className="eui-asset eui-asset-upload" data-tip="Describe a model: the assistant finds one in the catalog or builds it in code" onClick={() => prefillAssistant('Make a model of ')}>
            <div className="glyph">✦</div>
            <span className="name">Create with AI</span>
            <span className="pack">describe it</span>
          </button>
        )}
        {props.list.map((p) => {
          const name = p.split('/').pop() ?? p
          const folder = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
          const older = props.older.includes(p)
          return (
            <div
              key={p}
              className="eui-asset"
              data-tip={older ? `An earlier build of a model in the scene, kept for undo · right-click to delete` : `Place ${p} · right-click for more`}
              onClick={() => void uiPlaceLocalModel(p)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, path: p })
              }}
            >
              <div className="glyph">
                <ModelGlyph />
              </div>
              <span className="name">{name.replace(/\.(glb|gltf)$/i, '')}</span>
              <span className="pack">{older ? 'older build' : folder.replace(/^assets\//, '') || 'model'}</span>
            </div>
          )
        })}
      </div>
      {menu !== null && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuItem danger onClick={() => askDelete(menu.path)}>Delete file…</MenuItem>
          {props.older.includes(menu.path) && props.older.length > 1 && (
            <MenuItem danger onClick={() => { setMenu(null); setSweep({}) }}>Delete all {props.older.length} older builds…</MenuItem>
          )}
        </ContextMenu>
      )}
      {doomed !== null && (
        <Modal
          title="Delete file?"
          onClose={() => setDoomed(null)}
          footer={
            <>
              <Button onClick={() => setDoomed(null)}>Cancel</Button>
              <Button variant="danger" disabled={doomed.users === null || doomed.busy === true} onClick={() => void confirmDelete(doomed.path)}>
                Delete
              </Button>
            </>
          }
        >
          <p>
            <code>{doomed.path}</code> is removed from the project{doomed.also.length > 0 ? <>, with <code>{doomed.also.join(', ')}</code></> : null}. This can’t be undone.
          </p>
          {doomed.unchecked === true && <p role="alert">Couldn’t check what uses it: entities or scripts may still need it.</p>}
          {doomed.users === null && <p>Checking what uses it…</p>}
          {doomed.users !== null && doomed.users.length > 0 && (
            <>
              <p>Still used by:</p>
              <ul>
                {doomed.users.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
              <p>Those will show nothing where the model was.</p>
            </>
          )}
          {doomed.error !== undefined && <p role="alert">{doomed.error}</p>}
        </Modal>
      )}
      {sweep !== null && (
        <Modal
          title="Delete older builds?"
          onClose={() => setSweep(null)}
          footer={
            <>
              <Button onClick={() => setSweep(null)}>Cancel</Button>
              <Button variant="danger" disabled={sweep.busy === true} onClick={() => void confirmSweep()}>
                Delete
              </Button>
            </>
          }
        >
          <p>These earlier builds are removed from the project. The builds in your scene stay. Undo can’t go back to a deleted build.</p>
          <ul>
            {props.older.map((p) => (
              <li key={p}>
                <code>{p}</code>
              </li>
            ))}
          </ul>
          {sweep.error !== undefined && <p role="alert">{sweep.error}</p>}
        </Modal>
      )}
      {pending !== null && (
        <Modal
          title="Missing model files"
          onClose={() => setPending(null)}
          footer={
            <>
              <Button
                onClick={() => {
                  carryRef.current = pending.files
                  setPending(null)
                  fileRef.current?.click()
                }}
              >
                Select missing files
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setPending(null)
                  void upload(pending.files)
                }}
              >
                Import anyway
              </Button>
            </>
          }
        >
          <p>
            The model references files that aren’t in the project and weren’t selected with it:
          </p>
          <ul>
            {pending.missing.map((uri) => (
              <li key={uri}>
                <code>{uri}</code>
              </li>
            ))}
          </ul>
          <p>
            It won’t display correctly — in the editor or in-world — until they’re all in the
            project. Pick just the files above with <strong>Select missing files</strong>; the
            model you already chose stays in the import.
          </p>
        </Modal>
      )}
    </>
  )
}

export function AssetsPanel(props: { width?: number; onView: (v: LeftView) => void }): JSX.Element {
  const [filter, setFilter] = useState('')
  const [category, setCategory] = useState('')
  const [models, setModels] = useState<string[] | null>(null)
  const [allFiles, setAllFiles] = useState(false)
  const [older, setOlder] = useState<string[]>([])
  const catalog = useStore(() => state.assetCatalog)
  const busy = useStore(() => state.assetBusy)
  const catalogFailed = useStore(() => state.assetCatalogFailed)

  const refresh = (): void => {
    setModels(null)
    void uiLoadLocalModels().then(setModels)
    void olderBuilds().then(setOlder, () => setOlder([]))
  }
  useEffect(refresh, [])
  // which builds are older moves with what the scene places, not only with file writes
  const placedKey = useStore(unusedModelsKey)
  useEffect(() => void olderBuilds().then(setOlder, () => setOlder([])), [placedKey])
  // a model built, imported or deleted from anywhere shows up here without a manual reload
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = onDataLayerWrite((paths) => {
      if (!paths.some((p) => /\.(glb|gltf)$/i.test(p))) return
      clearTimeout(timer)
      timer = setTimeout(refresh, 300)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [])
  useEffect(() => {
    if (state.assetCatalog.length === 0) void uiFetchCatalog()
  }, [])
  useEffect(ensurePrefabsLoaded, [])

  const f = filter.toLowerCase()
  const local = (models ?? []).filter((p) => f === '' || p.toLowerCase().includes(f))
  const entries = catalog.filter(
    (a) => (category === '' || a.category === category) && catalogMatches(a, f)
  )
  const categories = [...new Set(catalog.map((a) => a.category))].sort()
  const nothing = f !== '' && local.length === 0 && entries.length === 0 && !busy
  const capped = !allFiles && f === '' && local.length > LOCAL_PREVIEW
  const shownLocal = capped ? local.slice(0, LOCAL_PREVIEW) : local

  return (
    <div className="eui-panel eui-left" style={{ width: props.width }}>
      <LeftTabs view="assets" onView={props.onView} />
      <div className="eui-search" style={{ display: 'flex', gap: 6 }}>
        <SearchField size="sm" placeholder="Search assets…" value={filter} onChange={setFilter} />
        {!catalogFailed && (
          <Select
            density="row"
            className="eui-asset-category"
            value={category}
            onChange={setCategory}
            aria-label="category"
            options={[{ value: '', label: 'All' }, ...categories.map((c) => ({ value: c, label: c }))]}
          />
        )}
        <IconButton tip="Reload your files" style={{ flex: 'none' }} onClick={refresh}>
          <IconRefresh />
        </IconButton>
      </div>
      {(busy || models === null || (catalog.length === 0 && !catalogFailed)) && (
        <div className="eui-asset-count">{busy ? 'Working…' : 'Loading…'}</div>
      )}
      <div className="eui-panel-body">
        <Shelf title="My files" count={models === null ? undefined : local.length}>
          <LocalGrid list={shownLocal} older={older} onUploaded={refresh} />
          {capped && (
            <div className="eui-asset-more">
              <LinkButton onClick={() => setAllFiles(true)}>
                Show all {local.length} files
              </LinkButton>
            </div>
          )}
        </Shelf>
        {catalogFailed ? (
          <p className="eui-asset-note">Catalog unavailable here. Use “Import files” to bring in models, images, sounds, videos or data files from your computer.</p>
        ) : (
          <Shelf title="Catalog" count={entries.length}>
            <CatalogGrid entries={entries} resetKey={`${f}|${category}`} />
          </Shelf>
        )}
        {nothing && (
          <SearchEmpty
            message="No assets match"
            query={filter}
            hints={matchHint(countPrefabMatches(f), 'Prefabs', () => props.onView('prefabs'))}
          />
        )}
      </div>
    </div>
  )
}
