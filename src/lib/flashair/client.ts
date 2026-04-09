import type { FlashAirFileEntry, ThumbnailMeta } from './types';

/** Parse a 16-bit FAT date + time into a JS Date. */
function parseFatDateTime(fatDate: number, fatTime: number): Date {
  const year = ((fatDate >> 9) & 0x7f) + 1980;
  const month = (fatDate >> 5) & 0x0f;
  const day = fatDate & 0x1f;
  const hour = (fatTime >> 11) & 0x1f;
  const minute = (fatTime >> 5) & 0x3f;
  const second = (fatTime & 0x1f) * 2;
  return new Date(year, month - 1, day, hour, minute, second);
}

/** Attribute bit 4 indicates a directory. */
function isDirectory(attribute: number): boolean {
  return (attribute & 0x10) !== 0;
}

/**
 * Resolve the base URL for FlashAir API requests.
 *
 * In production (served from the card), all requests go to the same origin.
 * In development, we use the Vite dev server origin (which can proxy if configured).
 */
function getBaseUrl(): string {
  return '';
}

/**
 * Parse the text response from command.cgi op=100 into structured entries.
 *
 * First line is the header "WLANSD_FILELIST" and is skipped.
 * Each subsequent line: <directory>,<filename>,<size>,<attribute>,<date>,<time>
 * Note: filenames may contain commas, so we split from the right for the numeric fields.
 */
function parseFileList(text: string): FlashAirFileEntry[] {
  const lines = text.trim().split('\n');
  const entries: FlashAirFileEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.trim() === '') continue;

    // Split from the right: the last 4 fields are always numeric (size, attribute, date, time).
    // The first field is directory, and everything between is the filename (which may contain commas).
    const parts = line.split(',');
    if (parts.length < 6) continue;

    const rawTime = Number(parts[parts.length - 1]);
    const rawDate = Number(parts[parts.length - 2]);
    const attribute = Number(parts[parts.length - 3]);
    const size = Number(parts[parts.length - 4]);
    const directory = parts[0] ?? '';
    // Filename is everything between the first and last 4 fields
    const filename = parts.slice(1, parts.length - 4).join(',');

    const date = parseFatDateTime(rawDate, rawTime);
    const dir = isDirectory(attribute);
    const path = directory === '' ? `/${filename}` : `${directory}/${filename}`;

    entries.push({
      directory,
      filename,
      size,
      attribute,
      rawDate,
      rawTime,
      date,
      isDirectory: dir,
      path,
    });
  }

  return entries;
}

/** Known image extensions the FlashAir thumbnail.cgi supports (JPEG only). */
const JPEG_EXTENSIONS = new Set(['.jpg', '.jpeg']);

/** Regex matching common image file extensions. */
const IMAGE_EXTENSIONS = /\.(jpe?g|png|bmp|gif)$/i;

function isJpeg(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return JPEG_EXTENSIONS.has(ext);
}

/**
 * FlashAir API client.
 *
 * All methods return promises and throw on network/HTTP errors.
 */
export const flashair = {
  /**
   * List files in a directory.
   * @param dir - Absolute path on the card, e.g. "/DCIM"
   */
  async listFiles(dir: string): Promise<FlashAirFileEntry[]> {
    const base = getBaseUrl();
    const res = await fetch(`${base}/command.cgi?op=100&DIR=${encodeURIComponent(dir)}`);
    if (!res.ok) throw new Error(`listFiles failed: ${res.status} ${res.statusText}`);
    const text = await res.text();
    return parseFileList(text);
  },

  /**
   * Get the number of files in a directory.
   */
  async getFileCount(dir: string): Promise<number> {
    const base = getBaseUrl();
    const res = await fetch(`${base}/command.cgi?op=101&DIR=${encodeURIComponent(dir)}`);
    if (!res.ok) throw new Error(`getFileCount failed: ${res.status} ${res.statusText}`);
    const text = await res.text();
    return Number(text.trim());
  },

  /**
   * Check if the card memory has been updated since last check.
   * Returns true if updated. Calling this clears the flag.
   */
  async hasUpdated(): Promise<boolean> {
    const base = getBaseUrl();
    const res = await fetch(`${base}/command.cgi?op=102`);
    if (!res.ok) throw new Error(`hasUpdated failed: ${res.status} ${res.statusText}`);
    const text = await res.text();
    return text.trim() === '1';
  },

  /**
   * Get the firmware version string.
   */
  async getFirmwareVersion(): Promise<string> {
    const base = getBaseUrl();
    const res = await fetch(`${base}/command.cgi?op=108`);
    if (!res.ok) throw new Error(`getFirmwareVersion failed: ${res.status} ${res.statusText}`);
    return (await res.text()).trim();
  },

  /**
   * Get SSID of the FlashAir.
   */
  async getSSID(): Promise<string> {
    const base = getBaseUrl();
    const res = await fetch(`${base}/command.cgi?op=104`);
    if (!res.ok) throw new Error(`getSSID failed: ${res.status} ${res.statusText}`);
    return (await res.text()).trim();
  },

  /**
   * Get the number of free sectors on the card.
   */
  async getFreeSectors(): Promise<number> {
    const base = getBaseUrl();
    const res = await fetch(`${base}/command.cgi?op=140`);
    if (!res.ok) throw new Error(`getFreeSectors failed: ${res.status} ${res.statusText}`);
    return Number((await res.text()).trim());
  },

  /**
   * Get the URL for a file on the card.
   */
  fileUrl(path: string): string {
    return `${getBaseUrl()}${path}`;
  },

  /**
   * Get the thumbnail URL for a JPEG file.
   * Returns undefined if the file is not a JPEG (thumbnails only work for JPEGs).
   */
  thumbnailUrl(path: string): string | undefined {
    const filename = path.slice(path.lastIndexOf('/') + 1);
    if (!isJpeg(filename)) return undefined;
    return `${getBaseUrl()}/thumbnail.cgi?${path}`;
  },

  /**
   * Fetch a thumbnail and its EXIF metadata.
   * Returns the blob and optional EXIF dimensions/orientation.
   */
  async fetchThumbnail(path: string): Promise<{ blob: Blob; meta: ThumbnailMeta }> {
    const url = flashair.thumbnailUrl(path);
    if (url === undefined) throw new Error(`Not a JPEG file: ${path}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetchThumbnail failed: ${res.status} ${res.statusText}`);
    const blob = await res.blob();

    const widthStr = res.headers.get('X-exif-WIDTH');
    const heightStr = res.headers.get('X-exif-HEIGHT');
    const orientStr = res.headers.get('X-exif-ORIENTATION');

    const meta: ThumbnailMeta = {
      width: widthStr !== null ? Number(widthStr) : undefined,
      height: heightStr !== null ? Number(heightStr) : undefined,
      orientation: orientStr !== null ? Number(orientStr) : undefined,
    };

    return { blob, meta };
  },
  /**
   * Delete a file from the FlashAir card.
   * Requires UPLOAD=1 in the CONFIG file.
   * @param path - Absolute path on the card, e.g. "/DCIM/100__TSB/DSC_0001.JPG"
   */
  async deleteFile(path: string): Promise<void> {
    const base = getBaseUrl();
    const res = await fetch(`${base}/upload.cgi?DEL=${path}`);
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(
          'File deletion is not enabled. Add UPLOAD=1 to /SD_WLAN/CONFIG on the SD card and restart the FlashAir.'
        );
      }
      throw new Error(`deleteFile failed: ${res.status} ${res.statusText}`);
    }
    const text = await res.text();
    if (text.trim() !== 'SUCCESS') {
      throw new Error(`deleteFile failed: card returned ${text.trim()}`);
    }
  },

  /**
   * Recursively list all image files on the card starting from a root directory.
   * Returns files sorted by date, newest first.
   */
  async listAllImages(rootDir: string): Promise<FlashAirFileEntry[]> {
    const allImages: FlashAirFileEntry[] = [];
    const dirsToVisit: string[] = [rootDir];

    while (dirsToVisit.length > 0) {
      const dir = dirsToVisit.pop();
      if (dir === undefined) break;

      let entries: FlashAirFileEntry[];
      try {
        entries = await flashair.listFiles(dir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.isDirectory) {
          dirsToVisit.push(entry.path);
        } else if (IMAGE_EXTENSIONS.test(entry.filename)) {
          allImages.push(entry);
        }
      }
    }

    allImages.sort((a, b) => {
      const dateCompare = b.rawDate - a.rawDate;
      if (dateCompare !== 0) return dateCompare;
      return b.rawTime - a.rawTime;
    });

    return allImages;
  },
} as const;

export type { FlashAirFileEntry, ThumbnailMeta } from './types';
