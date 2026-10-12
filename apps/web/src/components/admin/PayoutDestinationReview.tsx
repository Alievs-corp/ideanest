'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Field, InlineAlert, Pill, Select } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import type { AdminPayoutDestination, DestinationRejectionReason } from '../../lib/admin/api';
import {
  DESTINATION_REJECTION_REASONS,
  rejectPayoutDestination,
  revealPayoutBankAccount,
  verifyPayoutDestination,
  type RevealedBankAccount,
} from '../../lib/admin/payout-destinations';
import { consoleMessageFor, statusFor, wasAborted } from '../../lib/admin/refusals';
import type { ConsoleRefusalsCopy } from '../../lib/i18n/admin/common-copy';
import type { PayoutDestinationCopy } from '../../lib/i18n/admin/money-copy';

/**
 * Deciding one creator's payout destination — issue #396, part of epic #392.
 *
 * <h2>One component, drawn on two screens</h2>
 *
 * The queue at `/admin/payout-destinations` and the account screen both draw it, and that is
 * not a second path into the same write so much as the only one COMPLIANCE has: the account
 * screen reads the person with `ADMINISTER_ACCOUNTS`, which V66 deliberately did not give the
 * compliance role, so a reviewer who could decide only there could not decide at all. Both
 * screens therefore render this, with the same confirmation and the same refusals.
 *
 * <h2>The IBAN is fetched on a press, held while it is on screen, and nowhere else</h2>
 *
 * `GET …/payout-destination/account` is audited on every call, so nothing asks for it until
 * somebody does: not on load, not on hover, and a second press while the first is in flight
 * does nothing. The number lives in this component's state and nowhere else — no cache, no
 * store, no storage — so hiding it, leaving the page, or moving to another row drops it, and
 * seeing it again is another audited read. The sentence saying so sits beside the control,
 * before anybody presses it, because a warning shown after the disclosure warns nobody.
 *
 * <p>Offered only for a bank account and only to a reader holding `READ_BANK_DETAILS`. A card's
 * number is the provider's and was never here; asking would write an audit row and answer 404.
 *
 * <h2>Verifying asks first; rejecting asks why</h2>
 *
 * Verifying releases payouts to the account, under the reviewer's name, so the first press
 * asks and the second decides. Rejecting moves no money, but the creator is told the reason
 * in their own language, so it takes one of V58's five and refuses to send without one.
 *
 * <p>A destination whose holder is not the creator's legal name cannot be verified — the
 * service refuses it with `DESTINATION_NAME_MISMATCH` — so that control is not offered and the
 * reason is said instead. The refusal is still handled, for the row that changed underneath.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5 gives an administrative surface 150ms of colour on a control, and
 * this is the step before money moves.
 */
/** A standing as a tone that agrees with its word. Never the only signal — the word is beside it. */
export const DESTINATION_STANDING_TONE: Readonly<Record<string, 'success' | 'warning' | 'danger' | 'default'>> = {
  VERIFIED: 'success',
  WAIVED: 'success',
  AWAITING_VERIFICATION: 'warning',
  NAME_MISMATCH: 'danger',
  REJECTED: 'danger',
};

export interface PayoutDestinationReviewProps {
  /** A recorded destination. The caller draws nothing when there is none. */
  readonly destination: AdminPayoutDestination;
  readonly copy: PayoutDestinationCopy;
  /** The screen's own subject, for a refusal worded by the shared table. */
  readonly subject: string;
  readonly refusals: ConsoleRefusalsCopy;
  /** Whether the reader holds `READ_BANK_DETAILS`. What is offered, never what is allowed. */
  readonly canReveal: boolean;
  /** The service's answer to a decision, so the screen redraws from it rather than guessing. */
  readonly onDecided: (next: AdminPayoutDestination) => void;
}

export function PayoutDestinationReview({
  destination,
  copy,
  subject,
  refusals,
  canReveal,
  onDecided,
}: PayoutDestinationReviewProps) {
  return (
    <div className="flex flex-col gap-4">
      {canReveal && destination.kind === 'BANK_TRANSFER' && (
        <BankAccountReveal
          key={destination.creatorId}
          creatorId={destination.creatorId}
          copy={copy.reveal}
        />
      )}
      <DestinationDecision
        key={`decision-${destination.creatorId}`}
        destination={destination}
        copy={copy}
        subject={subject}
        refusals={refusals}
        onDecided={onDecided}
      />
    </div>
  );
}

type Reveal =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'opening' }
  | { readonly kind: 'shown'; readonly account: RevealedBankAccount }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'failed' };

/** In fours, the way it is printed on a statement and read aloud to a bank. */
function grouped(iban: string): string {
  return iban.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}

function BankAccountReveal({
  creatorId,
  copy,
}: {
  readonly creatorId: string;
  readonly copy: PayoutDestinationCopy['reveal'];
}) {
  const [reveal, setReveal] = useState<Reveal>({ kind: 'hidden' });
  const inFlight = useRef<AbortController | null>(null);
  const auditedId = useId();

  // A request still running when the row goes away must not land in a component nobody sees.
  useEffect(() => () => inFlight.current?.abort(), []);

  async function open(): Promise<void> {
    if (inFlight.current !== null) return;

    const controller = new AbortController();
    inFlight.current = controller;
    setReveal({ kind: 'opening' });
    try {
      const account = await revealPayoutBankAccount(creatorId, controller.signal);
      if (controller.signal.aborted) return;
      setReveal({ kind: 'shown', account });
    } catch (cause) {
      if (controller.signal.aborted || wasAborted(cause)) return;
      if (cause instanceof ApiError && cause.problem?.code === 'PAYOUT_BANK_ACCOUNT_NOT_FOUND') {
        setReveal({ kind: 'not-found' });
      } else {
        setReveal({ kind: statusFor(cause) === 'forbidden' ? 'forbidden' : 'failed' });
      }
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }

  const opening = reveal.kind === 'opening';

  return (
    <div className="flex flex-col gap-2">
      <p id={auditedId} className="max-w-[62ch] text-xs text-white/48">
        {copy.audited}
      </p>

      <div aria-live="polite">
        {reveal.kind === 'shown' && (
          <dl className="flex flex-col gap-1 rounded-lg border border-white/8 bg-surface-2 p-3 text-sm">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <dt className="text-white/40">{copy.ibanLabel}</dt>
              <dd className="select-all break-all font-mono text-white">{grouped(reveal.account.iban)}</dd>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <dt className="text-white/40">{copy.holderLabel}</dt>
              <dd className="text-white">{reveal.account.holderName}</dd>
            </div>
          </dl>
        )}
        {reveal.kind === 'not-found' && <p className="text-sm text-white/64">{copy.notFound}</p>}
        {reveal.kind === 'forbidden' && <p className="text-sm text-white/64">{copy.forbidden}</p>}
        {reveal.kind === 'failed' && (
          <InlineAlert variant="danger" className="mt-1">
            {copy.failed}
          </InlineAlert>
        )}
      </div>

      <div>
        {reveal.kind === 'shown' ? (
          <Pill variant="ghost" size="sm" onClick={() => setReveal({ kind: 'hidden' })}>
            {copy.hide}
          </Pill>
        ) : (
          <Pill
            variant="outline"
            size="sm"
            aria-describedby={auditedId}
            aria-disabled={opening}
            onClick={() => void open()}
          >
            {opening ? copy.revealing : copy.action}
          </Pill>
        )}
      </div>
    </div>
  );
}

type Mode = 'idle' | 'confirm-verify' | 'reject';

function DestinationDecision({
  destination,
  copy,
  subject,
  refusals,
  onDecided,
}: {
  readonly destination: AdminPayoutDestination;
  readonly copy: PayoutDestinationCopy;
  readonly subject: string;
  readonly refusals: ConsoleRefusalsCopy;
  readonly onDecided: (next: AdminPayoutDestination) => void;
}) {
  const [mode, setMode] = useState<Mode>('idle');
  const [reason, setReason] = useState<DestinationRejectionReason | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const words = copy.decision;
  const nameMismatch = destination.standing === 'NAME_MISMATCH';
  // A waiver is not a verification, so verifying under one is still offered.
  const mayVerify = destination.standing !== 'VERIFIED' && !nameMismatch;
  const mayReject = destination.standing !== 'REJECTED';

  function refusalOf(cause: unknown): string {
    const code = cause instanceof ApiError ? cause.problem?.code : undefined;
    if (code === 'DESTINATION_NAME_MISMATCH') return words.nameMismatch;
    if (code === 'SELF_VERIFIED_DESTINATION') return words.self;
    if (code === 'PAYOUT_DESTINATION_NOT_FOUND') return words.gone;
    return consoleMessageFor(cause, subject, refusals);
  }

  async function decide(send: () => Promise<AdminPayoutDestination>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await send();
      setMode('idle');
      setReason('');
      onDecided(next);
    } catch (cause) {
      setError(refusalOf(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!mayVerify && !mayReject && !nameMismatch) return null;

  return (
    <div className="flex flex-col gap-3">
      {nameMismatch && <p className="max-w-[62ch] text-sm text-white/64">{words.nameMismatch}</p>}

      {error !== null && (
        <InlineAlert variant="danger" title={words.failedTitle}>
          {error}
        </InlineAlert>
      )}

      {mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
          {mayVerify && (
            <Pill variant="outline" size="sm" onClick={() => setMode('confirm-verify')}>
              {words.verify}
            </Pill>
          )}
          {mayReject && (
            <Pill variant="ghost" size="sm" onClick={() => setMode('reject')}>
              {words.reject}
            </Pill>
          )}
        </div>
      )}

      {mode === 'confirm-verify' && (
        <div role="group" aria-label={words.verify} className="flex flex-col gap-2">
          <p className="max-w-[62ch] text-sm text-white">{words.confirmVerify}</p>
          <div className="flex flex-wrap gap-2">
            <Pill
              size="sm"
              autoFocus
              aria-disabled={busy}
              onClick={() => void decide(() => verifyPayoutDestination(destination.creatorId))}
            >
              {busy ? words.verifying : words.confirmVerifyAction}
            </Pill>
            <Pill variant="ghost" size="sm" aria-disabled={busy} onClick={() => setMode('idle')}>
              {words.cancel}
            </Pill>
          </div>
        </div>
      )}

      {mode === 'reject' && (
        <form
          aria-label={words.reject}
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason === '') return;
            const chosen = reason;
            void decide(() => rejectPayoutDestination(destination.creatorId, chosen));
          }}
        >
          <Field label={words.reasonLabel} required className="min-w-[240px]">
            <Select
              value={reason}
              placeholder={words.reasonPlaceholder}
              onChange={(event) => setReason(event.currentTarget.value as DestinationRejectionReason)}
            >
              {DESTINATION_REJECTION_REASONS.map((option) => (
                <option key={option} value={option}>
                  {copy.rejectionReason[option]}
                </option>
              ))}
            </Select>
          </Field>
          <Pill type="submit" variant="danger" size="sm" disabled={reason === ''} aria-disabled={busy}>
            {busy ? words.rejecting : words.confirmReject}
          </Pill>
          <Pill type="button" variant="ghost" size="sm" aria-disabled={busy} onClick={() => setMode('idle')}>
            {words.cancel}
          </Pill>
        </form>
      )}
    </div>
  );
}
