import { flashair } from './client';
import type { FlashAirFileEntry } from './types';

/** Regex matching common image file extensions. */
const IMAGE_EXTENSIONS = /\.(jpe?g|png|bmp|gif)$/i;

type PollListener = (newImages: FlashAirFileEntry[]) => void;

/**
 * Polls the FlashAir card every 1.5 seconds using op=102 (hasUpdated).
 *
 * Uses an optimistic fast-path strategy:
 * - Tracks the "active" DCIM subdirectory (the newest/highest-numbered one).
 * - When an update is detected, lists just the active subdirectory (one request)
 *   and diffs against the known set.
 * - If the active subdir didn't change, lists /DCIM to check for new subdirs.
 *
 * The interval timer can be paused/resumed so other services (auto-cache) can
 * call `checkOnce()` between their own requests instead.
 */
class PollService {
  private _intervalId: ReturnType<typeof setInterval> | undefined;
  private _knownPaths = new Set<string>();
  private _rootDir = '/DCIM';
  private _listeners = new Set<PollListener>();
  private _polling = false;
  private _started = false;

  /** The active (newest) subdirectory path, e.g. "/DCIM/100__TSB". */
  private _activeSubdir: string | undefined;

  /** All known subdirectory paths under /DCIM. */
  private _knownSubdirs = new Set<string>();

  /** Subscribe to new-image events. Returns an unsubscribe function. */
  onNewImages(fn: PollListener): () => void {
    this._listeners.add(fn);
    return () => {
      this._listeners.delete(fn);
    };
  }

  /**
   * Start polling. Provide the initial set of known images so the first
   * diff doesn't treat everything as "new".
   */
  start(knownImages: readonly FlashAirFileEntry[], rootDir?: string): void {
    this.stop();
    this._rootDir = rootDir ?? '/DCIM';
    this._knownPaths.clear();
    this._knownSubdirs.clear();
    for (const img of knownImages) {
      this._knownPaths.add(img.path);
      this._knownSubdirs.add(img.directory);
    }
    this._activeSubdir = this._findNewestSubdir();
    this._started = true;
    this._startInterval();
  }

  /** Stop polling entirely. */
  stop(): void {
    this._started = false;
    this._stopInterval();
    this._polling = false;
  }

  /**
   * Pause the automatic interval timer.
   * The service stays "started" — `checkOnce()` can still be called,
   * and `resume()` will restart the timer.
   */
  pause(): void {
    this._stopInterval();
  }

  /**
   * Resume the automatic interval timer after a `pause()`.
   * No-op if the service hasn't been started.
   */
  resume(): void {
    if (!this._started) return;
    this._startInterval();
  }

  /**
   * Perform a single poll check (op=102 + fast detect) immediately.
   * Can be called while the interval is paused.
   * Returns the new images found (empty array if none).
   */
  async checkOnce(): Promise<FlashAirFileEntry[]> {
    if (this._polling || !this._started) return [];
    this._polling = true;

    try {
      const updated = await flashair.hasUpdated();
      if (!updated) return [];

      const detected = await this._fastDetect();
      if (detected.length > 0) {
        this._emit(detected);
      }
      return detected;
    } catch {
      return [];
    } finally {
      this._polling = false;
    }
  }

  /** Add a path to the known set. */
  addKnownPath(path: string): void {
    this._knownPaths.add(path);
  }

  /** Remove a path from the known set. */
  removeKnownPath(path: string): void {
    this._knownPaths.delete(path);
  }

  // --- private ---

  private _startInterval(): void {
    this._stopInterval();
    this._intervalId = setInterval(() => {
      void this._tick();
    }, 1500);
  }

  private _stopInterval(): void {
    if (this._intervalId !== undefined) {
      clearInterval(this._intervalId);
      this._intervalId = undefined;
    }
  }

  private _findNewestSubdir(): string | undefined {
    if (this._knownSubdirs.size === 0) return undefined;
    const sorted = [...this._knownSubdirs].sort();
    return sorted[sorted.length - 1];
  }

  private async _tick(): Promise<void> {
    if (this._polling) return;
    this._polling = true;

    try {
      const updated = await flashair.hasUpdated();
      if (!updated) return;

      const detected = await this._fastDetect();
      if (detected.length > 0) {
        this._emit(detected);
      }
    } catch {
      // Network error — silently retry next tick
    } finally {
      this._polling = false;
    }
  }

  /**
   * Fast detection:
   * 1. List the active subdirectory and diff.
   * 2. If no new images, list /DCIM for new subdirectories.
   * 3. If a new subdir exists, promote it and list it.
   */
  private async _fastDetect(): Promise<FlashAirFileEntry[]> {
    // Step 1: check active subdirectory
    if (this._activeSubdir !== undefined) {
      const newImages = await this._diffDirectory(this._activeSubdir);
      if (newImages.length > 0) return newImages;
    }

    // Step 2: list /DCIM for new subdirectories
    const dcimEntries = await flashair.listFiles(this._rootDir);
    const newSubdirs: string[] = [];
    for (const entry of dcimEntries) {
      if (entry.isDirectory && !this._knownSubdirs.has(entry.path)) {
        newSubdirs.push(entry.path);
        this._knownSubdirs.add(entry.path);
      }
    }

    // Check for images directly in /DCIM
    const dcimImages: FlashAirFileEntry[] = [];
    for (const entry of dcimEntries) {
      if (
        !entry.isDirectory &&
        IMAGE_EXTENSIONS.test(entry.filename) &&
        !this._knownPaths.has(entry.path)
      ) {
        dcimImages.push(entry);
        this._knownPaths.add(entry.path);
      }
    }

    // Step 3: promote newest new subdir and list it
    if (newSubdirs.length > 0) {
      newSubdirs.sort();
      const newest = newSubdirs[newSubdirs.length - 1];
      if (newest !== undefined) {
        this._activeSubdir = newest;
        const subImages = await this._diffDirectory(newest);
        const all = [...subImages, ...dcimImages];
        all.sort((a, b) => {
          const d = b.rawDate - a.rawDate;
          if (d !== 0) return d;
          return b.rawTime - a.rawTime;
        });
        return all;
      }
    }

    if (dcimImages.length > 0) {
      dcimImages.sort((a, b) => {
        const d = b.rawDate - a.rawDate;
        if (d !== 0) return d;
        return b.rawTime - a.rawTime;
      });
      return dcimImages;
    }

    return [];
  }

  private async _diffDirectory(dir: string): Promise<FlashAirFileEntry[]> {
    const entries = await flashair.listFiles(dir);
    const newImages: FlashAirFileEntry[] = [];

    for (const entry of entries) {
      if (
        !entry.isDirectory &&
        IMAGE_EXTENSIONS.test(entry.filename) &&
        !this._knownPaths.has(entry.path)
      ) {
        newImages.push(entry);
        this._knownPaths.add(entry.path);
      }
    }

    newImages.sort((a, b) => {
      const dateCompare = b.rawDate - a.rawDate;
      if (dateCompare !== 0) return dateCompare;
      return b.rawTime - a.rawTime;
    });

    return newImages;
  }

  private _emit(newImages: FlashAirFileEntry[]): void {
    for (const fn of this._listeners) {
      fn(newImages);
    }
  }
}

/** Singleton instance. */
export const pollService = new PollService();
