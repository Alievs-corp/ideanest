'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Field, InlineAlert, Pill, TextInput } from '@ideanest/ui';
import { completeTwoFactor } from '../../lib/auth/twoFactor';
import { describeAuthFailure, type AuthFailure } from '../../lib/auth/failures';
import type { TwoFactorCopy } from '../../lib/i18n/auth-copy';

/**
 * §4.1's A-07 and A-08 — the step between a password and a session. Issue #272.
 *
 * <h2>It is a step on the sign-in screen, not a route of its own</h2>
 *
 * THE CHALLENGE IS A CREDENTIAL FOR THE NEXT FEW MINUTES, which `TokenController` says in
 * those words when it marks the response `no-store`. Putting it in a URL — `/two-factor?c=…`
 * — would write it to access logs, keep it in browser history, and forward it in the
 * `Referer` header of whatever the page loads next. `VerifyEmailRequest` makes exactly that
 * argument about the verification token, and it holds here for the same reason.
 *
 * The alternatives were a route that reads the challenge from a store this application does
 * not have, or a route that is handed it through `history.state` and breaks on a reload. A
 * step in the form it came from has neither problem: the challenge never leaves memory, and a
 * reload correctly returns somebody to the password they have to enter again anyway — the
 * challenge is single-use and short-lived, so there is nothing to resume.
 *
 * So there is **no new route** for #272, and `apps/web/README.md`'s route table says so
 * rather than leaving somebody to look for one.
 *
 * <h2>The recovery code is on the same screen, behind a disclosure</h2>
 *
 * `/2fa/verify` accepts a generated code **or** a recovery code, and the person who needs the
 * second one is the person whose phone is broken, lost, or on the other side of a room. A
 * separate screen for it is a screen they have to find while locked out. It is collapsed by
 * default because it is not the ordinary path, and it is a `details` element rather than a
 * state toggle so it works before hydration and is announced as a disclosure.
 *
 * `TwoFactorProof` is a union, so exactly one of the two is sent — the service should not be
 * asked to decide which of two credentials somebody meant to spend.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5 gives authentication a budget of "none — 150ms colour on
 * controls". This screen appears in place of the password fields with no transition, which is
 * the same decision `SignInForm` makes about its errors: an animated step change here reads
 * as hesitation on the screen where somebody is already waiting.
 */

export interface TwoFactorChallengeProps {
  /** The opaque value `POST /v1/auth/login` returned. Never rendered, never stored. */
  readonly challenge: string;
  /** How long the service said it has. Zero means it did not say. */
  readonly expiresInSeconds: number;
  /** Runs once a session exists — the caller re-reads `/v1/me` and navigates. */
  readonly onSignedIn: () => void | Promise<void>;
  /** Abandons the challenge and returns to the password form. */
  readonly onStartOver: () => void;
  /** The words, resolved by the page — see `lib/i18n/auth-copy.ts`. */
  readonly copy: TwoFactorCopy;
}

export function TwoFactorChallenge({
  challenge,
  expiresInSeconds,
  onSignedIn,
  onStartOver,
  copy,
}: TwoFactorChallengeProps) {
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [expired, setExpired] = useState(false);

  /*
   * ONE TIMER, NOT A COUNTDOWN. A ticking clock beside a code field is pressure applied to
   * somebody who is already fumbling with a phone, and docs/motion-system.md §5 is against
   * anything moving on this screen. What matters is the moment the challenge stops working,
   * because until then a refusal reads as "wrong code" and after it every code is wrong.
   *
   * An `expiresInSeconds` of zero means the service did not say, and no timer is set:
   * guessing an expiry and then telling somebody their challenge expired when it had not
   * would be inventing a failure.
   */
  useEffect(() => {
    if (expiresInSeconds <= 0) return;

    const timer = setTimeout(() => setExpired(true), expiresInSeconds * 1000);
    return () => clearTimeout(timer);
  }, [expiresInSeconds]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || expired) return;

    const typedRecovery = recoveryCode.trim();
    const typedCode = code.trim();
    if (typedCode === '' && typedRecovery === '') return;

    setSubmitting(true);
    setFailure(null);

    try {
      /*
       * The recovery code wins when both fields carry something. It is the field somebody
       * opened deliberately, and spending a recovery code that was not needed is worse than
       * ignoring six digits that were typed and then abandoned.
       */
      await completeTwoFactor(
        challenge,
        typedRecovery === ''
          ? { kind: 'code', code: typedCode }
          : { kind: 'recovery-code', recoveryCode: typedRecovery },
      );
      await onSignedIn();
    } catch (cause) {
      setFailure(describeAuthFailure(cause, copy.failures));
      setCode('');
      setRecoveryCode('');
    } finally {
      setSubmitting(false);
    }
  }

  if (expired) {
    return (
      <div className="flex flex-col gap-5">
        <InlineAlert variant="warning" title={copy.expiredTitle}>
          <p>{copy.expiredDetail}</p>
        </InlineAlert>
        <Pill type="button" fullWidth size="lg" onClick={onStartOver}>
          {copy.signInAgain}
        </Pill>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <InlineAlert variant="info" title={copy.acceptedTitle}>
        <p>{copy.acceptedDetail}</p>
      </InlineAlert>

      {failure !== null && (
        <InlineAlert variant="danger" title={failure.title}>
          <p>{failure.detail}</p>
        </InlineAlert>
      )}

      <Field label={copy.codeLabel} required>
        <TextInput
          name="code"
          /*
           * `one-time-code` is what makes a phone offer the code from the message or the
           * authenticator, and `inputMode="numeric"` is what gives it a number pad. The type
           * stays `text`, because a code is a string of digits: a number input strips a
           * leading zero and offers a spinner nobody wants on a credential.
           */
          autoComplete="one-time-code"
          inputMode="numeric"
          autoFocus
          maxLength={16}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={copy.codePlaceholder}
        />
      </Field>

      <details className="rounded-lg border border-fg/6 bg-surface-1 px-4 py-3">
        <summary className="cursor-pointer text-sm text-fg-64 marker:text-fg-40 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
          {copy.cannotReach}
        </summary>
        <div className="mt-4">
          <Field
            label={copy.recoveryLabel}
            hint={copy.recoveryHint}
          >
            <TextInput
              name="recoveryCode"
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
            />
          </Field>
        </div>
      </details>

      <Pill type="submit" fullWidth size="lg" disabled={submitting}>
        {submitting ? copy.submitting : copy.submit}
      </Pill>

      <p className="text-center text-sm text-fg-64">
        <button
          type="button"
          onClick={onStartOver}
          className="rounded-sm text-fg underline underline-offset-4 hover:text-fg-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          {copy.differentAccount}
        </button>
      </p>
    </form>
  );
}
