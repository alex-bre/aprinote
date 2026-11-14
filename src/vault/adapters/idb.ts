/**
 * A small IndexedDB store for the FSA directory handle and the id of the adapter
 * the vault was last opened with. Handles are structured-cloneable but not
 * serialisable, so localStorage cannot hold them.
 *
 * Inside `adapters/` on purpose — this is the browser storage the portability
 * rule confines to this directory.
 */

const DB = 'aprinote'
const STORE = 'grants'
const VERSION = 1
const ADAPTER_KEY = 'vault-adapter'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const request = act(tx.objectStore(STORE))
        request.onsuccess = () => resolve(request.result as T)
        request.onerror = () => reject(request.error)
        tx.oncomplete = () => db.close()
      }),
  )
}

export function getGrant<T>(key: string): Promise<T | undefined> {
  return run<T | undefined>('readonly', (store) => store.get(key)).catch(() => undefined)
}

export function putGrant(key: string, value: unknown): Promise<void> {
  return run<void>('readwrite', (store) => store.put(value, key)).catch(() => undefined) as Promise<void>
}

export function deleteGrant(key: string): Promise<void> {
  return run<void>('readwrite', (store) => store.delete(key)).catch(() => undefined) as Promise<void>
}

/**
 * Which adapter opened the vault last. Both adapters can have something to
 * restore at once — an FSA grant and an in-browser vault — so without this the
 * restore order alone would decide, and picking the in-browser vault on Chromium
 * would silently not survive a reload.
 */
export function rememberAdapter(id: string): Promise<void> {
  return putGrant(ADAPTER_KEY, id)
}

export function lastAdapter(): Promise<string | undefined> {
  return getGrant<string>(ADAPTER_KEY)
}
