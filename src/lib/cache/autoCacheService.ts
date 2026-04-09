import { flashair } from '../flashair';
import type { FlashAirFileEntry } from '../flashair';
import { imageCache } from './imageCache';

/**
 * Reactive state for the auto-cache background service.
 *
 * Uses Svelte 5 $state runes via the .svelte.ts convention — but since this
 * is a plain .ts file consumed by Svelte components, we store reactive values
 * in a simple mutable object that components can poll or subscribe to via
 * a wrapper.  We use a manual callback approach instead.
 */

/** Progress of a single image being auto-cached (0–1). */
export interface AutoCacheProgress {
  readonly path: string;
  readonly progress: number;
}

type Listener = () => void;

/**
 * Singleton auto-cache service.
 *
 * Call `start(images)` after loading the image list.  The service will
 * iterate newest-first, skip already-cached images, and download full-size
 * images in the background one at a time.
 *
 * When a user-initiated download is active, call `pauseForUserDownload()`
 * / `resumeAfterUserDownload()` to yield bandwidth.
 */
class AutoCacheService {
  /** Map from image path → download progress 0–1. Only contains entries being cached. */
  private _progressMap = new Map<string, number>();

  /** Set of paths that are confirmed cached (full). */
  private _cachedPaths = new Set<string>();

  /** Whether the user is actively downloading an image. */
  private _userDownloading = false;

  /** The AbortController for the current background download. */
  private _currentAbort: AbortController | undefined;

  /** The image list to work through (newest first). */
  private _images: FlashAirFileEntry[] = [];

  /** Index of the next image to check/download. */
  private _nextIndex = 0;

  /** Whether the service is running. */
  private _running = false;

  /** Whether we're actively downloading right now. */
  private _downloading = false;

  /** Listeners notified on every progress change. */
  private _listeners = new Set<Listener>();

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => {
      this._listeners.delete(fn);
    };
  }

  private _notify(): void {
    for (const fn of this._listeners) {
      fn();
    }
  }

  /** Get progress for a specific image path. Returns undefined if not being cached. */
  getProgress(path: string): number | undefined {
    return this._progressMap.get(path);
  }

  /** Whether the service is actively caching (running and not finished). */
  get isActive(): boolean {
    return this._running && (this._downloading || this._nextIndex < this._images.length);
  }

  /** Number of images confirmed cached so far. */
  get cachedCount(): number {
    return this._cachedPaths.size;
  }

  /** Total number of images in the work queue. */
  get totalCount(): number {
    return this._images.length;
  }

  /** Check if a path has been confirmed fully cached. */
  isCached(path: string): boolean {
    return this._cachedPaths.has(path);
  }

  /**
   * Start (or restart) auto-caching for the given image list.
   * Images should already be sorted newest-first.
   */
  start(images: readonly FlashAirFileEntry[]): void {
    this.stop();
    this._images = [...images];
    this._nextIndex = 0;
    this._running = true;
    this._cachedPaths.clear();
    this._progressMap.clear();
    this._notify();
    void this._processNext();
  }

  /** Stop all background caching. */
  stop(): void {
    this._running = false;
    if (this._currentAbort !== undefined) {
      this._currentAbort.abort();
      this._currentAbort = undefined;
    }
    this._progressMap.clear();
    this._downloading = false;
    this._notify();
  }

  /** Mark a path as cached externally (e.g. the user just viewed it). */
  markCached(path: string): void {
    this._cachedPaths.add(path);
  }

  /** Pause background downloads while the user is downloading. */
  pauseForUserDownload(): void {
    this._userDownloading = true;
    if (this._currentAbort !== undefined) {
      this._currentAbort.abort();
      this._currentAbort = undefined;
    }
    // Clear progress for the aborted download — it will be retried.
    this._progressMap.clear();
    this._downloading = false;
    this._notify();
  }

  /** Resume background downloads after user download completes. */
  resumeAfterUserDownload(): void {
    this._userDownloading = false;
    if (this._running) {
      void this._processNext();
    }
  }

  /** Remove a path from the work queue (e.g. after deletion). */
  removeImage(path: string): void {
    this._images = this._images.filter((img) => img.path !== path);
    this._cachedPaths.delete(path);
    this._progressMap.delete(path);
    // Reset index to avoid skipping
    if (this._nextIndex > this._images.length) {
      this._nextIndex = this._images.length;
    }
    this._notify();
  }

  private async _processNext(): Promise<void> {
    if (!this._running || this._userDownloading || this._downloading) return;

    while (this._nextIndex < this._images.length) {
      if (!this._running || this._userDownloading) return;

      const image = this._images[this._nextIndex];
      if (image === undefined) {
        this._nextIndex++;
        continue;
      }

      // Skip if already confirmed cached
      if (this._cachedPaths.has(image.path)) {
        this._nextIndex++;
        continue;
      }

      // Check IndexedDB cache
      const cached = await imageCache.get('full', image.path);
      if (cached !== undefined) {
        this._cachedPaths.add(image.path);
        this._nextIndex++;
        this._notify();
        continue;
      }

      // Not cached — download it
      if (this._userDownloading || !this._running) return;

      const success = await this._downloadImage(image);
      if (success) {
        this._cachedPaths.add(image.path);
        this._progressMap.delete(image.path);
        this._nextIndex++;
        this._notify();
      } else if (this._running && !this._userDownloading) {
        // Download failed (not aborted) — skip this image and move on
        this._progressMap.delete(image.path);
        this._nextIndex++;
        this._notify();
      }
      // If aborted due to user download, don't advance — will retry
    }
  }

  private async _downloadImage(image: FlashAirFileEntry): Promise<boolean> {
    this._downloading = true;
    const abort = new AbortController();
    this._currentAbort = abort;

    this._progressMap.set(image.path, 0);
    this._notify();

    const url = flashair.fileUrl(image.path);
    const totalBytes = image.size;

    try {
      const res = await fetch(url, { signal: abort.signal });
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }

      const reader = res.body?.getReader();
      if (reader === undefined) {
        const blob = await res.blob();
        if (abort.signal.aborted) return false;
        void imageCache.put('full', image.path, blob);
        this._progressMap.set(image.path, 1);
        this._notify();
        return true;
      }

      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        const progress = totalBytes > 0 ? received / totalBytes : 0;
        this._progressMap.set(image.path, progress);
        this._notify();
      }

      if (abort.signal.aborted) return false;

      const blob = new Blob(chunks);
      void imageCache.put('full', image.path, blob);
      this._progressMap.set(image.path, 1);
      this._notify();
      return true;
    } catch (e) {
      if (abort.signal.aborted) return false;
      // Network error — skip this image
      console.warn(`Auto-cache failed for ${image.path}:`, e);
      return false;
    } finally {
      this._downloading = false;
      this._currentAbort = undefined;
    }
  }
}

/** Singleton instance. */
export const autoCacheService = new AutoCacheService();
