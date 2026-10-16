'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import Decimal from 'decimal.js';
import { Field, InlineAlert, Pill, TextInput } from '@ideanest/ui';
import { checkIban, ibanDefectOf, reformatIban } from '@ideanest/account/iban';
import { ApiError } from '../../lib/api/problem';
import { recordRefundBankDetails } from '../../lib/admin/refund-bank-details';
import type { Refund } from '../../lib/admin/refunds';
import { actionMessageFor } from '../../lib/admin/refusals';
import { formatMoney, toMoney } from '../../lib/money';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { ConsoleRefusalsCopy } from '../../lib/i18n/admin/common-copy';
import type { RefundBankDetailsCopy } from '../../lib/i18n/admin/people-copy';
import { holds } from '../../lib/admin/staff';
import { useConsoleMembership } from './ConsoleMembership';

/**
 * The account a pledge's refund is paid into, recorded from the ticket the backer gave it in —
 * issue #400, part of epic #392.
 *
 * <h2>Behind a press, on a pledge's ticket only</h2>
 *
 * Most pledge tickets are not about a bank refund, so the form is one control until somebody asks
 * for it. `SupportConsole` loads this module only when a pledge's ticket is opened, which keeps
 * the IBAN table and `decimal.js` off the console's first load. It is drawn only for a reader
 * holding `HANDLE_SUPPORT` — what is offered, not what is allowed: the service refuses anybody
 * else.
 *
 * <h2>The IBAN is checked here in the service's own terms</h2>
 *
 * `@ideanest/account/iban`'s `checkIban` — any country's, because a backer may bank anywhere — so a
 * mistyped number is caught while it is still in the field, with the same sentence a refusal's
 * `meta.defect` lands on. It is grouped in fours as it is typed and sent in its electronic form.
 * What was typed is cleared once it is recorded and never echoed in a message.
 *
 * <h2>The ticket is this one, and may be changed</h2>
 *
 * Prefilled with the open ticket, which is where the account almost always came from. It stays a
 * field because a backer sometimes writes twice, and the service checks whichever is given: a
 * ticket the pledge's backer did not raise is refused.
 *
 * <h2>Also the second step of a ticket raised for a backer — #416</h2>
 *
 * `BackerTicketForm` draws it bound to the ticket it has just raised. From a refund's row it is
 * drawn open, since recording the account is why the ticket was raised there, and the row hears
 * of the recording so the list can move the refund on.
 *
 * <h2>Motion: none</h2>
 *
 * A step before money moves.
 */
export interface RefundBankDetailsFormProps {
  readonly pledgeId: string;
  readonly ticketId: string;
  readonly copy: RefundBankDetailsCopy;
  /** The console's subject and refusal table, for a refusal this form has no words for. */
  readonly subject: string;
  readonly refusals: ConsoleRefusalsCopy;
  /** Drawn open rather than behind its press. */
  readonly startOpen?: boolean;
  /** Told what was recorded, after the form has said so itself. */
  readonly onRecorded?: (saved: RecordedRefundAccount) => void;
}

/** What was recorded: the masked hint and the total now waiting for the transfer, formatted. */
export interface RecordedRefundAccount {
  readonly hint: string;
  readonly amount: string;
}

export function RefundBankDetailsForm({
  pledgeId,
  ticketId,
  copy,
  subject,
  refusals,
  startOpen = false,
  onRecorded,
}: RefundBankDetailsFormProps) {
  const { membership } = useConsoleMembership();
  const [open, setOpen] = useState(startOpen);
  const [iban, setIban] = useState('');
  const [holder, setHolder] = useState('');
  const [ticket, setTicket] = useState(ticketId);
  const [ibanError, setIbanError] = useState<string | null>(null);
  const [holderError, setHolderError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<RecordedRefundAccount | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  const caret = useRef<{ readonly input: HTMLInputElement; readonly at: number } | null>(null);

  useLayoutEffect(() => {
    const pending = caret.current;
    if (pending === null) return;
    caret.current = null;
    if (document.activeElement === pending.input) pending.input.setSelectionRange(pending.at, pending.at);
  }, [iban]);

  useEffect(() => {
    if (ibanError !== null) form.current?.querySelector<HTMLInputElement>('input[name="iban"]')?.focus();
  }, [ibanError]);

  function typeIban(event: ChangeEvent<HTMLInputElement>): void {
    const input = event.currentTarget;
    const forward = (event.nativeEvent as Partial<InputEvent>).inputType === 'deleteContentForward';
    const next = reformatIban(iban, input.value, input.selectionStart ?? input.value.length, forward ? 'forward' : 'backward');
    caret.current = { input, at: next.caret };
    setIban(next.value);
    setIbanError(null);
    setSaved(null);
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;
    setError(null);
    setSaved(null);

    const checked = checkIban(iban);
    const name = holder.trim();
    setIbanError(checked.ok ? null : copy.ibanDefect[checked.defect]);
    setHolderError(name === '' ? copy.holderRequired : null);
    if (!checked.ok || name === '' || ticket.trim() === '') return;

    setSaving(true);
    try {
      const page = await recordRefundBankDetails(pledgeId, {
        iban: checked.value,
        holderName: name,
        ticketId: ticket.trim(),
      });
      const summary = summaryOf(page.refunds);
      setSaved(summary);
      setIban('');
      setHolder('');
      onRecorded?.(summary);
    } catch (cause) {
      const problem = cause instanceof ApiError ? cause.problem : undefined;
      const defect = problem?.code === 'MALFORMED_IBAN' ? ibanDefectOf(problem.meta?.['defect']) : null;
      if (defect !== null) {
        setIbanError(copy.ibanDefect[defect]);
      } else {
        const code = problem?.code;
        setError((code != null ? copy.errors[code] : undefined) ?? actionMessageFor(cause, subject, refusals));
      }
    } finally {
      setSaving(false);
    }
  }

  if (!holds(membership, 'HANDLE_SUPPORT')) return null;

  if (!open) {
    return (
      <div className="mt-4 border-t border-white/8 pt-4">
        <Pill variant="ghost" size="sm" onClick={() => setOpen(true)}>
          {copy.open}
        </Pill>
      </div>
    );
  }

  return (
    <section aria-labelledby={`refund-bank-${pledgeId}`} className="mt-4 flex flex-col gap-3 border-t border-white/8 pt-4">
      <h4 id={`refund-bank-${pledgeId}`} className="text-sm font-medium text-white">
        {copy.heading}
      </h4>
      <p className="max-w-[62ch] text-xs text-white/64">{copy.intro}</p>

      <form ref={form} onSubmit={(event) => void save(event)} noValidate className="flex max-w-[34rem] flex-col gap-3">
        <Field label={copy.ibanLabel} hint={copy.ibanHint} error={ibanError} required>
          <TextInput
            name="iban"
            value={iban}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="font-mono"
            onChange={typeIban}
          />
        </Field>

        <Field label={copy.holderLabel} hint={copy.holderHint} error={holderError} required>
          <TextInput
            value={holder}
            maxLength={200}
            autoComplete="off"
            onChange={(event) => {
              setHolder(event.target.value);
              setHolderError(null);
              setSaved(null);
            }}
          />
        </Field>

        <Field label={copy.ticketLabel} hint={copy.ticketHint} required>
          <TextInput
            value={ticket}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTicket(event.target.value)}
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Pill
            type="submit"
            variant="outline"
            size="sm"
            disabled={iban.trim() === '' || holder.trim() === '' || ticket.trim() === ''}
            aria-disabled={saving}
          >
            {saving ? copy.saving : copy.save}
          </Pill>
          <Pill type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            {copy.cancel}
          </Pill>
        </div>
      </form>

      <div aria-live="polite">
        {saved !== null && (
          <InlineAlert variant="success" title={copy.savedTitle}>
            {fillPlaceholders(copy.savedBody, { hint: saved.hint, amount: saved.amount })}
          </InlineAlert>
        )}
      </div>
      {error !== null && (
        <InlineAlert variant="danger" title={copy.failedTitle}>
          {error}
        </InlineAlert>
      )}
    </section>
  );
}

/**
 * What was recorded, said back: the masked hint and the total now waiting for the transfer.
 *
 * <p>Summed with `decimal.js` and never as numbers, since a pledge's refund may be in parts. One
 * currency, because the service refuses a refund in any currency but the pledge's.
 */
function summaryOf(parts: readonly Refund[]): RecordedRefundAccount {
  const waiting = parts.filter((part) => part.state === 'AWAITING_TRANSFER');
  const first = waiting[0] ?? parts[0];
  const total = waiting.reduce((sum, part) => sum.plus(part.amount.amount), new Decimal(0));
  return {
    hint: first?.bankTransfer?.ibanHint ?? '',
    amount: first === undefined ? '' : formatMoney(toMoney(total, first.amount.currency)),
  };
}
