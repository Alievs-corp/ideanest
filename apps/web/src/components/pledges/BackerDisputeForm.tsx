'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Field, InlineAlert, Pill, Textarea } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import type { CheckoutCopy } from '../../lib/i18n/checkout-copy';
import type { Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { openBackerDispute, readDisputeWindow, type DisputeWindow } from '../../lib/pledges/disputes';
import { formatExactTime } from '../../lib/time';

/**
 * A backer disputing their payment — IDN-EXT-01 §6.3 (#43, #44).
 *
 * Offered on a paid pledge, behind one press, because most paid pledges are never disputed and a
 * form open on every one of them would read as an invitation. The window is the service's to judge —
 * open while the creator's payout is held, closed before withdrawal and after payout — and it is
 * asked before the form is offered (#480), so a backer is not handed a form that cannot succeed. A
 * window that cannot be read falls back to offering the form; the refusal is still worded. Nothing is
 * refunded here: an administrator decides.
 */
export interface BackerDisputeFormProps {
  readonly pledgeId: string;
  readonly copy: CheckoutCopy['dispute'];
  readonly locale: Locale;
}

type WindowState = { readonly status: 'loading' } | { readonly status: 'failed' } | DisputeWindow;

export function BackerDisputeForm({ pledgeId, copy, locale }: BackerDisputeFormProps) {
  const [disputeWindow, setDisputeWindow] = useState<WindowState>({ status: 'loading' });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    readDisputeWindow(pledgeId, controller.signal).then(
      (read) => setDisputeWindow(read),
      () => {
        if (!controller.signal.aborted) setDisputeWindow({ status: 'failed' });
      },
    );
    return () => controller.abort();
  }, [pledgeId]);

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

  if (disputeWindow.status === 'loading' || disputeWindow.status === 'CLOSED' || disputeWindow.status === 'NOTHING_LEFT') {
    return null;
  }

  if (disputeWindow.status === 'NOT_YET') {
    return <p className="max-w-[62ch] text-sm text-fg-64">{copy.notYet}</p>;
  }

  const until = disputeWindow.status === 'OPEN' && disputeWindow.until !== null ? disputeWindow.until : null;

  if (opened || (disputeWindow.status === 'OPEN' && disputeWindow.dispute !== null)) {
    return (
      <InlineAlert variant="info" title={copy.heading}>
        <p>{copy.opened}</p>
      </InlineAlert>
    );
  }

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Pill type="button" variant="ghost" onClick={() => setOpen(true)}>
          {copy.heading}
        </Pill>
        {until !== null && (
          <p className="text-sm text-fg-64">
            {fillPlaceholders(copy.until, { date: formatExactTime(until, locale) })}
          </p>
        )}
      </div>
    );
  }

  return (
    <section aria-labelledby="backer-dispute-heading" className="rounded-2xl border border-fg/8 bg-surface-2 p-6 sm:p-8">
      <h2 id="backer-dispute-heading" className="text-lg font-medium tracking-[-0.02em] text-fg">
        {copy.heading}
      </h2>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{copy.intro}</p>

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
