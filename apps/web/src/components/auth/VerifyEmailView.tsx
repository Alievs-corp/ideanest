'use client';

import { useEffect, useRef, useState } from 'react';
import { Link } from '../../i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { CircleCheck } from 'lucide-react';
import { InlineAlert } from '@ideanest/ui';
import { verifyEmail } from '../../lib/auth/api';
import { describeAuthFailure, type AuthFailure } from '../../lib/auth/failures';
import type { VerifyEmailCopy } from '../../lib/i18n/auth-copy';
import { AuthPageHeader } from './AuthPageHeader';

/**
 * §4.1's A-02 — where the verification link lands. Issue #270.
 *
 * <h2>It redeems the token, rather than the link doing it</h2>
 *
 * `POST /v1/auth/verify-email` takes the token in a **body**, and `VerifyEmailRequest`
 * explains why: a query string is written to access logs, kept in browser history, and
 * forwarded in the `Referer` header of whatever the page loads next — and this value is a
 * credential until it is spent. So the email has to point at a page, and the page has to make
 * the request. That is this component.
 *
 * The token does still arrive in this page's own URL, which is unavoidable — an email client
 * can only send somebody to a URL. What the arrangement buys is that it never leaves the
 * browser's address bar as a request the service logs.
 *
 * <h2>It runs exactly once</h2>
 *
 * The token is single use — `EmailVerificationService.claim` is a conditional update — so a
 * second request for the same token is refused. React's development mode double-invokes
 * effects on purpose, and a component without the guard below would therefore show "this link
 * has already been used" to every developer who ever opened it. The ref is set synchronously,
 * before the await, which is what makes the guard hold across the second invocation rather
 * than racing it.
 *
 * <h2>The three ways it ends</h2>
 *
 * **Verified.** The account is usable. It does not sign anybody in — verification and
 * authentication are separate, and `EmailVerificationService` is explicit that verifying an
 * address must not authorise anything else.
 *
 * **Refused.** Expired, already spent, or never issued, and the page does not guess which:
 * the service's own sentence is shown (§10.4). What it adds is what to do, and that is where
 * an honest gap has to be stated — **there is no resend endpoint.** `RegistrationService`
 * answers a second registration for an existing address by publishing
 * `RegistrationAttemptedOnExistingAccount` and returning; it does not issue a new token. So
 * this page does not offer a resend button that would do nothing. What it says instead is
 * true: signing in still works, because `SignInService` deliberately allows it before the
 * address is verified, and the header carries the unverified state from there.
 *
 * **No token at all.** Somebody reached `/verify-email` directly. That is not an error and is
 * not presented as one.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5's authentication row. The status is announced through a live
 * region instead, because a screen whose only change is a heading swapping is a screen a
 * screen-reader user is not told about.
 */

type Status = 'idle' | 'verifying' | 'verified' | 'failed';

export interface VerifyEmailViewProps {
  /** Every word this screen draws, resolved by the page — see `lib/i18n/auth-copy.ts`. */
  readonly copy: VerifyEmailCopy;
}

export function VerifyEmailView({ copy }: VerifyEmailViewProps) {
  const searchParams = useSearchParams();
  const token = (searchParams.get('token') ?? '').trim();

  const [status, setStatus] = useState<Status>(token === '' ? 'idle' : 'verifying');
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (token === '' || attempted.current) return;
    attempted.current = true;

    void (async () => {
      try {
        await verifyEmail(token);
        setStatus('verified');
      } catch (cause) {
        setFailure(describeAuthFailure(cause, copy.failures));
        setStatus('failed');
      }
    })();
  }, [token, copy.failures]);

  return (
    <div>
      {/*
        The status, announced. `polite`, because finishing is an outcome the reader asked for
        rather than an interruption, and a permanent region whose text changes rather than one
        that appears — a live region inserted with its message already in it is read as
        ordinary content by several screen readers instead of being announced.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {status === 'verifying'
          ? copy.statusVerifying
          : status === 'verified'
            ? copy.statusVerified
            : status === 'failed'
              ? copy.statusFailed
              : ''}
      </p>

      {status === 'idle' && (
        <>
          <AuthPageHeader title={copy.idleTitle}>{copy.idleIntro}</AuthPageHeader>
          <AuthFooterLinks copy={copy} />
        </>
      )}

      {status === 'verifying' && (
        <AuthPageHeader title={copy.verifyingTitle}>{copy.verifyingIntro}</AuthPageHeader>
      )}

      {status === 'verified' && (
        <>
          <div className="mb-8 flex items-start gap-3">
            {/*
              Colour plus an icon plus the words, never colour alone (§9.2). `--success`
              rather than lime: reaching a goal is what lime does not mean, and a verified
              address is an achievement rather than something urgent (§2.4).
            */}
            <CircleCheck aria-hidden="true" className="mt-1 size-6 shrink-0 text-[var(--success)]" />
            <AuthPageHeader title={copy.verifiedTitle}>{copy.verifiedIntro}</AuthPageHeader>
          </div>

          <Link
            href="/sign-in"
            className="inline-flex h-12 w-full items-center justify-center rounded-full bg-inverse px-6 text-base font-medium text-on-inverse transition-colors duration-150 ease-in-out hover:bg-inverse-muted"
          >
            {copy.signIn}
          </Link>
        </>
      )}

      {status === 'failed' && failure !== null && (
        <>
          <AuthPageHeader title={copy.failedTitle} />

          <InlineAlert variant="danger" title={failure.title} className="mb-6">
            <p>{failure.detail}</p>
          </InlineAlert>

          <div className="rounded-lg border border-fg/8 bg-surface-2 p-5 text-[15px] leading-relaxed text-fg-64">
            <p>{copy.failedExplain}</p>
          </div>

          <Link
            href="/sign-in"
            className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-full bg-inverse px-6 text-base font-medium text-on-inverse transition-colors duration-150 ease-in-out hover:bg-inverse-muted"
          >
            {copy.signIn}
          </Link>

          <AuthFooterLinks copy={copy} />
        </>
      )}
    </div>
  );
}

function AuthFooterLinks({ copy }: { readonly copy: VerifyEmailCopy }) {
  return (
    <p className="mt-8 text-center text-sm text-fg-64">
      <Link
        href="/register"
        className="rounded-sm text-fg underline underline-offset-4 hover:text-fg-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        {copy.createAccount}
      </Link>
      {' · '}
      <Link
        href="/"
        className="rounded-sm text-fg underline underline-offset-4 hover:text-fg-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        {copy.home}
      </Link>
    </p>
  );
}
