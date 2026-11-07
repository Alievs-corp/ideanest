import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SAMPLE_RATE,
  SESSION_SLOT,
  type SessionHolder,
  hashToUnitInterval,
  isSampled,
  parseSampleRate,
  resolveSession,
} from './sampling';
import { isSessionId, isTraceId } from './correlation';

/** A v4-shaped identifier that is predictable, so a test can compare two. */
let counter = 0;
const uuid = (): string =>
  `${(counter += 1).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;

describe('parseSampleRate', () => {
  it('defaults when unset or unreadable, rather than throwing', () => {
    expect(parseSampleRate(undefined)).toBe(DEFAULT_SAMPLE_RATE);
    expect(parseSampleRate('')).toBe(DEFAULT_SAMPLE_RATE);
    expect(parseSampleRate('   ')).toBe(DEFAULT_SAMPLE_RATE);
    expect(parseSampleRate('half')).toBe(DEFAULT_SAMPLE_RATE);
    expect(parseSampleRate('NaN')).toBe(DEFAULT_SAMPLE_RATE);
  });

  it('clamps to [0, 1]', () => {
    expect(parseSampleRate('-1')).toBe(0);
    expect(parseSampleRate('0')).toBe(0);
    expect(parseSampleRate('0.05')).toBe(0.05);
    expect(parseSampleRate('1')).toBe(1);
    expect(parseSampleRate('7')).toBe(1);
  });

  it('defaults to measuring every session', () => {
    // See the module comment: below a few hundred samples a p75 moves by more
    // between two ordinary days than a regression would move it, and this
    // platform has no production traffic to sample down from.
    expect(DEFAULT_SAMPLE_RATE).toBe(1);
  });
});

describe('isSampled', () => {
  /*
   * The property the whole percentile rests on. A coin flip per metric would
   * rank metrics rather than sessions, and the slow visits — which emit more
   * samples because they are slow — would be over-represented in exactly the
   * metric they are worst at.
   */
  it('gives the same answer for the same session, every time', () => {
    const id = '0f4b7a2c-1d3e-4f5a-8b9c-0d1e2f3a4b5c';
    const first = isSampled(id, 0.5);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect(isSampled(id, 0.5)).toBe(first);
    }
  });

  it('is a pure function of the identifier and the rate', () => {
    expect(hashToUnitInterval('a')).toBe(hashToUnitInterval('a'));
    expect(hashToUnitInterval('a')).not.toBe(hashToUnitInterval('b'));
  });

  it('spreads identifiers roughly evenly across the interval', () => {
    const ids = Array.from({ length: 20_000 }, (_, index) => `session-${index}`);
    const sampled = ids.filter((id) => isSampled(id, 0.25)).length / ids.length;
    // Not an assertion about randomness — an assertion that the hash does not
    // collapse, which is what a 32-bit multiply done with `*` would do.
    expect(sampled).toBeGreaterThan(0.22);
    expect(sampled).toBeLessThan(0.28);
  });

  it('produces a value in [0, 1) for anything', () => {
    for (const seed of ['', 'a', 'ə', '🙂', 'x'.repeat(1000)]) {
      const value = hashToUnitInterval(seed);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('short-circuits the extremes without hashing', () => {
    expect(isSampled('anything', 0)).toBe(false);
    expect(isSampled('anything', -1)).toBe(false);
    expect(isSampled('anything', 1)).toBe(true);
    expect(isSampled('anything', 2)).toBe(true);
  });
});

describe('resolveSession', () => {
  it('mints a session and reuses it for the rest of the page', () => {
    const page: SessionHolder = {};

    const first = resolveSession(page, 1, uuid);
    expect(isSessionId(first.id)).toBe(true);
    expect(isTraceId(first.traceId)).toBe(true);
    expect(first.sampled).toBe(true);

    const second = resolveSession(page, 1, uuid);
    expect(second).toBe(first);
    expect(page[SESSION_SLOT]).toBe(first);
  });

  /*
   * Every metric of the page obeys one decision. Re-deciding per call would be the
   * per-metric coin flip in slower motion.
   */
  it('keeps the decision even when asked again at another rate', () => {
    const page: SessionHolder = {};
    const original = resolveSession(page, 1, uuid);

    const afterRateChange = resolveSession(page, 0.0001, uuid);

    expect(afterRateChange).toBe(original);
    expect(afterRateChange.sampled).toBe(true);
  });

  /*
   * #641. A reload is a new page and a new session: nothing is kept on the device
   * for the next one to find.
   */
  it('starts a new session on a new page', () => {
    const first = resolveSession({}, 1, uuid);
    const second = resolveSession({}, 1, uuid);

    expect(second.id).not.toBe(first.id);
    expect(second.traceId).not.toBe(first.traceId);
  });

  /*
   * #641. The session used to be kept in `sessionStorage`; a reader's device now
   * holds nothing for it, in any store, and a key left there by an older build is
   * not read.
   */
  it('writes nothing to the browser’s storage and reads nothing from it', () => {
    sessionStorage.setItem(
      'ideanest.rum.session',
      JSON.stringify({ id: '0f4b7a2c-1d3e-4f5a-8b9c-0d1e2f3a4b5c', sampled: false, traceId: 'a'.repeat(32) }),
    );
    const page: SessionHolder = {};

    const session = resolveSession(page, 1, uuid);

    expect(session.sampled).toBe(true);
    expect(session.id).not.toBe('0f4b7a2c-1d3e-4f5a-8b9c-0d1e2f3a4b5c');
    sessionStorage.removeItem('ideanest.rum.session');
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  });
});
