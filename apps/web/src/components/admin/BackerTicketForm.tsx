'use client';

import { Suspense, lazy, useId, useState, type FormEvent } from 'react';
import { Field, InlineAlert, Pill, Textarea, TextInput } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import { raiseBackerTicket, type Ticket } from '../../lib/admin/tickets';
import { isPledgeId } from '../../lib/admin/refunds';
import { actionMessageFor, shortId } from '../../lib/admin/refusals';
import { holds } from '../../lib/admin/staff';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { ConsoleRefusalsCopy } from '../../lib/i18n/admin/common-copy';
import type { BackerTicketCopy, RefundBankDetailsCopy } from '../../lib/i18n/admin/people-copy';
import { useConsoleMembership } from './ConsoleMembership';
import type { RecordedRefundAccount } from './RefundBankDetailsForm';

/*
 * #400's account form, fetched once a ticket has been raised. It carries the IBAN rules and
 * `decimal.js`, which neither console should pay for before somebody needs them.
 */
const RefundBankDetailsForm = lazy(() =>
  import('./RefundBankDetailsForm').then((module) => ({ default: module.RefundBankDetailsForm })),
);

/**
 * A ticket raised for a backer who wrote in somewhere else, and the refund account recorded
 * from it — issue #416, part of epic #392.
 *
 * <h2>Why staff raise it</h2>
 *
 * A refund past the provider's window is paid into an account recorded only from a ticket the
 * pledge's backer raised, and a backer cannot raise one: there is no public form, and the
 * notification sends them to WhatsApp. So support records the conversation as a ticket in the
 * backer's name. The service finds the backer from the pledge — nothing is searched and nobody
 * is chosen by hand — and audits that this member of staff raised it.
 *
 * <h2>One flow, two places</h2>
 *
 * On the support console it asks for the pledge. On a refund waiting for bank details the
 * pledge is the row's, and the account form opens as soon as the ticket exists, because
 * recording the account is why the ticket was raised there. Either way the account form is
 * `RefundBankDetailsForm`, bound to the new ticket, with the checks it already makes.
 *
 * <h2>Behind a press, for `HANDLE_SUPPORT` only</h2>
 *
 * What is offered, not what is allowed: the service refuses anybody else.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5: the admin console has none, and this is a step before money moves.
 */
export interface BackerTicketFormProps {
  /** The pledge, when the screen already knows it. Without one the form asks. */
  readonly pledgeId?: string;
  readonly copy: BackerTicketCopy;
  readonly bankDetails: RefundBankDetailsCopy;
  /** The console's subject and refusal table, for a refusal this form has no words for. */
  readonly subject: string;
  readonly refusals: ConsoleRefusalsCopy;
  /** Opens the account form as soon as the ticket is raised. */
  readonly recordAccount?: boolean;
  readonly onRaised?: (ticket: Ticket) => void;
  readonly onRecorded?: (saved: RecordedRefundAccount) => void;
}

export function BackerTicketForm({
  pledgeId,
  copy,
  bankDetails,
  subject,
  refusals,
  recordAccount = false,
  onRaised,
  onRecorded,
}: BackerTicketFormProps) {
  const { membership } = useConsoleMembership();
  const [open, setOpen] = useState(false);
  const [pledge, setPledge] = useState(pledgeId ?? '');
  const [title, setTitle] = useState(copy.subjectDefault);
  const [body, setBody] = useState('');
  const [pledgeError, setPledgeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [raised, setRaised] = useState<Ticket | null>(null);
  /* Two parts of one pledge's refund are two rows, each with this form, so not the pledge's id. */
  const headingId = useId();

  function reset(): void {
    setOpen(false);
    setPledge(pledgeId ?? '');
    setTitle(copy.subjectDefault);
    setBody('');
    setPledgeError(null);
    setError(null);
    setRaised(null);
  }

  async function raise(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setError(null);

    const target = pledge.trim();
    // Checked here so a truncated paste is caught in the field.
    const valid = isPledgeId(target);
    setPledgeError(valid ? null : copy.pledgeInvalid);
    if (!valid || title.trim() === '' || body.trim() === '') return;

    setBusy(true);
    try {
      const file = await raiseBackerTicket({ pledgeId: target, subject: title.trim(), body: body.trim() });
      setRaised(file.ticket);
      onRaised?.(file.ticket);
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.problem?.code : undefined;
      setError((code != null ? copy.errors[code] : undefined) ?? actionMessageFor(cause, subject, refusals));
    } finally {
      setBusy(false);
    }
  }

  if (!holds(membership, 'HANDLE_SUPPORT')) return null;

  if (!open) {
    return (
      <div className="mt-3">
        <Pill variant="outline" size="sm" onClick={() => setOpen(true)}>
          {recordAccount ? copy.openFromRefund : copy.open}
        </Pill>
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} className="mt-3 flex flex-col gap-3 border-t border-fg/8 pt-3">
      <h3 id={headingId} className="text-sm font-medium text-fg">
        {copy.heading}
      </h3>

      {/* There before the ticket is, so the confirmation is announced when it arrives. */}
      <div aria-live="polite">
        {raised !== null && (
          <InlineAlert variant="success" title={copy.raisedTitle}>
            {fillPlaceholders(copy.raisedBody, { id: shortId(raised.id) })}
          </InlineAlert>
        )}
      </div>

      {raised === null ? (
        <>
          <p className="max-w-[62ch] text-xs text-fg-64">{copy.intro}</p>

          <form onSubmit={(event) => void raise(event)} noValidate className="flex max-w-[34rem] flex-col gap-3">
            {pledgeId === undefined && (
              <Field label={copy.pledgeLabel} hint={copy.pledgeHint} error={pledgeError} required>
                <TextInput
                  value={pledge}
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  onChange={(event) => {
                    setPledge(event.target.value);
                    setPledgeError(null);
                  }}
                />
              </Field>
            )}

            <Field label={copy.subjectLabel} required>
              <TextInput value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
            </Field>

            <Field label={copy.bodyLabel} hint={copy.bodyHint} required>
              <Textarea rows={3} value={body} maxLength={20000} onChange={(event) => setBody(event.target.value)} />
            </Field>

            <div className="flex flex-wrap gap-2">
              <Pill
                type="submit"
                variant="outline"
                size="sm"
                disabled={pledge.trim() === '' || title.trim() === '' || body.trim() === ''}
                aria-disabled={busy}
              >
                {busy ? copy.raising : copy.raise}
              </Pill>
              <Pill type="button" variant="ghost" size="sm" onClick={reset}>
                {copy.cancel}
              </Pill>
            </div>
          </form>

          {error !== null && (
            <InlineAlert variant="danger" title={copy.failedTitle}>
              {error}
            </InlineAlert>
          )}
        </>
      ) : (
        <>
          <Suspense fallback={null}>
            <RefundBankDetailsForm
              pledgeId={pledge.trim()}
              ticketId={raised.id}
              copy={bankDetails}
              subject={subject}
              refusals={refusals}
              startOpen={recordAccount}
              onRecorded={onRecorded}
            />
          </Suspense>

          <div>
            <Pill type="button" variant="ghost" size="sm" onClick={reset}>
              {copy.done}
            </Pill>
          </div>
        </>
      )}
    </section>
  );
}
