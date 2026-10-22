'use client';

import { useEffect, useRef, useState } from 'react';
import { Link } from '../../i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { CircleCheck } from 'lucide-react';
import { InlineAlert } from '@ideanest/ui';
import { confirmEmailChange, refusalDetailOf, refusalOf } from '../../lib/auth/credentials';
import { describeAuthFailure, type AuthFailure } from '../../lib/auth/failures';
import type { EmailChangeCopy } from '../../lib/i18n/auth-copy';
import { AuthPageHeader } from './AuthPageHeader';

/**
 * §4.1's A-12, second half — where the address-change confirmation lands. Issue #277.
 *
 * <h2>Why this is a public route and not a settings screen</h2>
 *
 * `POST /v1/auth/confirm-email-change` is unauthenticated, and `CredentialController` says why
 * in one sentence: "the person following it is reading the new mailbox, which is the one place
 * they are least likely to be signed in". A landing page behind the session guard would send
 * that person to a sign-in form, and the address they would sign in with is the *old* one — the
 * account has not moved yet. So the page sits in `app/(auth)` beside `/verify-email`, which
 * solved the identical problem for A-02, and it takes that route group's frame, its `noindex`,
 * and its `robots.txt` disallow.
 *
 * <h2>It runs exactly once</h2>
 *
 * The token is spent by a conditional update — `EmailChangeRequestRepository.claim` — so a
 * second request for the same token is refused with "This link has already been used." React's
 * development mode double-invokes effects on purpose, and a component without the guard below
 * would show that refusal to every developer who ever opened it. The ref is set synchronously,
 * before the await, which is what makes the guard hold across the second invocation rather than
 * racing it. `VerifyEmailView` carries the same guard for the same reason.
 *
 * <h2>The two refusals are different outcomes, not two spellings of one</h2>
 *
 * **`invalid-verification-link`** is a link that cannot work — never issued, expired after six
 * hours, or already spent — and the service writes a different sentence for each, which is the
 * sentence printed here.
 *
 * **`email-already-in-use`** is a link that could have worked and was overtaken: somebody
 * registered the address between the request and the click. `AccountCredentialsService` rolls
 * the claim back in that case, deliberately, "so a change that becomes possible again can still
 * be confirmed" — the link is **not** spent. That is a materially different thing to tell
 * somebody, and it is why this screen does not fold the two into one apology.
 *
 * <h2>It does not sign anybody in, and it does not sign anybody out</h2>
 *
 * An address change revokes no sessions: nothing about the credential changed, and the sessions
 * were issued to the same person. Somebody already signed in elsewhere stays signed in and
 * their address has moved under them, which is why the old address is written to as well.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5's authentication row. The status is announced through a live region
 * instead, because a screen whose only change is a heading swapping is a screen a screen-reader
 * user is not told about.
 */

type Status = 'idle' | 'confirming' | 'confirmed' | 'refused' | 'taken';

export interface EmailChangeConfirmViewProps {
  /** Every word this screen draws, resolved by the page — see `lib/i18n/auth-copy.ts`. */
  readonly copy: EmailChangeCopy;
}

export function EmailChangeConfirmView({ copy }: EmailChangeConfirmViewProps) {
  const searchParams = useSearchParams();
  const token = (searchParams.get('token') ?? '').trim();

  const [status, setStatus] = useState<Status>(token === '' ? 'idle' : 'confirming');
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (token === '' || attempted.current) return;
    attempted.current = true;

    void (async () => {
      try {
        await confirmEmailChange(token);
        setStatus('confirmed');
      } catch (cause) {
        const refusal = refusalOf(cause);
        setDetail(refusalDetailOf(cause));

        if (refusal === 'email-already-in-use') {
          setStatus('taken');
          return;
        }
        if (refusal === 'invalid-verification-link') {
          setStatus('refused');
          return;
        }

        // A 429, an outage, or anything else that is not about this link.
        setFailure(describeAuthFailure(cause, copy.failures));
        setStatus('refused');
      }
    })();
  }, [token, copy.failures]);

  return (
    <div>
      {/*
        `polite`, because finishing is an outcome the reader asked for rather than an
        interruption, and a permanent region whose text changes rather than one that appears —
        a live region inserted with its message already in it is read as ordinary content by
        several screen readers instead of being announced.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {status === 'confirming'
          ? copy.statusConfirming
          : status === 'confirmed'
            ? copy.statusConfirmed
            : status === 'taken'
              ? copy.statusTaken
              : status === 'refused'
                ? copy.statusRefused
                : ''}
      </p>

      {status === 'idle' && (
        <>
          <AuthPageHeader title={copy.idleTitle}>{copy.idleIntro}</AuthPageHeader>
          <FooterLinks copy={copy} />
        </>
      )}

      {status === 'confirming' && (
        <AuthPageHeader title={copy.confirmingTitle}>{copy.confirmingIntro}</AuthPageHeader>
      )}

      {status === 'confirmed' && (
        <>
          <div className="mb-8 flex items-start gap-3">
            {/*
              Colour plus an icon plus the words, never colour alone (§9.2). `--success` and
              not lime, which means "act now" and would say the opposite of "done" (§2.4).
            */}
            <CircleCheck aria-hidden="true" className="mt-1 size-6 shrink-0 text-[var(--success)]" />
            <AuthPageHeader title={copy.confirmedTitle}>{copy.confirmedIntro}</AuthPageHeader>
          </div>

          <Link
            href="/settings/email"
            className="inline-flex h-12 w-full items-center justify-center rounded-full bg-inverse px-6 text-base font-medium text-on-inverse transition-colors duration-150 ease-in-out hover:bg-inverse-muted"
          >
            {copy.goToAccount}
          </Link>
        </>
      )}

      {status === 'taken' && (
        <>
          <AuthPageHeader title={copy.takenTitle} />

          <InlineAlert variant="warning" title={copy.takenAlertTitle} className="mb-6">
            <p>{detail ?? copy.takenFallback}</p>
          </InlineAlert>

          <div className="rounded-lg border border-fg/8 bg-surface-2 p-5 text-[15px] leading-relaxed text-fg-64">
            <p>{copy.takenExplain}</p>
            <p className="mt-3">
              {/*
                THIS LINK IS NOT SPENT, which is worth saying: the service rolls the claim back
                on this refusal precisely so a change that becomes possible again can still be
                confirmed.
              */}
              {copy.takenNotSpent}
            </p>
          </div>

          <FooterLinks copy={copy} />
        </>
      )}

      {status === 'refused' && (
        <>
          <AuthPageHeader title={copy.refusedTitle} />

          <InlineAlert
            variant="danger"
            title={failure?.title ?? copy.refusedAlertTitle}
            className="mb-6"
          >
            {/* The service's own sentence: only it knows whether this link expired, was already
                used, or was never one. */}
            <p>{failure?.detail ?? detail ?? copy.refusedFallback}</p>
          </InlineAlert>

          <div className="rounded-lg border border-fg/8 bg-surface-2 p-5 text-[15px] leading-relaxed text-fg-64">
            <p>{copy.refusedExplain}</p>
          </div>

          <FooterLinks copy={copy} />
        </>
      )}
    </div>
  );
}

function FooterLinks({ copy }: { readonly copy: EmailChangeCopy }) {
  return (
    <p className="mt-8 text-center text-sm text-fg-64">
      <Link
        href="/settings/email"
        className="rounded-sm text-fg underline underline-offset-4 hover:text-fg-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        {copy.emailSettings}
      </Link>
      {' · '}
      <Link
        href="/sign-in"
        className="rounded-sm text-fg underline underline-offset-4 hover:text-fg-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        {copy.signIn}
      </Link>
    </p>
  );
}
