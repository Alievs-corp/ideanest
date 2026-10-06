import { Platform } from 'react-native';
import { Directory, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { BackerExport } from '@ideanest/dashboard/backers';
import { accountExportDirectory } from '../../../lib/account-export-files';

/**
 * Hands the backer export to the share sheet (#163).
 *
 * <p>The file is a campaign's mailing list — backers' names and email addresses — so it lives
 * only as long as the sheet needs it, in a directory inside the app's private export directory
 * (`lib/account-export-files.ts`). That directory is swept on a cold start and on sign-out, so a
 * copy the app could not delete itself does not outlive the session either.
 *
 * <p>iOS resolves `shareAsync` when the sheet is dismissed, after the receiving extension has
 * taken the file, so the copy is deleted then. Android resolves as soon as the creator is back in
 * the app, while Bluetooth, Quick Share or an upload may still be reading it, so there the copy
 * stays until the next sweep: the next export, the Backers panel opening again, a cold start or
 * signing out — the arrangement the account export (#161) already makes.
 */

const DIRECTORY = 'backers';

/** The share sheet would not take the file, or it could not be written; nothing was kept. */
export class BackerShareError extends Error {
  constructor(cause: unknown) {
    super('The backer export could not be handed to the share sheet.', { cause });
    this.name = 'BackerShareError';
  }
}

/** What became of this phone's copy once the sheet closed. */
export type ExportCopy = 'removed' | 'kept-until-sweep';

function exportDirectory(): Directory {
  return new Directory(accountExportDirectory(), DIRECTORY);
}

/** Removes every backer export left on this phone. Never throws: a sweep is housekeeping. */
export function sweepBackerExports(): void {
  try {
    const directory = exportDirectory();
    if (directory.exists) directory.delete();
  } catch {
    // Nothing there, or the system is clearing the cache itself; the next sweep tries again.
  }
}

/**
 * The service's filename, made safe to create: no path separators or reserved characters, no
 * leading dots, and a `.csv` ending.
 */
export function safeFilename(name: string): string {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[.\s]+/, '').trim();
  if (base === '') return 'backers.csv';
  return /\.csv$/i.test(base) ? base : `${base}.csv`;
}

export async function shareBackerExport(
  file: BackerExport,
  platform: typeof Platform.OS = Platform.OS,
): Promise<ExportCopy> {
  sweepBackerExports();
  const name = safeFilename(file.filename);
  const directory = exportDirectory();
  const target = new File(directory, name);
  try {
    if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
    directory.create({ intermediates: true, idempotent: true });
    target.create();
    target.write(file.csv);
    await Sharing.shareAsync(target.uri, {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
      dialogTitle: name,
    });
  } catch (cause) {
    sweepBackerExports();
    throw new BackerShareError(cause);
  }

  if (platform === 'android') return 'kept-until-sweep';
  sweepBackerExports();
  return 'removed';
}
