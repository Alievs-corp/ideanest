import * as Sharing from 'expo-sharing';
import type { BackerExport } from '@ideanest/dashboard/backers';
import { sweepAccountExports } from '../../../lib/account-export-files';
import { BackerShareError, safeFilename, shareBackerExport, sweepBackerExports } from './share-csv';

/** A cache directory in memory: directories, and files with their contents. */
const mockDirectories = new Set<string>();
const mockFiles = new Map<string, string>();
let mockWriteFails = false;

jest.mock('expo-file-system', () => {
  class Directory {
    readonly uri: string;
    constructor(parent: { uri: string }, name: string) {
      this.uri = `${parent.uri}${name}/`;
    }
    get exists(): boolean {
      return mockDirectories.has(this.uri);
    }
    create(options?: { intermediates?: boolean }): void {
      mockDirectories.add(this.uri);
      if (options?.intermediates !== true) return;
      // `intermediates` creates every directory above it, as the real file system does.
      const parts = this.uri.replace('file:///cache/', '').split('/').filter(Boolean);
      for (let depth = 1; depth < parts.length; depth += 1) {
        mockDirectories.add(`file:///cache/${parts.slice(0, depth).join('/')}/`);
      }
    }
    delete(): void {
      for (const uri of [...mockDirectories]) if (uri.startsWith(this.uri)) mockDirectories.delete(uri);
      for (const uri of [...mockFiles.keys()]) if (uri.startsWith(this.uri)) mockFiles.delete(uri);
    }
  }
  class File {
    readonly uri: string;
    constructor(directory: { uri: string }, name: string) {
      this.uri = `${directory.uri}${name}`;
    }
    create(): void {
      mockFiles.set(this.uri, '');
    }
    write(contents: string): void {
      if (mockWriteFails) throw new Error('disk full');
      mockFiles.set(this.uri, contents);
    }
  }
  return { Directory, File, Paths: { cache: { uri: 'file:///cache/' } } };
});
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

const shareAsync = jest.mocked(Sharing.shareAsync);
const isAvailableAsync = jest.mocked(Sharing.isAvailableAsync);
const URI = 'file:///cache/account-export/backers/backers-2026-10-07.csv';
const CSV = 'name,email\nAnna,anna@example.com\n';

function file(extra: Partial<BackerExport> = {}): BackerExport {
  return { filename: 'backers-2026-10-07.csv', csv: CSV, rows: 1, truncated: false, ...extra };
}

/** What the receiving app finds at the URI it was given, read when the sheet "returns". */
let readByReceiver: string | undefined;

beforeEach(() => {
  mockDirectories.clear();
  mockFiles.clear();
  mockWriteFails = false;
  readByReceiver = undefined;
  isAvailableAsync.mockReset().mockResolvedValue(true);
  shareAsync.mockReset().mockImplementation(async (uri) => {
    readByReceiver = mockFiles.get(uri);
  });
});

describe('on iOS', () => {
  it('shares the CSV as text/csv from the cache and deletes it when the sheet closes', async () => {
    await expect(shareBackerExport(file(), 'ios')).resolves.toBe('removed');

    expect(shareAsync).toHaveBeenCalledWith(
      URI,
      expect.objectContaining({ mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' }),
    );
    expect(readByReceiver).toBe(CSV);
    // It holds names and email addresses: nothing of it stays on the phone.
    expect(mockFiles.size).toBe(0);
  });
});

describe('on Android', () => {
  it('leaves the file for the receiving app, and the next sweep removes it', async () => {
    await expect(shareBackerExport(file(), 'android')).resolves.toBe('kept-until-sweep');
    expect(mockFiles.get(URI)).toBe(CSV);

    sweepBackerExports();
    expect(mockFiles.size).toBe(0);
  });

  it('is removed by the account sweeps too: a cold start and signing out', async () => {
    await shareBackerExport(file(), 'android');
    sweepAccountExports();
    expect(mockFiles.size).toBe(0);
  });

  it('sweeps an earlier copy before writing the next', async () => {
    await shareBackerExport(file({ filename: 'old.csv' }), 'android');
    await shareBackerExport(file(), 'android');
    expect([...mockFiles.keys()]).toEqual([URI]);
  });
});

it.each(['ios', 'android'] as const)('on %s, keeps nothing when the sheet will not open', async (platform) => {
  shareAsync.mockRejectedValue(new Error('activity failed'));
  await expect(shareBackerExport(file(), platform)).rejects.toBeInstanceOf(BackerShareError);
  expect(mockFiles.size).toBe(0);
});

it('opens no sheet and keeps nothing when sharing is unavailable or the write fails', async () => {
  isAvailableAsync.mockResolvedValue(false);
  await expect(shareBackerExport(file(), 'ios')).rejects.toBeInstanceOf(BackerShareError);
  isAvailableAsync.mockResolvedValue(true);
  mockWriteFails = true;
  await expect(shareBackerExport(file(), 'ios')).rejects.toBeInstanceOf(BackerShareError);
  expect(shareAsync).not.toHaveBeenCalled();
  expect(mockFiles.size).toBe(0);
});

describe('safeFilename', () => {
  it('keeps a plain name and makes a hostile one harmless', () => {
    expect(safeFilename('backers-2026-10-07.csv')).toBe('backers-2026-10-07.csv');
    expect(safeFilename('../../etc/passwd')).toBe('_.._etc_passwd.csv');
    expect(safeFilename('..')).toBe('backers.csv');
    expect(safeFilename('report')).toBe('report.csv');
  });
});
