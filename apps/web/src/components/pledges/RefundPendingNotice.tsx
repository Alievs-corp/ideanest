'use client';

import { InlineAlert } from '@ideanest/ui';
import { WHATSAPP_CONTACT_NUMBER } from '../../lib/contact/whatsapp';
import { formatMoney, type Money } from '../../lib/money';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';
import type { RefundPendingCopy } from '../../lib/i18n/pledges-copy';

/**
 * A refund waiting to be paid by bank transfer — #400.
 *
 * The provider could no longer send it back to the card, so the money goes by bank transfer and
 * support needs the account it should go to. A backer cannot raise a ticket from the site, so the
 * way to reach support is the WhatsApp conversation the site already offers, opened here with the
 * pledge quoted. The pledge is printed in full as well, for whoever gets in touch another way: it is
 * what support finds the refund by.
 *
 * <p>Both waiting states read the same here. Whether the account is already on file is a fact
 * about the back office, and to the backer the money has not arrived either way, so the notice
 * says what to do if they have not been in touch and that nothing more is needed if they have.
 */
export function RefundPendingNotice({
  pledgeId,
  amount,
  copy,
}: {
  readonly pledgeId: string;
  readonly amount: Money;
  readonly copy: RefundPendingCopy;
}) {
  return (
    <InlineAlert variant="warning" title={copy.title}>
      <p>{fillPlaceholders(copy.body, { amount: formatMoney(amount) })}</p>
      <p className="mt-2">{copy.already}</p>
      <p className="mt-2">
        {fillNodes(copy.reference, {
          reference: <span className="select-all break-all font-mono text-fg">{pledgeId}</span>,
        })}
      </p>
      <p className="mt-3">
        <a
          href={draftHref(fillPlaceholders(copy.message, { reference: pledgeId }))}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-sm font-medium text-fg underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          {copy.contact}
        </a>
      </p>
    </InlineAlert>
  );
}

/**
 * The WhatsApp link with the platform's draft rather than one composed from the enquiry form —
 * `whatsappHref`'s encoding (`%20` and never `+`), without a name above the message: it arrives
 * from the backer's own number, and they may add one before pressing send.
 */
function draftHref(draft: string): string {
  return `https://wa.me/${WHATSAPP_CONTACT_NUMBER}?text=${encodeURIComponent(draft.trim())}`;
}
