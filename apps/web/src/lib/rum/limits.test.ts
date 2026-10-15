import { describe, expect, it } from 'vitest';
import { SlidingWindowRateLimiter, bucketKey, callerAddress, newSalt } from './limits';

function limiter(limit: number, windowMs: number, clock: { value: number }) {
  return new SlidingWindowRateLimiter({ limit, windowMs, now: () => clock.value });
}

describe('SlidingWindowRateLimiter', () => {
  it('allows up to the limit and refuses after it', () => {
    const clock = { value: 0 };
    const subject = limiter(3, 60_000, clock);

    expect(subject.record('a').allowed).toBe(true);
    expect(subject.record('a').allowed).toBe(true);
    expect(subject.record('a').allowed).toBe(true);
    expect(subject.record('a').allowed).toBe(false);
  });

  it('reports the allowance so a client can slow down before it is refused', () => {
    const clock = { value: 0 };
    const subject = limiter(3, 60_000, clock);

    expect(subject.record('a')).toMatchObject({ limit: 3, remaining: 2, resetSeconds: 60 });
    expect(subject.record('a')).toMatchObject({ remaining: 1 });
    expect(subject.record('a')).toMatchObject({ remaining: 0 });
  });

  /*
   * A sliding window rather than a fixed one, for the reason the service gives:
   * a fixed window lets twice the limit through across its boundary.
   */
  it('slides, so a boundary does not hand out a second allowance', () => {
    const clock = { value: 0 };
    const subject = limiter(2, 1_000, clock);

    clock.value = 999;
    expect(subject.record('a').allowed).toBe(true);
    expect(subject.record('a').allowed).toBe(true);

    clock.value = 1_000;
    expect(subject.record('a').allowed).toBe(false);

    // The first two leave the window at 1,999; only then does an attempt land.
    clock.value = 2_000;
    expect(subject.record('a').allowed).toBe(true);
  });

  it('counts a refused attempt, so hammering does not drain the window', () => {
    const clock = { value: 0 };
    const subject = limiter(1, 1_000, clock);

    expect(subject.record('a').allowed).toBe(true);
    clock.value = 500;
    expect(subject.record('a').allowed).toBe(false);
    clock.value = 1_100;
    // The refusal at 500 is still inside the window that started at 100.
    expect(subject.record('a').allowed).toBe(false);
  });

  it('keeps buckets apart', () => {
    const clock = { value: 0 };
    const subject = limiter(1, 60_000, clock);

    expect(subject.record('a').allowed).toBe(true);
    expect(subject.record('b').allowed).toBe(true);
    expect(subject.record('a').allowed).toBe(false);
  });

  /*
   * Without a cap, a caller varying the key turns the limiter itself into the
   * attack: one map entry per forged address, for ever.
   */
  it('bounds its own memory', () => {
    const clock = { value: 0 };
    const subject = new SlidingWindowRateLimiter({
      limit: 5,
      windowMs: 60_000,
      maxTrackedKeys: 50,
      now: () => clock.value,
    });

    for (let index = 0; index < 5_000; index += 1) subject.record(`key-${index}`);

    // Still working, and still refusing a caller that stays put.
    for (let attempt = 0; attempt < 5; attempt += 1) subject.record('steady');
    expect(subject.record('steady').allowed).toBe(false);
  });

  it('never reports a negative reset', () => {
    const clock = { value: 0 };
    const subject = limiter(2, 1_000, clock);
    subject.record('a');
    clock.value = 10_000;
    expect(subject.record('a').resetSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('bucketKey', () => {
  /*
   * §17.4 lists an IP address as personal data. The map holds hashes and
   * timestamps; the address is read from the header, hashed, and dropped.
   */
  it('is stable for one address and different for another', () => {
    const salt = newSalt();
    expect(bucketKey('203.0.113.7', salt)).toBe(bucketKey('203.0.113.7', salt));
    expect(bucketKey('203.0.113.7', salt)).not.toBe(bucketKey('203.0.113.8', salt));
  });

  it('does not contain the address it was built from', () => {
    const key = bucketKey('203.0.113.7', newSalt());
    expect(key).toMatch(/^[0-9a-f]{1,8}$/);
    expect(key).not.toContain('203.0.113.7');
  });

  it('changes with the salt, so a key does not outlive the process', () => {
    expect(bucketKey('203.0.113.7', 'a'.repeat(32))).not.toBe(bucketKey('203.0.113.7', 'b'.repeat(32)));
  });
});

describe('callerAddress', () => {
  it('takes the first forwarded hop', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 198.51.100.1' });
    expect(callerAddress(headers)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip and then to one shared bucket', () => {
    expect(callerAddress(new Headers({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(callerAddress(new Headers())).toBe('unknown');
    expect(callerAddress(new Headers({ 'x-forwarded-for': '   ' }))).toBe('unknown');
  });
});
