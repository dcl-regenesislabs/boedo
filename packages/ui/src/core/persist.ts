// Persisted UI choices — the dock's width and open flags, the left tab — all
// under one `eui:` key prefix, in IndexedDB. The string-union case takes the guard from its
// caller: a stored value that no longer names anything real — a renamed tab, a
// downgrade — must not be trusted.
import { useState } from 'react'

const storageKey = (name: string): string => `eui:${name}`

// IndexedDB, not localStorage: a page reading localStorage loads the origin's whole storage area,
// and the explorer's web shell keeps the sign-in key there, so it forbids the app that read.
// Everything is read once into memory (persistReady), so reads stay synchronous.
const DB_NAME = 'dcl-editor'
const STORE = 'prefs'
// what earlier versions kept in localStorage, copied over once where it is still readable
const LEGACY_KEYS = /^(eui:|dcl-editor[.:]|dcl-auth-env$|auth-server-provider-address$)/
const MIGRATED = '__migrated-from-local-storage'

const cache = new Map<string, string>()
let db: IDBDatabase | null = null
let backed = false
const loaded = new Set<() => void>()

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function openDb(): Promise<IDBDatabase> {
  const open = indexedDB.open(DB_NAME, 1)
  open.onupgradeneeded = () => open.result.createObjectStore(STORE)
  return request(open)
}

function put(key: string, value: string | null): void {
  if (db === null) return
  try {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
    if (value === null) store.delete(key)
    else store.put(value, key)
  } catch {
    // a closed or full database: the choice lasts the session
  }
}

function legacyEntries(): Array<[string, string]> {
  try {
    const out: Array<[string, string]> = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      const value = key === null ? null : localStorage.getItem(key)
      if (key !== null && value !== null && LEGACY_KEYS.test(key)) out.push([key, value])
    }
    return out
  } catch {
    return []
  }
}

async function load(): Promise<void> {
  try {
    if (typeof indexedDB === 'undefined') return
    db = await openDb()
    const store = db.transaction(STORE, 'readonly').objectStore(STORE)
    const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())])
    keys.forEach((key, i) => {
      if (typeof key === 'string' && typeof values[i] === 'string') cache.set(key, values[i] as string)
    })
    backed = true
    if (!cache.has(MIGRATED)) {
      for (const [key, value] of legacyEntries()) if (!cache.has(key)) writeKey(key, value)
      writeKey(MIGRATED, '1')
    }
  } catch {
    // no IndexedDB here (blocked, private window): reads fall back, writes last the session
    db = null
  } finally {
    for (const fn of loaded) fn()
  }
}

/** Settles once stored choices are readable; the editor renders after it. */
export const persistReady: Promise<void> = load()

/** For module stores read at import, before persistReady: `fn` runs again once it settles. */
export function whenPersisted(fn: () => void): void {
  loaded.add(fn)
}

export function readKey(key: string): string | null {
  if (backed) return cache.get(key) ?? null
  // before IndexedDB answers, or where there is none (tests): what localStorage still offers
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeKey(key: string, value: string): void {
  cache.set(key, value)
  if (db !== null) return put(key, value)
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

export function removeKey(key: string): void {
  cache.delete(key)
  if (db !== null) return put(key, null)
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

/** Whether this choice has ever been made — a first run has no stored value. */
export function storedValue(name: string): string | null {
  return readKey(storageKey(name))
}

function store(name: string, value: string): void {
  writeKey(storageKey(name), value)
}

/** Read/write a flag outside React — for the module stores (chrome, ai-store),
 *  whose state has to be settable from plain functions. */
export function storedFlag(name: string, initial: boolean): boolean {
  const stored = storedValue(name)
  return stored === null ? initial : stored === '1'
}

export function setStoredFlag(name: string, value: boolean): void {
  store(name, value ? '1' : '0')
}

export function usePersistentFlag(name: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => storedFlag(name, initial))
  return [
    v,
    (next: boolean) => {
      setStoredFlag(name, next)
      setV(next)
    }
  ]
}

export function usePersistentNum(name: string, initial: number): [number, (v: number) => void] {
  const [v, setV] = useState(() => {
    const n = Number(storedValue(name))
    return Number.isFinite(n) && n > 0 ? n : initial
  })
  return [
    v,
    (next: number) => {
      store(name, String(next))
      setV(next)
    }
  ]
}

export function usePersistentEnum<T extends string>(
  name: string,
  initial: T,
  valid: (v: string) => v is T
): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    const stored = storedValue(name)
    return stored !== null && valid(stored) ? stored : initial
  })
  return [
    v,
    (next: T) => {
      store(name, next)
      setV(next)
    }
  ]
}
