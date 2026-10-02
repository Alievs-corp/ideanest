import * as Sharing from 'expo-sharing';
import { ExportWriteError, shareAccountExport } from './share-export';

/** A cache directory with one file in it, enough to see what is written and what is left. */
const mockFiles = new Map<string, string>();
let mockWriteFails = false;

jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
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
  },
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

const shareAsync = jest.mocked(Sharing.shareAsync);
const URI = 'file:///cache/ideanest-account.json';

beforeEach(() => {
  mockFiles.clear();
  mockWriteFails = false;
  shareAsync.mockReset();
});

it('shares ideanest-account.json from the cache and deletes it when the sheet closes', async () => {
  let sharedContents: string | undefined;
  shareAsync.mockImplementation(async (uri) => {
    sharedContents = mockFiles.get(uri);
  });

  await shareAccountExport('{"format":"x"}');

  expect(shareAsync).toHaveBeenCalledWith(URI, expect.objectContaining({ mimeType: 'application/json' }));
  expect(sharedContents).toBe('{"format":"x"}');
  expect(mockFiles.has(URI)).toBe(false);
});

it('deletes the file when the share sheet fails too', async () => {
  shareAsync.mockRejectedValue(new Error('activity failed'));
  await expect(shareAccountExport('{}')).rejects.toThrow('activity failed');
  expect(mockFiles.has(URI)).toBe(false);
});

it('replaces a copy left behind by an earlier run rather than sharing stale bytes', async () => {
  mockFiles.set(URI, 'stale');
  let sharedContents: string | undefined;
  shareAsync.mockImplementation(async (uri) => {
    sharedContents = mockFiles.get(uri);
  });
  await shareAccountExport('fresh');
  expect(sharedContents).toBe('fresh');
});

it('reports a failed write as its own error, opens no sheet and keeps nothing', async () => {
  mockWriteFails = true;
  await expect(shareAccountExport('{}')).rejects.toBeInstanceOf(ExportWriteError);
  expect(shareAsync).not.toHaveBeenCalled();
  expect(mockFiles.has(URI)).toBe(false);
});
