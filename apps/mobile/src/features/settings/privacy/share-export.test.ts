import * as Sharing from 'expo-sharing';
import { sweepAccountExports } from '../../../lib/account-export-files';
import { ExportWriteError, ShareSheetError, shareAccountExport } from './share-export';

/** A cache directory in memory: directories, and files with their contents. */
const mockDirectories = new Set<string>();
const mockFiles = new Map<string, string>();
let mockWriteFails = false;
let mockDeleteFails = false;

jest.mock('expo-file-system', () => {
  class Directory {
    readonly uri: string;
    constructor(parent: { uri: string }, name: string) {
      this.uri = `${parent.uri}${name}/`;
    }
    get exists(): boolean {
      return mockDirectories.has(this.uri);
    }
    create(): void {
      mockDirectories.add(this.uri);
    }
    delete(): void {
      if (mockDeleteFails) throw new Error('busy');
      mockDirectories.delete(this.uri);
      for (const uri of [...mockFiles.keys()]) if (uri.startsWith(this.uri)) mockFiles.delete(uri);
    }
  }
  class File {
    readonly uri: string;
    constructor(directory: { uri: string }, name: string) {
      this.uri = `${directory.uri}${name}`;
    }
    get exists(): boolean {
      return mockFiles.has(this.uri);
    }
    create(): void {
      mockFiles.set(this.uri, '');
    }
    write(contents: string): void {
      if (mockWriteFails) throw new Error('disk full');
      mockFiles.set(this.uri, contents);
    }
    delete(): void {
      mockFiles.delete(this.uri);
    }
  }
  return { Directory, File, Paths: { cache: { uri: 'file:///cache/' } } };
});
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

const shareAsync = jest.mocked(Sharing.shareAsync);
const URI = 'file:///cache/account-export/ideanest-account.json';

/** What the receiving app finds at the URI it was given, read when the sheet "returns". */
let readByReceiver: string | undefined;

beforeEach(() => {
  mockDirectories.clear();
  mockFiles.clear();
  mockWriteFails = false;
  mockDeleteFails = false;
  readByReceiver = undefined;
  shareAsync.mockReset();
  shareAsync.mockImplementation(async (uri) => {
    readByReceiver = mockFiles.get(uri);
  });
});

describe('on iOS', () => {
  it('shares ideanest-account.json from its own cache directory and deletes it when the sheet closes', async () => {
    await expect(shareAccountExport('{"format":"x"}', 'ios')).resolves.toBe('removed');

    expect(shareAsync).toHaveBeenCalledWith(URI, expect.objectContaining({ mimeType: 'application/json' }));
    expect(readByReceiver).toBe('{"format":"x"}');
    expect(mockFiles.has(URI)).toBe(false);
  });
});

describe('on Android', () => {
  it('leaves the file for the receiving app when the sheet returns, and the sweep removes it', async () => {
    await expect(shareAccountExport('{"format":"x"}', 'android')).resolves.toBe('kept-until-sweep');

    // Bluetooth, Quick Share or a cloud upload may still be reading it after the reader is back.
    expect(mockFiles.get(URI)).toBe('{"format":"x"}');

    sweepAccountExports();
    expect(mockFiles.has(URI)).toBe(false);
  });

  it('sweeps a copy an earlier export left behind before writing the new one', async () => {
    await shareAccountExport('old', 'android');
    await shareAccountExport('fresh', 'android');
    expect(readByReceiver).toBe('fresh');
    expect(mockFiles.get(URI)).toBe('fresh');
  });
});

it.each(['ios', 'android'] as const)(
  'on %s, reports a share sheet that would not open as its own error and keeps nothing',
  async (platform) => {
    shareAsync.mockRejectedValue(new Error('activity failed'));

    const failure = shareAccountExport('{}', platform);
    await expect(failure).rejects.toBeInstanceOf(ShareSheetError);
    expect(mockFiles.has(URI)).toBe(false);
  },
);

it('reports a failed write as its own error, opens no sheet and keeps nothing', async () => {
  mockWriteFails = true;
  await expect(shareAccountExport('{}', 'android')).rejects.toBeInstanceOf(ExportWriteError);
  expect(shareAsync).not.toHaveBeenCalled();
  expect(mockFiles.has(URI)).toBe(false);
});

it('never throws from a sweep, even when the directory will not go', () => {
  mockDirectories.add('file:///cache/account-export/');
  mockDeleteFails = true;
  expect(() => sweepAccountExports()).not.toThrow();
});
