import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publicFetch } from './api/client';
import { ALL_OFF, answersFrom, forgetFeatureFlags, readFeatureFlags } from './feature-flags';
import { reachOf, widensReach, type FlagState } from './admin/flags';

/**
 * What a client reads about the flags, and how the console decides that a change widens one.
 *
 * Held here: an unknown or failed answer is off, never on; the answer is asked for once per
 * reader per few seconds and a failure is not remembered; "widens" is true exactly when the
 * change shows the flag to somebody new.
 */

vi.mock('./api/client', () => ({ publicFetch: vi.fn() }));
vi.mock('./api/access-token', () => ({ currentAccessToken: vi.fn(() => null) }));

const fetchMock = vi.mocked(publicFetch);

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetFeatureFlags();
});

afterEach(() => forgetFeatureFlags());

describe('reading the flags', () => {
  it('answers yes only for a flag the service said yes to', async () => {
    fetchMock.mockResolvedValue(answer({ flags: { 'checkout-v2': true, 'search-v3': false } }));

    const flags = await readFeatureFlags(0);

    expect(fetchMock).toHaveBeenCalledWith('/v1/feature-flags');
    expect(flags.isOn('checkout-v2')).toBe(true);
    expect(flags.isOn('search-v3')).toBe(false);
    expect(flags.isOn('never-heard-of-it')).toBe(false);
  });

  it('is all off when the answer cannot be read, and asks again next time', async () => {
    fetchMock.mockResolvedValueOnce(answer({ status: 503 }, 503));
    expect(await readFeatureFlags(0)).toBe(ALL_OFF);

    fetchMock.mockRejectedValueOnce(new TypeError('network'));
    expect(await readFeatureFlags(1)).toBe(ALL_OFF);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('asks once for a few seconds, then again', async () => {
    fetchMock.mockResolvedValue(answer({ flags: { 'checkout-v2': true } }));

    await readFeatureFlags(0);
    await readFeatureFlags(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await readFeatureFlags(10_001);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats anything but true as off', () => {
    const flags = answersFrom({ flags: { a: 'true', b: 1, c: true } });
    expect(flags.isOn('a')).toBe(false);
    expect(flags.isOn('b')).toBe(false);
    expect(flags.isOn('c')).toBe(true);
    expect(answersFrom(null)).toBe(ALL_OFF);
  });
});

describe('who a flag reaches', () => {
  const base: FlagState = { key: 'checkout-v2', description: 'x', enabled: false, rolloutPercentage: 0, enabledAccounts: [] };

  it('names a flag that is on and reaches nobody', () => {
    expect(reachOf({ ...base, enabled: true })).toBe('nobody');
    expect(reachOf({ ...base, enabled: true, enabledAccounts: ['a'] })).toBe('named');
    expect(reachOf({ ...base, enabled: true, rolloutPercentage: 5 })).toBe('some');
    expect(reachOf({ ...base, enabled: true, rolloutPercentage: 100 })).toBe('everybody');
    expect(reachOf({ ...base, rolloutPercentage: 100 })).toBe('off');
  });

  it('widens when the change shows the flag to somebody new, and only then', () => {
    const on = { ...base, enabled: true, rolloutPercentage: 10, enabledAccounts: ['a'] };

    expect(widensReach(base, { ...base, enabled: true })).toBe(false);
    expect(widensReach({ ...base, rolloutPercentage: 10 }, { ...base, enabled: true, rolloutPercentage: 10 })).toBe(true);
    expect(widensReach(on, { ...on, rolloutPercentage: 25 })).toBe(true);
    expect(widensReach(on, { ...on, enabledAccounts: ['a', 'b'] })).toBe(true);
    expect(widensReach(on, { ...on, rolloutPercentage: 0 })).toBe(false);
    expect(widensReach(on, { ...on, enabledAccounts: [] })).toBe(false);
    expect(widensReach(on, { ...on, enabled: false })).toBe(false);
    expect(widensReach(on, { ...on, description: 'y' })).toBe(false);
    expect(widensReach(base, { ...base, enabledAccounts: ['a'] })).toBe(false);
  });
});
