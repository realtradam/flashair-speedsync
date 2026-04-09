import type { ThumbnailMeta } from '../flashair/types';

const DB_NAME = 'speedsync-cache';
const DB_VERSION = 1;
const STORE_NAME = 'images';

export interface CachedImage {
  /** The file path on the SD card, used as the primary key. */
  readonly path: string;
  /** 'thumbnail' or 'full' — separates the two image sizes. */
  readonly kind: 'thumbnail' | 'full';
  /** The image data. */
  readonly blob: Blob;
  /** EXIF metadata (only for thumbnails). */
  readonly meta: ThumbnailMeta | undefined;
  /** Unix timestamp (ms) when this entry was stored. */
  readonly storedAt: number;
}

type CacheKey = `${'thumbnail' | 'full'}:${string}`;

function makeCacheKey(kind: 'thumbnail' | 'full', path: string): CacheKey {
  return `${kind}:${path}`;
}

// ---------------------------------------------------------------------------
// In-memory layer — guarantees that a put() is immediately visible to get()
// without waiting for the IndexedDB transaction to commit.  This is critical
// because the auto-cache service calls `void imageCache.put(...)` (fire-and-
// forget) and a subsequent get() in ImagePreview must find the data.
// ---------------------------------------------------------------------------
const memoryCache = new Map<CacheKey, CachedImage>();

// ---------------------------------------------------------------------------
// IndexedDB persistence layer — survives page refreshes.
// ---------------------------------------------------------------------------

/** Shared DB connection (lazy, created once). */
let dbInstance: IDBDatabase | undefined;
let dbPromise: Promise<IDBDatabase | undefined> | undefined;

function openDb(): Promise<IDBDatabase | undefined> {
  if (dbInstance !== undefined) return Promise.resolve(dbInstance);
  if (dbPromise !== undefined) return dbPromise;

  dbPromise = new Promise<IDBDatabase | undefined>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        dbInstance = request.result;

        // If the connection is unexpectedly closed, reset so we can reopen.
        dbInstance.onclose = () => {
          dbInstance = undefined;
          dbPromise = undefined;
        };

        resolve(dbInstance);
      };

      request.onerror = () => {
        dbPromise = undefined;
        resolve(undefined);
      };
    } catch {
      dbPromise = undefined;
      resolve(undefined);
    }
  });

  return dbPromise;
}

interface StoredRecord {
  readonly key: CacheKey;
  readonly path: string;
  readonly kind: 'thumbnail' | 'full';
  readonly blob: Blob;
  readonly meta: ThumbnailMeta | undefined;
  readonly storedAt: number;
}

/** Read a single record from IndexedDB. Returns undefined on any failure. */
async function idbGet(key: CacheKey): Promise<StoredRecord | undefined> {
  const db = await openDb();
  if (db === undefined) return undefined;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        resolve((request.result as StoredRecord | undefined) ?? undefined);
      };
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

/** Last write error (if any) — exposed via getStats() for diagnostics. */
let lastWriteError: string | undefined;
let writeErrorCount = 0;

/** Write a record to IndexedDB (best-effort). */
async function idbPut(record: StoredRecord): Promise<void> {
  const db = await openDb();
  if (db === undefined) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(record);
      tx.oncomplete = () => {
        lastWriteError = undefined;
        resolve();
      };
      tx.onerror = () => {
        const msg = tx.error?.message ?? 'unknown write error';
        lastWriteError = msg;
        writeErrorCount++;
        console.warn(`[imageCache] IDB write failed: ${msg}`);
        resolve();
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastWriteError = msg;
      writeErrorCount++;
      console.warn(`[imageCache] IDB write exception: ${msg}`);
      resolve();
    }
  });
}

/** Delete a record from IndexedDB by key. */
async function idbDelete(key: CacheKey): Promise<void> {
  const db = await openDb();
  if (db === undefined) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** 30 days in milliseconds. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function isExpired(storedAt: number): boolean {
  return Date.now() - storedAt > CACHE_TTL_MS;
}

export const imageCache = {
  /**
   * Retrieve a cached image.
   *
   * Checks the in-memory Map first (instant), then falls back to IndexedDB.
   * Returns undefined if not found or expired.
   */
  async get(kind: 'thumbnail' | 'full', path: string): Promise<CachedImage | undefined> {
    const key = makeCacheKey(kind, path);

    // Fast path: in-memory
    const mem = memoryCache.get(key);
    if (mem !== undefined) {
      if (isExpired(mem.storedAt)) {
        memoryCache.delete(key);
        void idbDelete(key);
        return undefined;
      }
      return mem;
    }

    // Slow path: IndexedDB
    const record = await idbGet(key);
    if (record === undefined) return undefined;
    if (isExpired(record.storedAt)) {
      void idbDelete(key);
      return undefined;
    }

    const cached: CachedImage = {
      path: record.path,
      kind: record.kind,
      blob: record.blob,
      meta: record.meta,
      storedAt: record.storedAt,
    };
    // Promote to memory for future fast lookups
    memoryCache.set(key, cached);
    return cached;
  },

  /**
   * Store an image in the cache.
   *
   * Writes to the in-memory Map synchronously (before the first await),
   * so fire-and-forget callers (`void imageCache.put(...)`) make data
   * instantly visible to subsequent get() calls.
   * IndexedDB persistence happens in the background.
   */
  async put(kind: 'thumbnail' | 'full', path: string, blob: Blob, meta?: ThumbnailMeta): Promise<void> {
    const key = makeCacheKey(kind, path);
    const storedAt = Date.now();

    const cached: CachedImage = { path, kind, blob, meta, storedAt };

    // Instant: write to memory
    memoryCache.set(key, cached);

    // Background: persist to IndexedDB
    const record: StoredRecord = { key, path, kind, blob, meta, storedAt };
    await idbPut(record);
  },

  /**
   * Delete a single entry from the cache.
   */
  async delete(kind: 'thumbnail' | 'full', path: string): Promise<void> {
    const key = makeCacheKey(kind, path);
    memoryCache.delete(key);
    await idbDelete(key);
  },

  /**
   * Remove all expired entries from the cache.
   */
  async pruneExpired(): Promise<void> {
    // Prune in-memory
    for (const [key, entry] of memoryCache) {
      if (isExpired(entry.storedAt)) {
        memoryCache.delete(key);
      }
    }

    // Prune IndexedDB
    const db = await openDb();
    if (db === undefined) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.openCursor();
        const keysToDelete: IDBValidKey[] = [];

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor !== null) {
            const record = cursor.value as StoredRecord;
            if (isExpired(record.storedAt)) {
              keysToDelete.push(cursor.key);
            }
            cursor.continue();
          } else {
            for (const k of keysToDelete) {
              store.delete(k);
            }
          }
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  },

  /**
   * Get diagnostic information about the cache.
   */
  async getStats(): Promise<{
    entries: number;
    fullCount: number;
    thumbCount: number;
    totalBytes: number;
    idbEntries: number;
    idbBytes: number;
    idbError: string | undefined;
    idbLastWriteError: string | undefined;
    idbWriteErrorCount: number;
  }> {
    let fullCount = 0;
    let thumbCount = 0;
    let totalBytes = 0;
    for (const entry of memoryCache.values()) {
      if (entry.kind === 'full') fullCount++;
      else thumbCount++;
      totalBytes += entry.blob.size;
    }

    let idbEntries = 0;
    let idbBytes = 0;
    let idbError: string | undefined;

    try {
      const db = await openDb();
      if (db !== undefined) {
        const result = await new Promise<{ entries: number; bytes: number }>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.openCursor();
          let entries = 0;
          let bytes = 0;

          req.onsuccess = () => {
            const cursor = req.result;
            if (cursor !== null) {
              const rec = cursor.value as StoredRecord;
              entries++;
              if (rec.blob) bytes += rec.blob.size;
              cursor.continue();
            }
          };

          tx.oncomplete = () => resolve({ entries, bytes });
          tx.onerror = () => reject(new Error(tx.error?.message ?? 'unknown'));
        });
        idbEntries = result.entries;
        idbBytes = result.bytes;
      }
    } catch (e) {
      idbError = e instanceof Error ? e.message : String(e);
    }

    return {
      entries: memoryCache.size,
      fullCount,
      thumbCount,
      totalBytes,
      idbEntries,
      idbBytes,
      idbError,
      idbLastWriteError: lastWriteError,
      idbWriteErrorCount: writeErrorCount,
    };
  },

  /**
   * Clear the entire cache.
   */
  async clear(): Promise<void> {
    memoryCache.clear();

    const db = await openDb();
    if (db === undefined) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  },
} as const;
