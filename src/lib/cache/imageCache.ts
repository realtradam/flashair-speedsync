import type { ThumbnailMeta } from '../flashair/types';

const DB_NAME = 'speedsync-cache';
const DB_VERSION = 1;
const STORE_NAME = 'images';

/** 30 days in milliseconds. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message ?? 'unknown error'}`));
    };
  });
}

interface StoredRecord {
  readonly key: CacheKey;
  readonly path: string;
  readonly kind: 'thumbnail' | 'full';
  readonly blob: Blob;
  readonly meta: ThumbnailMeta | undefined;
  readonly storedAt: number;
}

function isExpired(storedAt: number): boolean {
  return Date.now() - storedAt > CACHE_TTL_MS;
}

export const imageCache = {
  /**
   * Retrieve a cached image. Returns undefined if not found or expired.
   */
  async get(kind: 'thumbnail' | 'full', path: string): Promise<CachedImage | undefined> {
    let db: IDBDatabase;
    try {
      db = await openDb();
    } catch {
      return undefined;
    }

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const key = makeCacheKey(kind, path);
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result as StoredRecord | undefined;
        if (record === undefined || record === null) {
          resolve(undefined);
          return;
        }
        if (isExpired(record.storedAt)) {
          // Expired — remove in background, return undefined
          void imageCache.delete(kind, path);
          resolve(undefined);
          return;
        }
        resolve({
          path: record.path,
          kind: record.kind,
          blob: record.blob,
          meta: record.meta,
          storedAt: record.storedAt,
        });
      };

      request.onerror = () => {
        resolve(undefined);
      };

      tx.oncomplete = () => {
        db.close();
      };
    });
  },

  /**
   * Store an image in the cache.
   */
  async put(kind: 'thumbnail' | 'full', path: string, blob: Blob, meta?: ThumbnailMeta): Promise<void> {
    let db: IDBDatabase;
    try {
      db = await openDb();
    } catch {
      return;
    }

    const record: StoredRecord = {
      key: makeCacheKey(kind, path),
      path,
      kind,
      blob,
      meta,
      storedAt: Date.now(),
    };

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(record);

      tx.oncomplete = () => {
        db.close();
        resolve();
      };

      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  },

  /**
   * Delete a single entry from the cache.
   */
  async delete(kind: 'thumbnail' | 'full', path: string): Promise<void> {
    let db: IDBDatabase;
    try {
      db = await openDb();
    } catch {
      return;
    }

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(makeCacheKey(kind, path));

      tx.oncomplete = () => {
        db.close();
        resolve();
      };

      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  },

  /**
   * Remove all expired entries from the cache. Call periodically or on startup.
   */
  async pruneExpired(): Promise<void> {
    let db: IDBDatabase;
    try {
      db = await openDb();
    } catch {
      return;
    }

    return new Promise((resolve) => {
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
          for (const key of keysToDelete) {
            store.delete(key);
          }
        }
      };

      tx.oncomplete = () => {
        db.close();
        resolve();
      };

      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  },

  /**
   * Clear the entire cache.
   */
  async clear(): Promise<void> {
    let db: IDBDatabase;
    try {
      db = await openDb();
    } catch {
      return;
    }

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();

      tx.oncomplete = () => {
        db.close();
        resolve();
      };

      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  },
} as const;
