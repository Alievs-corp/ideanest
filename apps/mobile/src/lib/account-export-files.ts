import { Directory, Paths } from 'expo-file-system';

/**
 * Where `settings/privacy` puts the account export before handing it to the share sheet (#161):
 * a directory of its own in the app's cache, which is private to the app and excluded from
 * backups on both platforms.
 *
 * <p>On Android the file cannot be deleted when the share sheet returns — `shareAsync` resolves
 * as soon as the reader is back in the app, while Bluetooth, Quick Share or a cloud upload may
 * still be reading it — so it stays until the next sweep: the next export, the privacy screen
 * opening, a cold start, or signing out.
 */
export const ACCOUNT_EXPORT_DIRECTORY = 'account-export';

export function accountExportDirectory(): Directory {
  return new Directory(Paths.cache, ACCOUNT_EXPORT_DIRECTORY);
}

/** Removes every export left on this phone. Never throws: a sweep is housekeeping. */
export function sweepAccountExports(): void {
  try {
    const directory = accountExportDirectory();
    if (directory.exists) directory.delete();
  } catch {
    // Nothing there, or the system is clearing the cache itself; the next sweep tries again.
  }
}
