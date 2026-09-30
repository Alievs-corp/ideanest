import { describe, expect, it, vi } from 'vitest';
import { maintenanceHeaders, maintenancePageFor, statusSnapshot } from './gate';
import type { PlatformStatus } from './status';

const OPERATIONAL: PlatformStatus = { state: 'operational', maintenance: null, upcoming: null };
const MAINTENANCE: PlatformStatus = {
  state: 'maintenance',
  maintenance: { startsAt: '2026-10-04T22:00:00Z', endsAt: null, source: 'api', retryAfterSeconds: 300 },
  upcoming: null,
};

describe('which pages a window closes', () => {
  it('closes every page in every language, the maintenance page included', () => {
    for (const path of ['/az', '/en/discover', '/ru/settings/security', '/tr/projects/1/kilims', '/az/maintenance']) {
      expect(maintenancePageFor(path)).toBe(`/${path.split('/')[1]}/maintenance`);
    }
  });

  it('leaves the console and sign-in open, so staff can work through a window', () => {
    for (const path of ['/az/admin', '/en/admin/maintenance', '/ru/sign-in']) {
      expect(maintenancePageFor(path)).toBeNull();
    }
  });

  it('does not close a path with no language, which the proxy redirects first', () => {
    expect(maintenancePageFor('/discover')).toBeNull();
    expect(maintenancePageFor('/')).toBeNull();
  });

  it('answers with the contract’s headers', () => {
    expect(maintenanceHeaders(MAINTENANCE.maintenance!)).toEqual({
      'retry-after': '300',
      'cache-control': 'no-store',
    });
  });
});

describe('the status snapshot', () => {
  it('waits for the first answer, then answers from memory for ten seconds', async () => {
    let now = 0;
    const read = vi.fn().mockResolvedValue(MAINTENANCE);
    const snapshot = statusSnapshot(read, () => now);

    expect(await snapshot.current()).toBe(MAINTENANCE);
    now = 9_999;
    expect(await snapshot.current()).toBe(MAINTENANCE);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('answers from the old snapshot while one refresh runs behind it', async () => {
    let now = 0;
    let finish: (value: PlatformStatus) => void = () => {};
    const read = vi
      .fn<() => Promise<PlatformStatus | null>>()
      .mockResolvedValueOnce(OPERATIONAL)
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const snapshot = statusSnapshot(read, () => now);

    await snapshot.current();
    now = 10_000;

    // Stale: the page is not held up, and two pages do not start two refreshes.
    expect(await snapshot.current()).toBe(OPERATIONAL);
    expect(await snapshot.current()).toBe(OPERATIONAL);
    expect(read).toHaveBeenCalledTimes(2);

    finish(MAINTENANCE);
    await Promise.resolve();
    await Promise.resolve();
    expect(await snapshot.current()).toBe(MAINTENANCE);
  });

  it('shares one request between the pages that arrive before the first answer', async () => {
    const read = vi.fn().mockResolvedValue(OPERATIONAL);
    const snapshot = statusSnapshot(read, () => 0);

    await Promise.all([snapshot.current(), snapshot.current(), snapshot.current()]);

    expect(read).toHaveBeenCalledTimes(1);
  });

  it('holds "not known" for ten seconds too, so a service that is down is not asked on every page', async () => {
    let now = 0;
    const read = vi.fn().mockRejectedValue(new Error('down'));
    const snapshot = statusSnapshot(read, () => now);

    expect(await snapshot.current()).toBeNull();
    now = 5_000;
    expect(await snapshot.current()).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });
});
