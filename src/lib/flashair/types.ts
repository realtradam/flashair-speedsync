/**
 * A single file entry returned by command.cgi op=100.
 *
 * Raw response format per line:
 *   <directory>,<filename>,<size>,<attribute>,<date>,<time>
 *
 * Date is a 16-bit FAT date: bits 15-9 = year (since 1980), 8-5 = month, 4-0 = day.
 * Time is a 16-bit FAT time: bits 15-11 = hour, 10-5 = minute, 4-0 = second/2.
 * Attribute is a 16-bit field: bit5=archive, bit4=directory, bit3=volume, bit2=system, bit1=hidden, bit0=readonly.
 */
export interface FlashAirFileEntry {
  /** Parent directory path, e.g. "/DCIM/100__TSB" */
  readonly directory: string;
  /** File name, e.g. "DSC_0001.JPG" */
  readonly filename: string;
  /** File size in bytes */
  readonly size: number;
  /** Raw FAT attribute value */
  readonly attribute: number;
  /** Raw FAT date value */
  readonly rawDate: number;
  /** Raw FAT time value */
  readonly rawTime: number;
  /** Parsed JS Date */
  readonly date: Date;
  /** Whether this entry is a directory */
  readonly isDirectory: boolean;
  /** Full path to the file, e.g. "/DCIM/100__TSB/DSC_0001.JPG" */
  readonly path: string;
}

/** Thumbnail response metadata from X-exif-* headers (FW 3.00.00+). */
export interface ThumbnailMeta {
  readonly width: number | undefined;
  readonly height: number | undefined;
  readonly orientation: number | undefined;
}
