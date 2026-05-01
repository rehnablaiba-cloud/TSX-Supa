/**
 * idbCache.ts
 *
 * Minimal stale-while-revalidate cache backed by IndexedDB.
 * No external dependencies — uses the native IDB API directly.
 *
 * Usage:
 *   const cached = await idbGet<DashboardModule[]>("dashboard-modules");
 *   await idbSet("dashboard-modules", freshModules);
 */

const DB_NAME    = "testpro-cache";
const STORE_NAME = "kv";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => {
      dbPromise = null; // allow retry
      reject(req.error);
    };
  });

  return dbPromise;
}

export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx  = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror   = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx  = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve(); // non-fatal
    });
  } catch {
    // IDB unavailable (private browsing etc.) — degrade silently
  }
}
