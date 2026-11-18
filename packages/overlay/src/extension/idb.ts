/**
 * The review's store in the browser (PRD-connect F-166): one IndexedDB object store of keys and
 * values, in the extension's own origin — the service worker and the review page open the same
 * one, and no site can (N-44 of PRD-extension holds: nothing is kept in a site's storage).
 * `chrome.storage.local` is not used for it: screenshots are large and its quota is small.
 */
import type { Kv } from "./standalone.js";

const DB = "crt-review";
const STORE = "kv";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("the browser refused the review's store"));
  });
}

export function idbKv(): Kv {
  let db: Promise<IDBDatabase> | null = null;
  const run = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    db ??= open();
    const store = (await db).transaction(STORE, mode).objectStore(STORE);
    return new Promise<T>((resolve, reject) => {
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("the review's store failed"));
    });
  };
  return {
    get: (key) => run("readonly", (s) => s.get(key) as IDBRequest<unknown>),
    set: async (key, value) => void (await run("readwrite", (s) => s.put(value, key))),
    delete: async (key) => void (await run("readwrite", (s) => s.delete(key))),
    keys: async (prefix) => (await run("readonly", (s) => s.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)))).map(String).sort(),
  };
}
