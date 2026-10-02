import { ApiError } from '@ideanest/api-client';
import { describe, expect, it } from 'vitest';
import { attemptWithRetry } from './attempt';
import type { PledgeFailureCopy } from './failure';

const pair = { title: 't', detail: 'd' };
const COPY = {
  unreachable: pair,
  signedOut: pair,
  unknown: pair,
  codes: new Proxy({}, { get: () => pair }),
} as unknown as PledgeFailureCopy;

function inProgress(retryAfterSeconds?: number): ApiError {
  return new ApiError(409, {
    type: 'about:blank',
    title: 'busy',
    status: 409,
    code: 'IDEMPOTENT_REQUEST_IN_PROGRESS',
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  });
}

describe('attemptWithRetry', () => {
  it('waits 1 s by default, honours Retry-After, caps at 5 s, and gives up after three retries', async () => {
    const waits: number[] = [];
    const errors = [inProgress(), inProgress(2), inProgress(30), inProgress()];
    let calls = 0;
    const outcome = await attemptWithRetry(
      () => Promise.reject(errors[calls++]),
      COPY,
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(calls).toBe(4);
    expect(waits).toEqual([1000, 2000, 5000]);
    expect(outcome.ok ? null : outcome.failure.code).toBe('IDEMPOTENT_REQUEST_IN_PROGRESS');
  });

  it('returns the value once the first attempt finishes', async () => {
    let calls = 0;
    const outcome = await attemptWithRetry(
      () => (calls++ === 0 ? Promise.reject(inProgress()) : Promise.resolve('draft')),
      COPY,
      async () => undefined,
    );
    expect(outcome).toEqual({ ok: true, value: 'draft' });
  });

  it('does not retry any other refusal', async () => {
    let calls = 0;
    const outcome = await attemptWithRetry(
      () => {
        calls += 1;
        return Promise.reject(new TypeError('Network request failed'));
      },
      COPY,
      async () => undefined,
    );
    expect(calls).toBe(1);
    expect(outcome.ok ? null : outcome.failure.recovery).toBe('retry');
  });
});
