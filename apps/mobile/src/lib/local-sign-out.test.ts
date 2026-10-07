import { QueryClient } from '@tanstack/react-query';
import { sweepAccountExports } from './account-export-files';
import { tellServiceSignedOut } from './auth';
import { endLocalSession } from './local-sign-out';
import { forgetPersistedCache } from './offline';
import { unregisterFromPush } from './push';
import { endSession } from './session';
import { forgetUnsentEdits } from './unsent-edits';

/**
 * The local wipe (#161, #319): this phone first and completely, the service after and never
 * waited for.
 */

const order: string[] = [];
let mockAccessToken: string | null = 'access-1';

jest.mock('./push', () => ({
  unregisterFromPush: jest.fn((bearer: string | null) => {
    order.push(`push:${bearer}`);
    return new Promise<void>(() => undefined); // a network that never answers
  }),
}));
jest.mock('./auth', () => ({
  tellServiceSignedOut: jest.fn((token: string) => {
    order.push(`logout:${token}`);
    return new Promise<void>(() => undefined);
  }),
}));
jest.mock('./session', () => ({
  currentAccessToken: () => mockAccessToken,
  storedRefreshToken: jest.fn(async () => 'refresh-1'),
  endSession: jest.fn(async () => {
    mockAccessToken = null;
    order.push('keychain');
  }),
}));
jest.mock('./offline', () => ({ forgetPersistedCache: jest.fn(() => void order.push('persisted')) }));
jest.mock('./account-export-files', () => ({
  sweepAccountExports: jest.fn(() => void order.push('exports')),
}));
jest.mock('./unsent-edits', () => ({ forgetUnsentEdits: jest.fn(() => void order.push('edits')) }));

beforeEach(() => {
  order.length = 0;
  mockAccessToken = 'access-1';
  jest.clearAllMocks();
});

describe('endLocalSession', () => {
  it('erases the phone first, then tells the service without waiting for it', async () => {
    const client = new QueryClient();
    client.setQueryData(['saved'], ['a campaign']);
    jest.spyOn(client, 'clear').mockImplementation(() => {
      order.push('cache');
    });

    // Resolves although both network calls never do.
    await endLocalSession(client);

    expect(order).toEqual([
      'keychain',
      'cache',
      'persisted',
      'exports',
      'edits',
      // The bearer and the refresh token were read before the wipe, so the calls still carry them.
      'push:access-1',
      'logout:refresh-1',
    ]);
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(unregisterFromPush).toHaveBeenCalledTimes(1);
    expect(tellServiceSignedOut).toHaveBeenCalledWith('refresh-1');
  });

  it('clears both caches even when the keychain refuses', async () => {
    jest.mocked(endSession).mockRejectedValueOnce(new Error('keystore'));
    const client = new QueryClient();
    const clear = jest.spyOn(client, 'clear');

    await expect(endLocalSession(client)).rejects.toThrow('keystore');

    expect(clear).toHaveBeenCalledTimes(1);
    expect(forgetPersistedCache).toHaveBeenCalledTimes(1);
    expect(sweepAccountExports).toHaveBeenCalledTimes(1);
    expect(forgetUnsentEdits).toHaveBeenCalledTimes(1);
  });
});
