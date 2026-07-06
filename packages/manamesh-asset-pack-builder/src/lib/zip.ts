/**
 * Zip utilities powered by fflate.
 * Used for creating downloadable asset packs and as fallback when direct FS write is unavailable.
 */

import { zip as fflateZip } from 'fflate';

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

export async function createZip(entries: ZipEntry[]): Promise<Blob> {
  const input: Record<string, Uint8Array> = {};
  for (const e of entries) {
    input[e.path] = e.data;
  }

  return new Promise((resolve, reject) => {
    fflateZip(input, { level: 1 }, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(new Blob([data], { type: 'application/zip' }));
    });
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Convert a list of (relativePath, File) into zip-ready entries.
 * Used when user selects a directory via legacy input.
 */
export async function filesToZipEntries(files: Map<string, File>): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];
  for (const [path, file] of files.entries()) {
    const buf = new Uint8Array(await file.arrayBuffer());
    entries.push({ path, data: buf });
  }
  return entries;
}
