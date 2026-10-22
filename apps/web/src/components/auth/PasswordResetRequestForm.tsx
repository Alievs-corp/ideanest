'use client';

import { useState, type FormEvent } from 'react';
import { Link } from '../../i18n/navigation';
import { MailQuestion } from 'lucide-react';
import { Field, Pill, TextInput } from '@ideanest/ui';
import { describeAuthFailure, fieldErrorsOf, type AuthFailure } from '../../lib/auth/failures';
import { requestPasswordReset } from '../../lib/auth/passwordReset';
import type { PasswordResetCopy } from '../../lib/i18n/auth-copy';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';
import { AuthPageHeader } from './AuthPageHeader';
import { FormErrorSummary } from './FormErrorSummary';

/**
 * §4.1's A-06, first half — asking for a reset link. Issue #271.
 *
 * <h2>The screen after submitting is the whole design, and it is written to be true</h2>
 *
 * `POST /v1/auth/forgot-password` answers **202 whether or not the address has an account**,
 * and `PasswordResetService` gives the reason: an endpoint that answered "no such account" is
 * an enumeration oracle producing exactly the list somebody wants before writing a phishing
 * email — which people on a breach list have accounts here.
 *
 * **A client can give that away without the endpoint saying a word.** "Check your inbox — we
 * have sent you a link" is a claim about an account, and it is a claim this application was
 * deliberately not told enough to make. So the state below says *if*: the request was accepted,
 * and a link is on its way if the address has an account. That sentence is exactly as true for
 * an address with no account as for one with, which is the property the 202 was chosen for.
 *
 * The consequence to accept honestly is that somebody who mistyped their address gets a
 * reassuring screen and no email. That is why the address is echoed back — a typo is the most
 * common reason nothing arrives, and it is the reader's own address rather than anything the
 * service disclosed — and why the way back to this form stays on the screen.
 *
 * <h2>The lifetime is said here, before anybody is waiting on it</h2>
 *
 * The link works for one hour and once. Saying so on the confirmation, rather than only in the
 * refusal an hour later, is the difference between a constraint and a surprise: somebody who
 * reads "one hour" goes and looks now, and somebody who does not comes back tomorrow to a page
 * that tells them off. `auth.reset.lifetime` is the single source of the phrase — both this
 * screen's copy and `/reset-password/confirm`'s read that one key — so the two cannot disagree
 * about it.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5's authentication row. The confirmation replaces the form outright.
 */
export interface PasswordResetRequestFormProps {
  /** Every word this screen draws, resolved by the page — see `lib/i18n/auth-copy.ts`. */
  readonly copy: PasswordResetCopy;
}

export function PasswordResetRequestForm({ copy }: PasswordResetRequestFormProps) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [askedFor, setAskedFor] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFailure(null);
    setFieldErrors({});

    const address = email.trim();

    try {
      await requestPasswordReset(address);
      setAskedFor(address);
    } catch (cause) {
      setFailure(describeAuthFailure(cause, copy.failures));
      setFieldErrors(fieldErrorsOf(cause));
    } finally {
      setSubmitting(false);
    }
  }

  if (askedFor !== null) {
    return (
      <div>
        <AuthPageHeader title={copy.sentTitle}>
          {/*
            "IF THAT ADDRESS HAS AN ACCOUNT" IS NOT HEDGING — it is the only sentence this
            screen is entitled to write. See the component comment.
          */}
          {fillNodes(copy.sentIntro, {
            address: <span className="text-fg">{askedFor}</span>,
          })}
        </AuthPageHeader>

        <div className="flex items-start gap-3 rounded-lg border border-fg/8 bg-surface-2 p-5 text-[15px] leading-relaxed text-fg-64">
          <MailQuestion aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-fg-40" />
          <div>
            <p>{fillPlaceholders(copy.sentLifetime, { lifetime: copy.lifetime })}</p>
            <p className="mt-3">
              {fillNodes(copy.sentRetry, {
                retry: (
                  <button
                    type="button"
                    onClick={() => setAskedFor(null)}
                    className="rounded-sm text-fg underline underline-offset-4 hover:text-fg-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                  >
                    {copy.tryAnother}
                  </button>
                ),
              })}
            </p>
          </div>
        </div>

        <p className="mt-8 text-center text-sm text-fg-64">
          <Link
            href="/sign-in"
            className="rounded-sm text-fg underline underline-offset-4 hover:text-fg-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            {copy.backToSignIn}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <>
      <AuthPageHeader title={copy.title}>{copy.intro}</AuthPageHeader>

      {/*
        `noValidate` for `SignInForm`'s reason: §9.2 requires the message to be text beside the
        field and wired to it, and the browser's own bubble is neither — it disappears on the
        next keystroke and is invisible to a screen reader that is not focused on the control.
        `type="email"` stays, because it still chooses the right keyboard on a phone.
      */}
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <FormErrorSummary failure={failure} />

        <Field label={copy.fields.email} required error={fieldErrors['email']}>
          <TextInput
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={copy.fields.emailPlaceholder}
          />
        </Field>

        {/*
          THE CONTROL STAYS ON EVERY REFUSAL HERE, including the rate limit, and there is no
          `retryable` branch to write: none of this endpoint's refusals is a suspension. A 429
          says how long is left in `detail` and the same request works after it.
        */}
        <Pill type="submit" fullWidth size="lg" disabled={submitting}>
          {submitting ? copy.submitting : copy.submit}
        </Pill>

        <p className="text-center text-sm text-fg-64">
          {copy.remembered}{' '}
          <Link
            href="/sign-in"
            className="rounded-sm text-fg underline underline-offset-4 hover:text-fg-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            {copy.signIn}
          </Link>
        </p>
      </form>
    </>
  );
}
