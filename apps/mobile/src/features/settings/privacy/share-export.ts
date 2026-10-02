import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { EXPORT_FILENAME } from './api';

/** The export could not be written to the cache directory; nothing reached the share sheet. */
export class ExportWriteError extends Error {
  constructor(cause: unknown) {
    super('The account export could not be written to the cache directory.', { cause });
    this.name = 'ExportWriteError';
  }
}

export function canShareFiles(): Promise<boolean> {
  return Sharing.isAvailableAsync();
}

/**
 * Hands the export to the share sheet as `ideanest-account.json`, and deletes the file when the
 * sheet closes — whether it was shared, dismissed or failed. The cache directory is the system's
 * to clear, but the export is everything the platform holds about a person, and "eventually" is
 * not a promise this phone should make about it.
 */
export async function shareAccountExport(contents: string): Promise<void> {
  const file = new File(Paths.cache, EXPORT_FILENAME);
  try {
    try {
      if (file.exists) file.delete();
      file.create();
      file.write(contents);
    } catch (cause) {
      throw new ExportWriteError(cause);
    }
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: EXPORT_FILENAME,
    });
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      // Already gone, or the system is clearing the cache itself.
    }
  }
}
