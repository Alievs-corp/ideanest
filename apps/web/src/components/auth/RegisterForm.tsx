'use client';

import { useState, type FormEvent } from 'react';
import { Link } from '../../i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { MailCheck } from 'lucide-react';
import { Field, InlineAlert, PasswordInput, Pill, TextInput } from '@ideanest/ui';
import { register } from '../../lib/auth/api';
import { describeAuthFailure, fieldErrorsOf, type AuthFailure } from '../../lib/auth/failures';
import type { RegisterCopy } from '../../lib/i18n/auth-copy';
import { fillNodes } from '../../lib/i18n/placeholders';
import { DEFAULT_SIGNED_IN_PATH, RETURN_TO_PARAM, safeReturnPath } from '../../lib/auth/redirect';
import { AuthPageHeader } from './AuthPageHeader';
import { ProviderSignIn } from './ProviderSignIn';
import { TwoFactorChallenge } from './TwoFactorChallenge';
import { useSignInOutcome } from './useSignInOutcome';

/**
 * §4.1's A-01 — account creation, and the "check your email" state that follows it. Issue
 * #269.
 *
 * <h2>The success state is the interesting half</h2>
 *
 * `POST /v1/auth/register` answers **202 whether or not the address was already registered**,
 * and `AuthController` gives the reason at length: an endpoint that answered differently for a
 * known address hands anybody with a breach list the subset of it that has an account here.
 *
 * That decision only holds if the client honours it, and honouring it has a consequence worth
 * stating plainly: **this form cannot tell somebody "that address is already registered", and
 * must not try.** So the screen it shows afterwards is written to be true either way — it says
 * what was sent to the address, not what was created. Somebody who already had an account gets
 * a message telling them so, at the address, which is where it belongs.
 *
 * It also means there is nothing to sign in with yet. Registration issues no session; the
 * verification link is what makes the account usable, and the screen says so rather than
 * leaving somebody waiting on a redirect that is not coming.
 *
 * <h2>The password rule is the service's</h2>
 *
 * `RegistrationRequest` deliberately does not annotate a length — the policy decides, "so that
 * one place decides what is acceptable and the message a user sees is the same wherever a
 * password is set". A minimum typed into this form would be a second opinion that goes stale
 * the day the policy changes. What is shown before submitting is the hint the service's own
 * refusal would say, and what is shown after a refusal is that refusal.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5's authentication row. The success state replaces the form outright
 * rather than transitioning into it.
 */

export interface RegisterFormProps {
  /** Every word this screen draws, resolved by the page — see `lib/i18n/auth-copy.ts`. */
  readonly copy: RegisterCopy;
}

export function RegisterForm({ copy }: RegisterFormProps) {
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [sentTo, setSentTo] = useState<string | null>(null);

  const returnTo = searchParams.get(RETURN_TO_PARAM);

  /*
   * A PROVIDER SIGN-IN ON THIS SCREEN CREATES A SESSION, and that is not a contradiction: §17.1
   * makes `POST /v1/auth/oauth/{provider}` create the account when the provider's address is
   * verified and unknown here, and sign in when it is known. There is no "register with Google"
   * that is a different request from "sign in with Google" — the button does one thing and the
   * service decides which of the two happened.
   *
   * So this form owns the same outcome handling `SignInForm` does, including the two-factor
   * branch: somebody who already has an account with a second factor can press the button on
   * this page, and skipping the challenge because the screen is called Register would be
   * exactly the bypass `useSignInOutcome` exists to prevent.
   */
  const { challenge, settle, finish, clearChallenge } = useSignInOutcome(
    safeReturnPath(returnTo) ?? DEFAULT_SIGNED_IN_PATH,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFailure(null);
    setFieldErrors({});

    const address = email.trim();

    try {
      await register({ email: address, password, name: name.trim() });
      setSentTo(address);
    } catch (cause) {
      setFailure(describeAuthFailure(cause, copy.failures));
      setFieldErrors(fieldErrorsOf(cause));
    } finally {
      setSubmitting(false);
    }
  }

  if (challenge !== null) {
    return (
      <>
        <AuthPageHeader title={copy.twoFactorTitle}>{copy.twoFactorIntro}</AuthPageHeader>
        <TwoFactorChallenge
          challenge={challenge.value}
          expiresInSeconds={challenge.expiresInSeconds}
          copy={copy.twoFactor}
          onSignedIn={finish}
          onStartOver={clearChallenge}
        />
      </>
    );
  }

  if (sentTo !== null) {
    return (
      <div>
        <AuthPageHeader title={copy.sentTitle}>
          {/*
            THE ADDRESS IS ECHOED BECAUSE A TYPO IS THE MOST COMMON REASON NOTHING ARRIVES,
            and it is the reader's own address rather than anything the service disclosed.

            `fillNodes` rather than two half-sentences: the address is a styled node inside a
            sentence whose word order is the translation's to decide.
          */}
          {fillNodes(copy.sentIntro, {
            address: <span className="text-white">{sentTo}</span>,
          })}
        </AuthPageHeader>

        <div className="flex items-start gap-3 rounded-lg border border-white/8 bg-surface-2 p-5 text-[15px] leading-relaxed text-white/64">
          <MailCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-white/40" />
          <div>
            <p>{copy.sentLifetime}</p>
            <p className="mt-3">{copy.sentExisting}</p>
          </div>
        </div>

        <p className="mt-8 text-center text-sm text-white/64">
          {copy.verified}{' '}
          <Link
            href={signInHrefWith(returnTo)}
            className="rounded-sm text-white underline underline-offset-4 hover:text-white/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
          >
            {copy.signIn}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <>
      {/*
        THE HEADING IS HERE RATHER THAN ON THE PAGE, because which of the two is correct
        depends on a state only this component holds — see the route's comment.
      */}
      <AuthPageHeader title={copy.title}>{copy.intro}</AuthPageHeader>

      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        {failure !== null && (
          <InlineAlert variant="danger" title={failure.title}>
            <p>{failure.detail}</p>
          </InlineAlert>
        )}

        <Field label={copy.name} required hint={copy.nameHint} error={fieldErrors['name']}>
          <TextInput
            name="name"
            autoComplete="name"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

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

        <Field
          label={copy.fields.password}
          required
          hint={copy.fields.passwordHint}
          error={fieldErrors['password']}
        >
          <PasswordInput
            name="password"
            autoComplete="new-password"
            showLabel={copy.fields.showPassword}
            hideLabel={copy.fields.hidePassword}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        <Pill type="submit" fullWidth size="lg" disabled={submitting}>
          {submitting ? copy.submitting : copy.submit}
        </Pill>

        <p className="text-center text-sm text-white/64">
          {copy.haveAccount}{' '}
          <Link
            href={signInHrefWith(returnTo)}
            className="rounded-sm text-white underline underline-offset-4 hover:text-white/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
          >
            {copy.signIn}
          </Link>
        </p>

        {/*
          NO "BY REGISTERING YOU AGREE TO THE TERMS" LINE. §22 owns that copy and #293 is
          `status: needs-decision` on it, so there is no document to agree to. A consent
          sentence pointing at a page that does not exist is a worse defect than its absence:
          it is a claim that somebody accepted something nobody has written.
        */}
      </form>

      {/*
        The providers, below the form for `SignInForm`'s reason. `intent="register"` only
        changes Google's own wording on its button — the request is identical, because the
        service decides whether an account is created (§17.1's linking table).
      */}
      <div className="mt-6">
        <ProviderSignIn onOutcome={settle} intent="register" copy={copy.providers} />
      </div>
    </>
  );
}

/** The sign-in link keeps whatever return path this page was given. */
function signInHrefWith(rawReturnTo: string | null): string {
  const target = safeReturnPath(rawReturnTo);
  return target === null ? '/sign-in' : `/sign-in?${RETURN_TO_PARAM}=${encodeURIComponent(target)}`;
}
