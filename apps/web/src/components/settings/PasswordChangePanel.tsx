'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from '../../i18n/navigation';
import { LogOut } from 'lucide-react';
import { Field, InlineAlert, Pill, TextInput } from '@ideanest/ui';
import {
  SIGN_IN_AFTER_PASSWORD_CHANGE,
  changePassword,
  refusalDetailOf,
  refusalOf,
} from '../../lib/auth/credentials';
import { describeAuthFailure, fieldErrorsOf, type AuthFailure } from '../../lib/auth/failures';
import type { PasswordChangePanelCopy } from '../../lib/i18n/settings-copy';
import { FormErrorSummary } from '../auth/FormErrorSummary';
import { useSession } from '../session/SessionProvider';

/**
 * §4.1's A-13 — changing the password with the current one. Issue #277.
 *
 * <h2>Succeeding signs this browser out, and the screen says so before it is pressed</h2>
 *
 * `POST /v1/auth/change-password` revokes **every** session for the account, the one that made
 * the request included. `AccountCredentialsService` argues the rule and rejects the friendlier
 * alternative in the same breath: "the person changing a password on a machine they suspect is
 * the one who most needs every other session to end, and 'every session except one' is a rule
 * the client would then have to be trusted to have picked correctly."
 *
 * `CredentialController` then hands the consequence to this component in as many words —
 * "saying so before the form is submitted is the client's job". That is the warning above the
 * fields, and it is not a toast afterwards. A sign-out somebody was told about is the price of
 * a security control; the same sign-out unannounced is an application that appears to have
 * crashed at the exact moment they touched their password, which is the moment they are least
 * inclined to give it the benefit of the doubt.
 *
 * <h2>Which is why there is no success state on this page</h2>
 *
 * There cannot be one that survives. The moment the session is dropped, `SessionProvider`'s
 * guard sees a signed-out reader on `/settings/password` — a path `requiresSession` matches —
 * and moves them. A confirmation panel rendered here would be destroyed by that redirect a
 * frame later, and a panel that suppressed the redirect would be a signed-out browser sitting
 * on a private route pretending otherwise.
 *
 * So the confirmation travels instead: this component navigates to the sign-in page and the
 * sign-in page says what happened, through `SIGN_IN_AFTER_PASSWORD_CHANGE`. A fixed parameter
 * name matched against a fixed value, never a sentence carried in a URL — see
 * `lib/auth/credentials.ts` for why that distinction is load-bearing.
 *
 * <h2>The wrong password is a 403, and it goes under the field it is about</h2>
 *
 * `AuthExceptionHandler` returns 403 rather than 401 precisely so a client does not react by
 * signing the reader in again "over a password typed into the wrong box" — the access token was
 * accepted and the second check is what failed. So the refusal keeps the form, keeps the
 * session, and puts the service's sentence under **Current password**, where `Field` wires it
 * to the control's `aria-describedby` and the announcement follows.
 *
 * `weak-password` is the same treatment against the other field, with the policy's own words:
 * `RegistrationRequest` deliberately annotates no length "so that one place decides what is
 * acceptable and the message a user sees is the same wherever a password is set", and a minimum
 * typed into this form would be a second opinion that goes stale the day the policy changes.
 *
 * <h2>Two boxes for the new password</h2>
 *
 * `PasswordResetConfirmForm`'s reason, weaker here and still worth the box: a typo costs the
 * account every one of its sessions and leaves somebody signing in with a password they do not
 * know. The comparison happens in this browser and the second value is never sent.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5 — "authentication, account settings: none". Nothing on this panel
 * animates, including the warning, which has to be readable the instant the page paints rather
 * than 300ms after somebody has started typing.
 */
export interface PasswordChangePanelProps {
  /** Every word this panel draws, resolved by the page — see `lib/i18n/settings-copy.ts`. */
  readonly copy: PasswordChangePanelCopy;
}

export function PasswordChangePanel({ copy }: PasswordChangePanelProps) {
  const router = useRouter();
  const { signOut } = useSession();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;

    if (newPassword !== repeated) {
      setFailure({
        title: copy.mismatchTitle,
        detail: copy.mismatchDetail,
        retryable: true,
      });
      setFieldErrors({ repeated: copy.mismatchField });
      return;
    }

    setBusy(true);
    setFailure(null);
    setFieldErrors({});

    try {
      await changePassword({ currentPassword, newPassword });

      /*
       * The order is deliberate. `changePassword` has already dropped the access token, which
       * is dead server-side either way; `signOut` clears the session this application is
       * holding, so the header stops naming somebody who is no longer signed in. Navigating
       * before that would leave a signed-in-looking shell on a sign-in page.
       *
       * `replace`, not `push`: `/settings/password` is a private route this reader can no
       * longer reach, and leaving it in the history means Back walks them into the guard.
       */
      await signOut();
      router.replace(SIGN_IN_AFTER_PASSWORD_CHANGE);
    } catch (cause) {
      const refusal = refusalOf(cause);
      const detail = refusalDetailOf(cause);

      setFailure(describeAuthFailure(cause, copy.failures));
      setFieldErrors({
        ...(refusal === 'incorrect-password' && detail !== null
          ? { currentPassword: detail }
          : {}),
        ...(refusal === 'weak-password' && detail !== null ? { newPassword: detail } : {}),
        ...fieldErrorsOf(cause),
      });
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-fg/8 bg-surface-2 p-6 sm:p-8">
      <h2 className="text-lg font-medium tracking-[-0.02em] text-fg">{copy.heading}</h2>

      <form onSubmit={submit} noValidate className="mt-4 flex max-w-[30rem] flex-col gap-5">
        <FormErrorSummary failure={failure} />

        {/*
          THE WARNING IS ABOVE THE FIELDS AND NOT BESIDE THE BUTTON. It is a fact about what
          pressing the button does, and somebody who reads it after filling three password boxes
          has already decided. `warning` rather than `danger`: nothing here goes wrong, and an
          alert that shouts about an ordinary consequence is one people learn to skip. Icon plus
          words plus colour, never colour alone (§9.2).
        */}
        <InlineAlert variant="warning" title={copy.alertTitle}>
          <p>{copy.alertBody}</p>
        </InlineAlert>

        <Field
          label={copy.currentPassword}
          required
          hint={copy.currentPasswordHint}
          error={fieldErrors['currentPassword']}
        >
          <TextInput
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>

        <Field
          label={copy.newPassword}
          required
          hint={copy.newPasswordHint}
          error={fieldErrors['newPassword']}
        >
          <TextInput
            type="password"
            name="newPassword"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
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

        <div>
          <Pill type="submit" disabled={busy} iconLeft={<LogOut aria-hidden="true" className="size-4" />}>
            {busy ? copy.submitting : copy.submit}
          </Pill>
        </div>
      </form>
    </section>
  );
}
