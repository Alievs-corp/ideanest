'use client';

import { useState, type FormEvent } from 'react';
import { Field, InlineAlert, Pill, Textarea } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import type { CheckoutCopy } from '../../lib/i18n/checkout-copy';
import { openBackerDispute } from '../../lib/pledges/disputes';

/**
 * A backer disputing their payment — IDN-EXT-01 §6.3 (#43, #44).
 *
 * Offered on a paid pledge, behind one press, because most paid pledges are never disputed and a
 * form open on every one of them would read as an invitation. The window is the service's to judge —
 * open while the creator's payout is held, closed before withdrawal and after payout — so the form
 * does not guess at it; a refusal is worded. Nothing is refunded here: an administrator decides.
 */
export interface BackerDisputeFormProps {
  readonly pledgeId: string;
  readonly copy: CheckoutCopy['dispute'];
}

export function BackerDisputeForm({ pledgeId, copy }: BackerDisputeFormProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || reason.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await openBackerDispute(pledgeId, reason.trim());
      setOpened(true);
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.problem?.code : undefined;
      setError(
        code === 'DISPUTE_WINDOW_CLOSED' ? copy.windowClosed : code === 'NOTHING_TO_DISPUTE' ? copy.nothing : copy.failed,
      );
    } finally {
      setBusy(false);
    }
  }

  if (opened) {
    return (
      <InlineAlert variant="info" title={copy.heading}>
        <p>{copy.opened}</p>
      </InlineAlert>
    );
  }

  if (!open) {
    return (
      <div>
        <Pill type="button" variant="ghost" onClick={() => setOpen(true)}>
          {copy.heading}
        </Pill>
      </div>
    );
  }

  return (
    <section aria-labelledby="backer-dispute-heading" className="rounded-2xl border border-white/8 bg-surface-2 p-6 sm:p-8">
      <h2 id="backer-dispute-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
        {copy.heading}
      </h2>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.intro}</p>

      <form onSubmit={submit} noValidate className="mt-5 flex max-w-[36rem] flex-col gap-4">
        <Field label={copy.reasonLabel} hint={copy.reasonHint} required>
          <Textarea value={reason} rows={4} maxLength={2000} onChange={(event) => setReason(event.currentTarget.value)} />
        </Field>

        {error !== null && <InlineAlert variant="danger">{error}</InlineAlert>}

        <div className="flex flex-wrap gap-2">
          <Pill type="submit" variant="outline" aria-disabled={busy} disabled={reason.trim() === ''}>
            {busy ? copy.sending : copy.submit}
          </Pill>
          <Pill type="button" variant="ghost" onClick={() => setOpen(false)}>
            {copy.cancel}
          </Pill>
        </div>
      </form>
    </section>
  );
}
