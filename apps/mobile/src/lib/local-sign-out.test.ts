import { QueryClient } from '@tanstack/react-query';
import { sweepAccountExports } from './account-export-files';
import { endLocalSession } from './local-sign-out';
import { forgetPersistedCache } from './offline';
import { unregisterFromPush } from './push';
import { endSession } from './session';
import { forgetUnsentEdits } from './unsent-edits';

const order: string[] = [];

jest.mock('./push', () => ({ unregisterFromPush: jest.fn(async () => void order.push('push')) }));
jest.mock('./session', () => ({ endSession: jest.fn(async () => void order.push('keychain')) }));
jest.mock('./offline', () => ({ forgetPersistedCache: jest.fn(() => void order.push('persisted')) }));
jest.mock('./account-export-files', () => ({
  sweepAccountExports: jest.fn(() => void order.push('exports')),
}));
jest.mock('./unsent-edits', () => ({ forgetUnsentEdits: jest.fn(() => void order.push('edits')) }));

beforeEach(() => {
  order.length = 0;
  jest.clearAllMocks();
});

describe('endLocalSession', () => {
  it('drops push while the token still works, then the keychain, both caches, exports and unsent edits', async () => {
    const client = new QueryClient();
    client.setQueryData(['saved'], ['a campaign']);
    const clear = jest.spyOn(client, 'clear').mockImplementation(() => {
      order.push('cache');
    });

    await endLocalSession(client);

    expect(order).toEqual(['push', 'keychain', 'cache', 'persisted', 'exports', 'edits']);
    expect(unregisterFromPush).toHaveBeenCalledTimes(1);
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(forgetPersistedCache).toHaveBeenCalledTimes(1);
  });

  it('clears both caches even when the keychain refuses', async () => {
    jest.mocked(endSession).mockRejectedValueOnce(new Error('keystore'));
    const client = new QueryClient();
    const clear = jest.spyOn(client, 'clear');

    await expect(endLocalSession(client)).rejects.toThrow('keystore');

    expect(clear).toHaveBeenCalledTimes(1);
    expect(forgetPersistedCache).toHaveBeenCalledTimes(1);
    // An export waiting in the cache for its receiving app (Android) is this account's too.
    expect(sweepAccountExports).toHaveBeenCalledTimes(1);
    // So are the editor's unsent changes (#162) — the five-wrong-PINs wipe relies on it (#319).
    expect(forgetUnsentEdits).toHaveBeenCalledTimes(1);
  });
});
