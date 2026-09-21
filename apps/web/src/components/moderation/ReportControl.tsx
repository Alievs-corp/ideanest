'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Flag } from 'lucide-react';
import {
  Field,
  InlineAlert,
  Pill,
  Radio,
  RadioGroup,
  Textarea,
  cn,
  useDismiss,
  useFocusTrap,
  useScrollLock,
} from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import type { ReportReason } from '../../lib/moderation/api';
import {
  DETAIL_MAX_LENGTH,
  REPORT_REASONS,
  requiresDetail,
  submitReport,
  type ReportTarget,
} from '../../lib/moderation/report';
import type { ReportControlCopy } from '../../lib/i18n/report-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { signInHref } from '../../lib/auth/redirect';
import { useSession } from '../session/SessionProvider';
import { localeHref, useLocale } from '../../i18n/navigation';

/**
 * §4.9's C-06 and C-07 — telling the platform that something is wrong. Issue #286.
 *
 * <h2>One control for three kinds of target</h2>
 *
 * `ContentReportController` publishes three endpoints on one controller sharing one rate-limit
 * budget, and gives the reason: separate counters would let somebody who had spent their
 * allowance on campaigns spend a second one on people. This is the same argument on this side
 * — one component over a target type, so the fourth surface to grow a Report control cannot
 * arrive with its own copy of the reasons, its own error handling, or its own idea of when a
 * detail is required.
 *
 * Today it is mounted on the campaign page. The comment tab (#285) and the public profile
 * (#274) mount it as they land, and neither will need to write anything but a `target`.
 *
 * <h2>Signed out is a link, not a form</h2>
 *
 * All three endpoints require a bearer token. The controller is explicit that this is the
 * mechanism rather than friction: the duplicate suppression the feature is built on "is
 * unstateable without an identity to compare". So a visitor who is not signed in is offered a
 * sign-in that returns them here, and never a form that collects a complaint and then loses
 * it at the last step.
 *
 * <h2>The animation is written here, not imported</h2>
 *
 * §4.11 specifies 200ms, a fading backdrop and a panel that fades and rises 24px — `opacity`
 * and `transform` only. The kit's `Modal` implements it through `motion`, which is 116 kB, and
 * the campaign page ships **no** animation runtime at all: every component beneath it renders
 * on the server. `MobileNavDrawer` faced the same choice for the same reason and resolved it
 * the same way; the keyframes are in `app/globals.css` beside that one.
 *
 * <h2>A second report on one thing is not refused, and is not celebrated either</h2>
 *
 * V23's partial unique index means reporting the same target twice returns the report already
 * on file, as a 202. There is no way to tell the two apart from here and no reason to: the
 * acknowledgement says the platform has the complaint, which is true either way.
 *
 * <h2>Every word is a prop, and the three targets are three sentences</h2>
 *
 * This is a client component and cannot read the catalogue — issue #85, and
 * `lib/i18n/report-copy.ts` carries the rest. What is worth knowing here is that nothing is
 * assembled from a noun: "Report this campaign" and "Nothing about the comment changes" are
 * whole phrases keyed by target kind, because a template with a noun dropped into it is an
 * English sentence the other three languages cannot decline.
 */

export interface ReportControlProps {
  readonly target: ReportTarget;
  /** What is being reported, for the dialog's heading. A campaign title, a person's name. */
  readonly name: string;
  /** The path to return to after signing in. */
  readonly returnTo: string;
  /** `link` on a campaign page's meta row, `button` where the control stands alone. */
  readonly appearance?: 'link' | 'button';
  /** The words this dialog draws, resolved on the server. See `lib/i18n/report-copy.ts`. */
  readonly copy: ReportControlCopy;
}

export function ReportControl({
  target,
  name,
  returnTo,
  appearance = 'link',
  copy,
}: ReportControlProps) {
  const { status } = useSession();
  /*
   * The sign-in below is a full-document anchor rather than a `Link`, deliberately — signing
   * in is a boundary the client cache should not carry state across — and the language still
   * has to survive it. Without this a reader signing in from a Russian page lands wherever
   * their cookie last pointed. `i18n/navigation.tsx` carries the argument.
   */
  const locale = useLocale();
  const panel = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState(false);

  function close(): void {
    setOpen(false);
    setError(null);
  }

  useDismiss({ open, onDismiss: close });
  useScrollLock(open);
  useFocusTrap(open, panel);

  const about = copy.triggerOn[target.kind];

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || reason === '') return;

    if (requiresDetail(reason) && detail.trim() === '') {
      setError(copy.detailRequired);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await submitReport(target, reason, detail);
      setFiled(true);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? (cause.problem?.detail ?? cause.problem?.title ?? copy.refused)
          : copy.unreachable,
      );
    } finally {
      setBusy(false);
    }
  }

  /*
   * `unknown` renders the control. The session takes a round trip after hydration
   * (`SessionProvider`), and hiding a Report control for that moment would make it appear
   * under the reader's cursor a beat later. Pressing it before the answer lands opens the
   * dialog, which then shows whichever of the two states is correct.
   */
  const trigger =
    appearance === 'button' ? (
      <Pill
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        iconLeft={<Flag aria-hidden="true" className="size-4" />}
      >
        {copy.trigger}
      </Pill>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-sm text-sm text-white/40 transition-colors duration-150 ease-in-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
      >
        <Flag aria-hidden="true" className="size-4" />
        {about}
      </button>
    );

  return (
    <>
      {trigger}

      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4">
          <div
            aria-hidden="true"
            onClick={close}
            className="absolute inset-0 bg-black/60 motion-safe:animate-[dialog-backdrop_200ms_ease-out]"
          />

          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={fillPlaceholders(copy.dialogLabel, { name })}
            tabIndex={-1}
            className={cn(
              'relative flex w-full max-w-[32rem] flex-col gap-5',
              'max-h-[85vh] overflow-y-auto rounded-2xl border border-white/8 bg-surface-2 p-6 sm:p-8',
              'motion-safe:animate-[dialog-panel_200ms_ease-out]',
            )}
          >
            <h2 className="text-lg font-medium tracking-[-0.02em] text-white">{about}</h2>

            {status === 'signed-out' ? (
              <>
                <p className="text-[15px] leading-relaxed text-white/64">{copy.signedOutBody}</p>
                <div className="flex flex-wrap gap-3">
                  <a href={localeHref(signInHref(returnTo), locale)}>
                    <Pill type="button">{copy.signIn}</Pill>
                  </a>
                  <Pill type="button" variant="ghost" onClick={close}>
                    {copy.cancel}
                  </Pill>
                </div>
              </>
            ) : filed ? (
              <>
                <InlineAlert variant="success" title={copy.filedTitle}>
                  <p>{copy.filedBody[target.kind]}</p>
                </InlineAlert>
                <div>
                  <Pill type="button" onClick={close}>
                    {copy.close}
                  </Pill>
                </div>
              </>
            ) : (
              <form onSubmit={submit} noValidate className="flex flex-col gap-5">
                {error !== null && (
                  <InlineAlert variant="danger" title={copy.errorTitle}>
                    <p>{error}</p>
                  </InlineAlert>
                )}

                <Field label={copy.reasonLabel} required grouped>
                  <RadioGroup
                    value={reason}
                    onValueChange={(next) => {
                      setReason(next as ReportReason);
                      setError(null);
                    }}
                    className="flex flex-col gap-2"
                  >
                    {REPORT_REASONS.map((option) => (
                      <Radio
                        key={option}
                        value={option}
                        label={copy.reasons[option]}
                        description={copy.descriptions[option]}
                      />
                    ))}
                  </RadioGroup>
                </Field>

                <Field
                  label={copy.detailLabel}
                  required={reason !== '' && requiresDetail(reason)}
                  hint={copy.detailHint}
                >
                  <Textarea
                    rows={4}
                    maxLength={DETAIL_MAX_LENGTH}
                    value={detail}
                    onChange={(event) => setDetail(event.target.value)}
                  />
                </Field>

                <div className="flex flex-wrap gap-3">
                  <Pill type="submit" disabled={busy || reason === ''}>
                    {busy ? copy.sending : copy.submit}
                  </Pill>
                  <Pill type="button" variant="ghost" onClick={close}>
                    {copy.cancel}
                  </Pill>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
