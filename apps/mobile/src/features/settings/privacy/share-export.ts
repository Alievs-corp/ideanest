import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { accountExportDirectory, sweepAccountExports } from '../../../lib/account-export-files';
import { EXPORT_FILENAME } from './api';

/** The export could not be written to the cache directory; nothing reached the share sheet. */
export class ExportWriteError extends Error {
  constructor(cause: unknown) {
    super('The account export could not be written to the cache directory.', { cause });
    this.name = 'ExportWriteError';
  }
}

/** The share sheet refused to open; the file was written and has been removed again. */
export class ShareSheetError extends Error {
  constructor(cause: unknown) {
    super('The share sheet could not be opened for the account export.', { cause });
    this.name = 'ShareSheetError';
  }
}

export function canShareFiles(): Promise<boolean> {
  return Sharing.isAvailableAsync();
}

/**
 * What became of this phone's copy once the sheet closed: removed at once, or left for the next
 * sweep because a receiving app may still be reading it (Android).
 */
export type ExportCopy = 'removed' | 'kept-until-sweep';

/**
 * Hands the export to the share sheet as `ideanest-account.json`.
 *
 * <p>iOS resolves `shareAsync` when the sheet is dismissed, after the receiving extension has
 * taken the file, so the copy is deleted then. Android resolves as soon as the reader is back in
 * the app, whatever the receiver is still doing, so the copy is left in the app-private export
 * directory for {@link sweepAccountExports}. Either way, a failure removes it at once.
 */
export async function shareAccountExport(
  contents: string,
  platform: typeof Platform.OS = Platform.OS,
): Promise<ExportCopy> {
  sweepAccountExports();
  const directory = accountExportDirectory();
  const file = new File(directory, EXPORT_FILENAME);
  try {
    directory.create({ intermediates: true, idempotent: true });
    file.create();
    file.write(contents);
  } catch (cause) {
    sweepAccountExports();
    throw new ExportWriteError(cause);
  }

  try {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: EXPORT_FILENAME,
    });
  } catch (cause) {
    sweepAccountExports();
    throw new ShareSheetError(cause);
  }

  if (platform === 'android') return 'kept-until-sweep';
  sweepAccountExports();
  return 'removed';
}
