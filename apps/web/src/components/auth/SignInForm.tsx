'use client';

import { useState, type FormEvent } from 'react';
import { Link } from '../../i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { Field, InlineAlert, PasswordInput, Pill, TextInput } from '@ideanest/ui';
import { deviceLabelOf, signIn } from '../../lib/auth/api';
import { PASSWORD_CHANGED_NOTICE, SIGN_IN_NOTICE_PARAM } from '../../lib/auth/credentials';
import { describeAuthFailure, fieldErrorsOf, type AuthFailure } from '../../lib/auth/failures';
import type { SignInCopy } from '../../lib/i18n/auth-copy';
import { DEFAULT_SIGNED_IN_PATH, RETURN_TO_PARAM, safeReturnPath } from '../../lib/auth/redirect';
import { ProviderSignIn } from './ProviderSignIn';
import { TwoFactorChallenge } from './TwoFactorChallenge';
import { useSignInOutcome } from './useSignInOutcome';

/**
 * §4.1's A-03 — email and password sign-in. Issue #268.
 *
 * <h2>The two refusals the issue names, and why they are not one message</h2>
 *
 * **`ACCOUNT_SUSPENDED` is a 403 and must not be rendered as a failed sign-in.** The password
 * was right. `AuthExceptionHandler` says 403 rather than 401 precisely so that a client stops
 * offering to try again — a 401 would put somebody in a loop with a password that works. So
 * this form hides the submit button on that one refusal and shows what actually helps, which
 * is that support is the way through.
 *
 * **The rate limit is a 429 with a `Retry-After`,** and §17.3 sets it at five attempts per
 * fifteen minutes. Saying how long is left is the difference between waiting and pressing the
 * button until the window resets. `describeAuthFailure` owns both branches, so the register
 * page cannot come to a different conclusion about the same status.
 *
 * Everything else is the service's own sentence, verbatim (§10.4). Nothing here writes "wrong
 * email or password": the endpoint deliberately does not say which, and inventing a message
 * would be inventing a claim about which half was wrong.
 *
 * <h2>Where it goes afterwards</h2>
 *
 * `?next=` when there is one, reduced to a path on this origin by `safeReturnPath` — an open
 * redirect on a sign-in page is the classic phishing primitive, and that module lists every
 * shape it refuses. `replace`, not `push`: leaving the sign-in form in the history means Back
 * returns a signed-in reader to a form they have already completed.
 *
 * The session is re-read before navigating, so the header shows the reader's name on the page
 * they land on rather than a frame later.
 *
 * <h2>Two-factor, and the providers</h2>
 *
 * `POST /v1/auth/login` answers 200 with a challenge instead of tokens when the account has a
 * second factor confirmed, and #272 built the step that answers it. **It is a state of this
 * form rather than a route**, because the challenge is a credential for the next few minutes
 * and a URL is the one place a credential must not go — `TwoFactorChallenge` argues it at
 * length.
 *
 * `ProviderSignIn` (#273) sits below the form and shares this component's outcome handler,
 * because `TokenController` answers a provider sign-in through the same `respondTo`: an
 * account with a second factor gets a challenge whichever way the password step was passed,
 * and a provider button that skipped it would make two-factor advisory.
 *
 * <h2>What #271 and #277 added to this screen</h2>
 *
 * A link to `/reset-password`, which this form deliberately refused to carry while there was
 * no page behind it, and a notice for somebody who has just changed their password. The second
 * is here rather than on `/settings/password` because that screen cannot survive its own
 * success: `POST /v1/auth/change-password` revokes every session including the caller's, so the
 * route guard moves the reader off a private path before any confirmation could be read. The
 * confirmation travels in a fixed query value instead, never as text — see the comment beside
 * it.
 *
 * <h2>Motion</h2>
 *
 * None. docs/motion-system.md §5: authentication gets "150ms colour on controls", and an
 * error that animates in is one that arrives after it was needed.
 */

export interface SignInFormProps {
  /**
   * Every word this screen and the two components below it draw — issue #324.
   *
   * Resolved once by `app/[locale]/(auth)/sign-in/page.tsx` and handed down whole rather than
   * looked up here: this is a client component, and looking a message up in the browser means
   * the catalogue and the `use-intl` runtime in the bundle of the first page a stranger meets.
   * `lib/i18n/auth-copy.ts` carries the measurement.
   */
  readonly copy: SignInCopy;
}

export function SignInForm({ copy }: SignInFormProps) {
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

  const returnTo = safeReturnPath(searchParams.get(RETURN_TO_PARAM)) ?? DEFAULT_SIGNED_IN_PATH;
  const { challenge, settle, finish, clearChallenge } = useSignInOutcome(returnTo);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFailure(null);
    setFieldErrors({});

    try {
      await settle(
        await signIn({
          email: email.trim(),
          password,
          ...(deviceLabel() === undefined ? {} : { deviceLabel: deviceLabel() as string }),
        }),
      );
    } catch (cause) {
      setFailure(describeAuthFailure(cause, copy.failures));
      setFieldErrors(fieldErrorsOf(cause));
    } finally {
      setSubmitting(false);
    }
  }

  if (challenge !== null) {
    return (
      <TwoFactorChallenge
        challenge={challenge.value}
        expiresInSeconds={challenge.expiresInSeconds}
        copy={copy.twoFactor}
        onSignedIn={finish}
        onStartOver={() => {
          /*
           * The password is cleared with the challenge. Somebody starting over is either on
           * the wrong account or has decided to sign in as somebody else, and a form that
           * kept the previous password filled in is a form that signs them back into it.
           */
          clearChallenge();
          setPassword('');
          setFailure(null);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {/*
        `noValidate` because the browser's own bubble is not this form's error treatment:
        §9.2 requires the message to be text beside the field, wired to it, and a native
        bubble is neither — it disappears on the next keystroke and is invisible to a screen
        reader that is not focused on the control. The `type` attributes stay, because they
        still choose the right keyboard on a phone.
      */}

      {/*
        WHY THIS SCREEN EXPLAINS A SIGN-OUT IT DID NOT PERFORM. `POST /v1/auth/change-password`
        revokes every session including the caller's, so #277's panel cannot render its own
        confirmation — the route guard moves a signed-out reader off `/settings/password` a
        frame later. The confirmation travels here instead.

        A FIXED NAME MATCHED AGAINST A FIXED VALUE, never a sentence carried in the URL. Text
        printed from a query parameter is text an attacker writes, and a fabricated notice on a
        sign-in form is a phishing page hosted on our own domain. Anything but the one known
        value renders nothing.

        `success` and not lime: lime means "act now" (§2.4), and this is something that has
        already happened.
      */}
      {searchParams.get(SIGN_IN_NOTICE_PARAM) === PASSWORD_CHANGED_NOTICE && (
        <InlineAlert variant="success" title={copy.passwordChangedTitle}>
          <p>{copy.passwordChangedDetail}</p>
        </InlineAlert>
      )}

      {failure !== null && (
        <InlineAlert variant="danger" title={failure.title}>
          <p>{failure.detail}</p>
        </InlineAlert>
      )}

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

      <Field label={copy.fields.password} required error={fieldErrors['password']}>
        <PasswordInput
          name="password"
          autoComplete="current-password"
          showLabel={copy.fields.showPassword}
          hideLabel={copy.fields.hidePassword}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>

      {/*
        THE SUBMIT IS HIDDEN ON EXACTLY ONE REFUSAL — a suspension, which retrying cannot
        change. Everything else keeps it, including the rate limit: a reader who waits out
        the window needs the button to still be there.
      */}
      {(failure === null || failure.retryable) && (
        <Pill type="submit" fullWidth size="lg" disabled={submitting}>
          {submitting ? copy.submitting : copy.submit}
        </Pill>
      )}

      {/*
        THE RESET IS LINKED NOW THAT #271 EXISTS. The comment this replaced refused the link
        while `/reset-password` was a 404 and the service had no `POST /v1/auth/forgot-password`
        — "worse on this screen than anywhere else on the platform: it is offered to somebody
        who is already locked out". Both halves are built, so the refusal no longer applies.

        Below the sign-in control rather than beside the password field: the reader who can sign
        in should meet the button first, and this is the way out for the one the screen has just
        failed.
      */}
      <p className="text-center text-sm text-white/64">
        <Link
          href="/reset-password"
          className="rounded-sm text-white underline underline-offset-4 hover:text-white/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
        >
          {copy.forgot}
        </Link>
      </p>

      <p className="text-center text-sm text-white/64">
        {copy.noAccount}{' '}
        <Link
          href={registerHref(searchParams.get(RETURN_TO_PARAM))}
          className="rounded-sm text-white underline underline-offset-4 hover:text-white/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
        >
          {copy.createOne}
        </Link>
      </p>
    </form>

      {/*
        Below the form rather than above it. §4.1 A-03 is the path most accounts here take, and
        a screen that opens with two provider buttons pushes the field somebody came to type in
        below the fold on a phone. It renders nothing at all when neither provider is
        configured.
      */}
      <ProviderSignIn onOutcome={settle} copy={copy.providers} />
    </div>
  );
}

/** The register link keeps whatever return path the sign-in was given. */
function registerHref(rawReturnTo: string | null): string {
  const target = safeReturnPath(rawReturnTo);
  return target === null ? '/register' : `/register?${RETURN_TO_PARAM}=${encodeURIComponent(target)}`;
}

/** The device label, read once per submit. `undefined` on a runtime with no user agent. */
function deviceLabel(): string | undefined {
  return typeof navigator === 'undefined' ? undefined : deviceLabelOf(navigator.userAgent);
}
