import { describe, expect, it } from 'vitest';
import { ApiError, type Problem } from '../api/problem';
import { describeFailure, PLEDGE_FAILURE_CODES } from './failure';
import { checkoutCopyFrom } from '../i18n/checkout-copy';
import { translatorFor } from '../../test-copy';

/**
 * The four refusals #52 answered and the contract did not name (#204).
 *
 * `CheckoutView.test.tsx` covers what the screen does with them; this covers
 * what they ARE, which is the part a second surface — #56's edit and cancel,
 * epic #59's charges — reads before it renders anything of its own. The
 * distinction that matters is between a refusal a backer can act on, one the
 * client should act on by itself, and one that is a bug report.
 *
 * <p>The sentences are built from `messages/en.json` with the builder the checkout calls —
 * #91 moved them out of this module, and retyping them here would give a test that passed
 * whatever the catalogue said. `src/test-copy.ts` carries that argument at length.
 */
const COPY = checkoutCopyFrom(translatorFor('checkout')).failures;

function refusal(code: string, status: number, extra: Partial<Problem> = {}): ApiError {
  return new ApiError(status, { code, status, title: 'Refused', ...extra });
}

describe('IDEMPOTENT_REQUEST_IN_PROGRESS', () => {
  it('is a wait rather than a failure, and carries how long to wait for', () => {
    const failure = describeFailure(
      refusal('IDEMPOTENT_REQUEST_IN_PROGRESS', 409, { retryAfterSeconds: 2 }),
      COPY,
    );

    expect(failure.recovery).toBe('wait-and-retry');
    expect(failure.retryAfterMs).toBe(2000);
    // The key must be sent again unchanged: the request being waited on is the
    // one holding it, and a fresh key would be a second pledge.
    expect(failure.retireKey).toBe(false);
    expect(failure.clientBug).toBe(false);
  });

  it('reports no wait at all when the service asked for none', () => {
    // Null rather than a number invented here. How long to wait when nothing was
    // said is the caller's policy, not a fact about the response.
    expect(
      describeFailure(refusal('IDEMPOTENT_REQUEST_IN_PROGRESS', 409), COPY).retryAfterMs,
    ).toBeNull();
  });

  it.each([["a string, '1'", '1'], ['a NaN', Number.NaN], ['a negative', -5]])(
    'ignores %s where the seconds should be, rather than computing a wait from it',
    (_name, seconds) => {
      /*
       * The problem body is JSON that has been CAST, not parsed, so a field
       * outside the contract is exactly as possible as any other. A NaN wait
       * reaches `setTimeout`, which reads it as zero — and a considered pause
       * becomes a hot loop against an endpoint that is already busy.
       */
      const problem = {
        code: 'IDEMPOTENT_REQUEST_IN_PROGRESS',
        status: 409,
        retryAfterSeconds: seconds,
      } as unknown as Problem;

      expect(describeFailure(new ApiError(409, problem), COPY).retryAfterMs).toBeNull();
    },
  );
});

describe('the idempotency header refusals', () => {
  it.each([['IDEMPOTENCY_KEY_REQUIRED'], ['IDEMPOTENCY_KEY_INVALID']] as const)(
    'reports %s as a defect in this client',
    (code) => {
      const failure = describeFailure(refusal(code, 400), COPY);

      expect(failure.clientBug).toBe(true);
      // Nothing on the screen will help: the next request would carry the same
      // missing or malformed header, because the client is what is wrong.
      expect(failure.recovery).toBe('none');
      /* Ours rather than the service's "Refused", and drawn from the catalogue since #91. */
      expect(failure.title).toBe(COPY.codes[code].title);
      expect(failure.detail).toBe(COPY.codes[code].detail);
      expect(failure.detail).toMatch(/fault in this site/);
    },
  );
});

describe('PLEDGE_MODIFIED', () => {
  it('is a reservation to make again, and does not claim to know what changed', () => {
    const failure = describeFailure(refusal('PLEDGE_MODIFIED', 409), COPY);

    expect(failure.recovery).toBe('redraft');
    expect(failure.clientBug).toBe(false);
    /*
     * The usual cause is §8.4's sweep expiring the draft as it was confirmed,
     * and the service deliberately will not say so: the exception it catches is
     * a broad type, and a cause it had inferred rather than observed would be a
     * lie the first time something else writes to a pledge. This wording keeps
     * that honesty instead of restating it as an expiry.
     */
    expect(failure.detail).toMatch(/most often the five-minute hold running out/);
    expect(failure.detail).toMatch(/no card was involved/);
  });
});

describe('the catalogue behind the table', () => {
  it('has a title and a detail for every code this module answers for', () => {
    /*
     * The record is typed over `PLEDGE_FAILURE_CODES`, so a code added without a sentence is
     * a compile error rather than an empty alert. This is the other half: a sentence that
     * exists as a key and is empty would compile and say nothing on the screen where the
     * money is.
     */
    for (const code of PLEDGE_FAILURE_CODES) {
      expect(COPY.codes[code].title.trim(), code).not.toBe('');
      expect(COPY.codes[code].detail.trim(), code).not.toBe('');
    }
  });

  it('draws the refusal from the catalogue rather than from this module', () => {
    const failure = describeFailure(refusal('REWARD_SOLD_OUT', 409), COPY);

    expect(failure.title).toBe(COPY.codes.REWARD_SOLD_OUT.title);
    expect(failure.detail).toBe(COPY.codes.REWARD_SOLD_OUT.detail);
    /* The recovery is still this module's: it is a decision, not a sentence. */
    expect(failure.recovery).toBe('change-selection');
  });

  it('says the service was not reached when nothing was thrown by it', () => {
    /*
     * A thrown value that is not an `ApiError` never reached the service, and the two call
     * for opposite next moves — this is the one refusal that promises trying again cannot
     * pledge twice.
     */
    const failure = describeFailure(new TypeError('Failed to fetch'), COPY);

    expect(failure.title).toBe(COPY.unreachable.title);
    expect(failure.code).toBeNull();
    expect(failure.recovery).toBe('retry');
  });

  it('answers a 401 with the sign-in wording rather than the generic refusal', () => {
    const failure = describeFailure(new ApiError(401, null), COPY);

    expect(failure.title).toBe(COPY.signedOut.title);
    expect(failure.recovery).toBe('none');
  });
});

describe('a code this build has never heard of', () => {
  it("still falls through to the service's own prose", () => {
    const failure = describeFailure(
      new ApiError(409, {
        code: 'SOMETHING_NEW',
        status: 409,
        title: 'A newer refusal',
        detail: 'What it says.',
      }),
      COPY,
    );

    // The honest answer for a refusal nobody here has wording for: the service
    // knows which of its rules refused the request and this module does not.
    expect(failure.title).toBe('A newer refusal');
    expect(failure.detail).toBe('What it says.');
    expect(failure.clientBug).toBe(false);
  });

  it('falls back to the catalogue only when the service wrote no prose at all', () => {
    const failure = describeFailure(new ApiError(409, { code: 'SOMETHING_NEW', status: 409 }), COPY);

    expect(failure.title).toBe(COPY.unknown.title);
    expect(failure.detail).toBe(COPY.unknown.detail);
  });
});
