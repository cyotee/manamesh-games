/**
 * File System Access helpers (Chromium + progressive fallback).
 * Allows the app to write real folder structures when the user grants permission.
 */

export interface WriteTarget {
  kind: 'fs-access' | 'zip-only';
  directoryHandle?: FileSystemDirectoryHandle;
  name: string;
}

export async function requestOutputDirectory(defaultName = 'manamesh-pack'): Promise<WriteTarget | null> {
  // Modern File System Access API
  if ('showDirectoryPicker' in window) {
    try {
      const dirHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
        suggestedName: defaultName,
      });
      // Verify we can write
      const testFile = await dirHandle.getFileHandle('__write_test.tmp', { create: true });
      const writable = await testFile.createWritable();
      await writable.write('ok');
      await writable.close();
      await dirHandle.removeEntry('__write_test.tmp').catch(() => {});

      return { kind: 'fs-access', directoryHandle: dirHandle, name: dirHandle.name };
    } catch (err) {
      console.warn('File System Access request denied or failed, falling back to zip.', err);
    }
  }
  // Fallback: user will get a single zip download
  return { kind: 'zip-only', name: defaultName };
}

export async function ensureDir(handle: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
  const parts = path.split('/').filter(Boolean);
  let current = handle;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}

export async function writeFileInDir(
  dirHandle: FileSystemDirectoryHandle,
  relativePath: string,
  data: Uint8Array | Blob | string
): Promise<void> {
  const pathParts = relativePath.split('/');
  const fileName = pathParts.pop()!;
  const parent = pathParts.length > 0 ? await ensureDir(dirHandle, pathParts.join('/')) : dirHandle;

  const fileHandle = await parent.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  // Cast to satisfy TS for different environments
  await writable.write(data as any);
  await writable.close();
}

/**
 * Simple read of a directory (for Build flow) using legacy webkitdirectory or FSA read.
 * Returns a flat map of relativePath -> File for processing.
 */
export async function readDirectoryContents(
  input: FileList | FileSystemDirectoryHandle
): Promise<Map<string, File>> {
  const files = new Map<string, File>();

  if (input instanceof FileList) {
    // Legacy <input webkitdirectory>
    for (let i = 0; i < input.length; i++) {
      const f = input[i];
      // Use webkitRelativePath when available
      const rel = (f as any).webkitRelativePath || f.name;
      files.set(rel, f);
    }
    return files;
  }

  // Full FSA directory read (recursive)
  const stack: Array<{ handle: FileSystemDirectoryHandle; prefix: string }> = [
    { handle: input, prefix: '' },
  ];

  while (stack.length) {
    const { handle, prefix } = stack.pop()!;
    // @ts-expect-error - entries() is available in supported browsers
    for await (const [name, child] of handle.entries()) {
      if (child.kind === 'file') {
        const file = await (child as any).getFile();
        const rel = prefix ? `${prefix}/${name}` : name;
        files.set(rel, file);
      } else if (child.kind === 'directory') {
        stack.push({ handle: child as FileSystemDirectoryHandle, prefix: prefix ? `${prefix}/${name}` : name });
      }
    }
  }
  return files;
}
