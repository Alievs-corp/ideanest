import { ApiError } from '@ideanest/api-client';
import en from '@ideanest/messages/en.json';
import { createTranslator } from 'use-intl';
import { describeAuthFailure, fieldErrorsOf, refusalDetailOf, refusalOf } from './auth-failures';
import type { Translate } from './i18n';

/**
 * The web's `failures.test.ts` and `credentials.test.ts` tables, on a phone (issue #152).
 */

const t = createTranslator({ locale: 'en', messages: en }) as unknown as Translate;
const failures = en.auth.failures;

describe('describeAuthFailure', () => {
  it('names a bug in this application as unexpected, never as the reader’s fault', () => {
    expect(describeAuthFailure(new Error('boom'), t)).toEqual({
      title: failures.unexpectedTitle,
      detail: failures.unexpectedDetail,
      retryable: true,
    });
  });

  it('names a fetch that never left the phone as unreachable', () => {
    expect(describeAuthFailure(new TypeError('Network request failed'), t)).toEqual({
      title: failures.unreachableTitle,
      detail: failures.unreachableDetail,
      retryable: true,
    });
  });

  it('names a refusal with no problem body as unreachable', () => {
    expect(describeAuthFailure(new ApiError(502, null), t)).toEqual({
      title: failures.unreachableTitle,
      detail: failures.unreachableDetail,
      retryable: true,
    });
  });

  it('withdraws the retry for a suspension, and only for a suspension', () => {
    const suspended = describeAuthFailure(
      new ApiError(403, { code: 'ACCOUNT_SUSPENDED', status: 403 }),
      t,
    );
    expect(suspended).toEqual({
      title: failures.suspendedTitle,
      detail: failures.suspendedDetail,
      retryable: false,
    });
  });

  it.each([
    [30, 'in under a minute'],
    [60, 'in under a minute'],
    [61, 'in about 2 minutes'],
    [300, 'in about 5 minutes'],
  ])('says the wait for a 429 with Retry-After %i', (seconds, wait) => {
    const failure = describeAuthFailure(
      new ApiError(429, { status: 429, retryAfterSeconds: seconds }),
      t,
    );
    expect(failure.title).toBe(failures.rateLimitedTitle);
    expect(failure.detail).toBe(`${failures.rateLimitedShort} You can try again ${wait}.`);
    // The window expires, so the control stays.
    expect(failure.retryable).toBe(true);
  });

  it('keeps the service’s own sentence inside the wait', () => {
    const failure = describeAuthFailure(
      new ApiError(429, { status: 429, detail: 'Slow down.', retryAfterSeconds: 120 }),
      t,
    );
    expect(failure.detail).toBe('Slow down. You can try again in about 2 minutes.');
  });

  it('says the rate limit without a wait when none was given', () => {
    expect(describeAuthFailure(new ApiError(429, { status: 429 }), t).detail).toBe(
      failures.rateLimitedDetail,
    );
  });

  it('passes the service’s title and detail through', () => {
    expect(
      describeAuthFailure(
        new ApiError(401, { title: 'Sign-in failed', detail: 'Those details do not match.' }),
        t,
      ),
    ).toEqual({
      title: 'Sign-in failed',
      detail: 'Those details do not match.',
      retryable: true,
    });
  });

  it('falls back to the catalogue when the service said nothing', () => {
    expect(describeAuthFailure(new ApiError(401, { status: 401 }), t)).toEqual({
      title: failures.refusedTitle,
      detail: failures.refusedDetail,
      retryable: true,
    });
  });
});

describe('fieldErrorsOf', () => {
  it('reads §10.4’s errors map', () => {
    expect(
      fieldErrorsOf(new ApiError(400, { errors: { email: 'Enter an email address.' } })),
    ).toEqual({ email: 'Enter an email address.' });
  });

  it('is empty for anything else', () => {
    expect(fieldErrorsOf(new Error('x'))).toEqual({});
    expect(fieldErrorsOf(new ApiError(500, null))).toEqual({});
  });
});

describe('refusalOf', () => {
  it.each([
    [{ code: 'WEAK_PASSWORD' }, 'weak-password'],
    [{ code: 'INVALID_VERIFICATION_LINK' }, 'invalid-verification-link'],
    [{ code: 'EMAIL_ALREADY_IN_USE' }, 'email-already-in-use'],
    [{ type: 'https://ideanest.az/problems/incorrect-password' }, 'incorrect-password'],
    [{ code: 'SOMETHING_ELSE' }, 'other'],
    [{}, 'other'],
  ] as const)('reads %j as %s', (problem, refusal) => {
    expect(refusalOf(new ApiError(400, problem))).toBe(refusal);
  });

  it('is other for a network failure', () => {
    expect(refusalOf(new TypeError('Network request failed'))).toBe('other');
  });

  it('gives the service’s sentence when there is one', () => {
    expect(refusalDetailOf(new ApiError(400, { detail: 'Link expired.' }))).toBe('Link expired.');
    expect(refusalDetailOf(new ApiError(400, {}))).toBeNull();
  });
});
