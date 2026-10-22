'use client';

import { useState, type FormEvent } from 'react';
import { Link } from '../../i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { CircleCheck } from 'lucide-react';
import { Field, InlineAlert, Pill, TextInput } from '@ideanest/ui';
import { refusalDetailOf, refusalOf } from '../../lib/auth/credentials';
import { describeAuthFailure, fieldErrorsOf, type AuthFailure } from '../../lib/auth/failures';
import { RESET_TOKEN_PARAM, resetPassword } from '../../lib/auth/passwordReset';
import type { PasswordResetConfirmCopy } from '../../lib/i18n/auth-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { AuthPageHeader } from './AuthPageHeader';
import { FormErrorSummary } from './FormErrorSummary';

/**
 * §4.1's A-06, second half — where the reset link lands. Issue #271.
 *
 * <h2>The link's one hour is the thing this screen exists to say out loud</h2>
 *
 * `ideanest.auth.password-reset-token-ttl` is `PT1H`, and `PasswordResetService` explains why
 * it is deliberately not the twenty-four hours a verification link gets: that link proves an
 * address, this one replaces a credential, and a forwarded message should stop being a key to
 * the account long before it stops being a proof of the mailbox.
 *
 * **One hour is short enough to be met, so it is stated in three places rather than one.**
 * `/reset-password` says it on the confirmation, this form says it above the fields while the
 * link still works, and the refusal below says it again with the way back attached. A generic
 * "something went wrong" at the end of that path would leave somebody re-reading a dead email
 * and concluding the platform is broken, when what they need is one sentence and one button.
 *
 * <h2>Three refusals wearing one code, and the service's sentence is the only one that knows</h2>
 *
 * `invalid-verification-link` is returned for a link that was never issued, one that expired,
 * and one that has already been spent — and the service writes a **different sentence for each**:
 * "This link is not valid.", "This link has expired. Ask for a new one." and "This link has
 * already been used." A client that collapsed them would tell somebody whose link expired
 * eleven minutes ago that they had already used it, which is both wrong and alarming — it reads
 * as "somebody else opened this".
 *
 * So the service's own sentence is printed (§10.4's rule), and what this screen adds is the
 * part the service cannot know: the lifetime, and the route back to asking for another link.
 *
 * <h2>A rejected password does not spend the link, so the form stays</h2>
 *
 * `PasswordResetService.reset` checks the policy **before** it claims the token, precisely so
 * that "the person fixing their typo would find the link dead" does not happen. Honouring that
 * is what separates `weak-password` from the other refusal here: it keeps the form, keeps the
 * token, and puts the policy's own words under the field. Sending somebody back to
 * `/reset-password` for a password that was merely too short would waste the property the
 * service went out of its way to give them.
 *
 * <h2>Two password boxes, unlike the register form</h2>
 *
 * `RegisterForm` asks once, and is right to: a typo there costs one failed sign-in attempt and
 * is discovered immediately. Here it costs the link. The token is single-use and an hour old,
 * so somebody who mistypes twice identically — which is what a single box cannot detect — sets
 * a password they do not know, on an account they cannot now reset again without waiting for a
 * second email. The second box is compared in the browser and never sent.
 *
 * <h2>The token is read from the URL and posted in a body</h2>
 *
 * `VerifyEmailView`'s arrangement, and its reasoning applies with more at stake: the email can
 * only send somebody to a URL, so the token does reach this application's address bar, and
 * what the `POST` buys is that it never leaves the browser as a request the service — or
 * anything between the two — writes to a log. The route is `noindex` and disallowed in
 * `robots.txt` for the same reason.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5's authentication row.
 */

type Step = 'form' | 'done';

export interface PasswordResetConfirmFormProps {
  /** Every word this screen draws, resolved by the page — see `lib/i18n/auth-copy.ts`. */
  readonly copy: PasswordResetConfirmCopy;
}

export function PasswordResetConfirmForm({ copy }: PasswordResetConfirmFormProps) {
  const searchParams = useSearchParams();
  const token = (searchParams.get(RESET_TOKEN_PARAM) ?? '').trim();

  const [password, setPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  /** The service's sentence for a link that cannot be used — see the component comment. */
  const [deadLink, setDeadLink] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    if (password !== repeated) {
      /*
       * Checked here and never sent. The two boxes exist to catch a typo before it becomes a
       * password nobody knows on a link that cannot be spent twice; sending both to the service
       * would be asking it to hold an opinion about a comparison the browser has already made.
       */
      setFailure({
        title: copy.mismatchTitle,
        detail: copy.mismatchDetail,
        retryable: true,
      });
      setFieldErrors({ repeated: copy.mismatchField });
      return;
    }

    setSubmitting(true);
    setFailure(null);
    setFieldErrors({});

    try {
      await resetPassword(token, password);
      setPassword('');
      setRepeated('');
      setStep('done');
    } catch (cause) {
      const refusal = refusalOf(cause);

      if (refusal === 'invalid-verification-link') {
        /*
         * The link is the thing that failed, not the password, so the form goes: leaving three
         * filled boxes above a message saying the link is dead invites somebody to press the
         * button again, which cannot work however good the password is.
         */
        setDeadLink(refusalDetailOf(cause) ?? copy.deadFallback);
        return;
      }

      /*
       * `weak-password` KEEPS THE TOKEN AND THE FORM. The policy is checked before the link is
       * claimed, so the same token is still spendable — see the component comment.
       */
      setFailure(describeAuthFailure(cause, copy.failures));
      setFieldErrors(
        refusal === 'weak-password'
          ? { password: refusalDetailOf(cause) ?? copy.refusedPassword, ...fieldErrorsOf(cause) }
          : fieldErrorsOf(cause),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (token === '') {
    /*
     * Somebody reached `/reset-password/confirm` directly, with nothing to spend. That is not
     * an error and `VerifyEmailView` does not present its equivalent as one either.
     */
    return (
      <div>
        <AuthPageHeader title={copy.noTokenTitle}>{copy.noTokenIntro}</AuthPageHeader>
        <AskAgain label={copy.askForLink} signIn={copy.signIn} />
      </div>
    );
  }

  if (deadLink !== null) {
    return (
      <div>
        <AuthPageHeader title={copy.deadTitle} />

        <InlineAlert variant="danger" title={copy.deadAlertTitle} className="mb-6">
          {/* The service's own sentence. It is the only one that knows which of the three this is. */}
          <p>{deadLink}</p>
        </InlineAlert>

        <div className="rounded-lg border border-fg/8 bg-surface-2 p-5 text-[15px] leading-relaxed text-fg-64">
          <p>{fillPlaceholders(copy.deadExplain, { lifetime: copy.lifetime })}</p>
        </div>

        <AskAgain label={copy.askNewLink} signIn={copy.signIn} />
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div>
        <div className="mb-8 flex items-start gap-3">
          {/*
            Colour plus an icon plus the words, never colour alone (§9.2). `--success` rather
            than lime: lime means "act now", and a password that is set is an achievement
            rather than something urgent (§2.4).
          */}
          <CircleCheck aria-hidden="true" className="mt-1 size-6 shrink-0 text-[var(--success)]" />
          <AuthPageHeader title={copy.doneTitle}>{copy.doneIntro}</AuthPageHeader>
        </div>

        <Link
          href="/sign-in"
          className="inline-flex h-12 w-full items-center justify-center rounded-full bg-inverse px-6 text-base font-medium text-on-inverse transition-colors duration-150 ease-in-out hover:bg-inverse-muted"
        >
          {copy.signIn}
        </Link>
      </div>
    );
  }

  return (
    <>
      <AuthPageHeader title={copy.title}>
        {fillPlaceholders(copy.intro, { lifetime: copy.lifetime })}
      </AuthPageHeader>

      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <FormErrorSummary failure={failure} />

        <Field
          label={copy.newPassword}
          required
          hint={copy.passwordHint}
          error={fieldErrors['password']}
        >
          <TextInput
            type="password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        <Field
          label={copy.repeat}
          required
          hint={copy.repeatHint}
          error={fieldErrors['repeated']}
        >
          <TextInput
            type="password"
            name="repeated"
            autoComplete="new-password"
            value={repeated}
            onChange={(event) => setRepeated(event.target.value)}
          />
        </Field>

        <Pill type="submit" fullWidth size="lg" disabled={submitting}>
          {submitting ? copy.submitting : copy.submit}
        </Pill>
      </form>

      <AskAgain label={copy.askNewInstead} signIn={copy.signIn} />
    </>
  );
}

/** The one way off every state of this screen that cannot go forward. */
function AskAgain({ label, signIn }: { readonly label: string; readonly signIn: string }) {
  return (
    <p className="mt-8 text-center text-sm text-fg-64">
      <Link
        href="/reset-password"
        className="rounded-sm text-fg underline underline-offset-4 hover:text-fg-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        {label}
      </Link>
      {' · '}
      <Link
        href="/sign-in"
        className="rounded-sm text-fg underline underline-offset-4 hover:text-fg-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        {signIn}
      </Link>
    </p>
  );
}
