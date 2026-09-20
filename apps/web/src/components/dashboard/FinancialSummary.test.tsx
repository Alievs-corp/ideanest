import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../../lib/api/problem';
import { expectNoViolations } from '../../test-axe';
import type { CampaignFinance } from '../../lib/dashboard/finance';
import { FinancialSummary } from './FinancialSummary';
import { financeCopyFrom } from '../../lib/i18n/dashboard-copy';
import { translatorFor } from '../../test-copy';

/**
 * §4.7's CD-16 — the creator's financial summary. Issue #99.
 *
 * WHAT THESE COVER, and every one of them is a statement about somebody's money that a
 * screenshot cannot check:
 *
 *   - **the whole breakdown is on screen, not the net.** A creator looking at this is asking
 *     "why was I paid this", which is five questions; a single figure with a note saying
 *     "fees deducted" is not something anybody can check.
 *   - **projected and settled are never rendered identically.** Before a payout exists the
 *     fees are what today's schedule would charge; afterwards they are what it was priced at.
 *     A panel that said the same thing for both would be lying on one of the two days it
 *     matters.
 *   - **a zero for tax says which kind of zero it is.** A bare "− AZN 0.00" reads as "no tax
 *     is due on your earnings", which is not something this platform is in a position to say.
 *   - **books that do not balance are said out loud**, to somebody who can act on it. A
 *     posting that does not balance is refused by a database trigger, so it can only appear
 *     for a row that arrived past both the application and the trigger.
 *   - **a refusal reads as something a creator can act on** rather than as a status code, and
 *     a 403 says which grant is missing.
 */

const PROJECT_ID = '0193f2a1-0000-7000-8000-000000000001';

function finance(overrides: Partial<CampaignFinance> = {}): CampaignFinance {
  return {
    basis: 'PROJECTED',
    currency: 'AZN',
    gross: { amount: '10000.00', currency: 'AZN' },
    refunded: { amount: '250.00', currency: 'AZN' },
    platformFee: { amount: '500.00', currency: 'AZN' },
    processingFee: { amount: '290.00', currency: 'AZN' },
    taxWithheld: { amount: '0.00', currency: 'AZN' },
    taxCollected: false,
    net: { amount: '8960.00', currency: 'AZN' },
    paidOut: { amount: '0.00', currency: 'AZN' },
    feeScheduleId: '0193f2a1-0000-7000-8000-000000000003',
    payouts: [],
    ledger: [
      { account: 'escrow', net: { amount: '10000.00', currency: 'AZN' } },
      { account: 'creator:0193f2a1-0000-7000-8000-000000000002', net: { amount: '-10000.00', currency: 'AZN' } },
    ],
    reconciled: true,
    computedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  };
}

/*
 * The words, built from `messages/en.json` with the builder the route calls — #79.
 *
 * Retyping the sentences here would give a test that passes whatever the catalogue says, and
 * would still be green with the message file empty. `src/test-copy.ts` carries the argument.
 */
const COPY = financeCopyFrom(translatorFor('dashboard'));

function renderPanel(body: CampaignFinance) {
  return render(
    <FinancialSummary projectId={PROJECT_ID} load={() => Promise.resolve(body)} copy={COPY} />,
  );
}

function refusing(cause: unknown) {
  return render(
    <FinancialSummary projectId={PROJECT_ID} load={() => Promise.reject(cause)} copy={COPY} />,
  );
}

/** The row of the deduction table with this heading. */
function row(label: string): HTMLElement {
  const heading = screen.getByRole('rowheader', { name: new RegExp(label, 'u') });
  const parent = heading.closest('tr');
  if (parent === null) throw new Error(`${label} is not in a row`);
  return parent;
}

afterEach(cleanup);

describe('the financial summary', () => {
  it('prints every deduction between the gross and the net', async () => {
    renderPanel(finance());

    await screen.findByRole('heading', { level: 1, name: 'Financial summary' });

    // The exact strings the service sent, formatted — never re-derived here. CLAUDE.md §3.
    expect(within(row('Gross collected')).getByText(/10,?000\.00/u)).toBeInTheDocument();
    expect(within(row('Platform fee')).getByText(/500\.00/u)).toBeInTheDocument();
    expect(within(row('Processing fee')).getByText(/290\.00/u)).toBeInTheDocument();
    expect(within(row('Refunded to backers')).getByText(/250\.00/u)).toBeInTheDocument();
    expect(within(row('Payable')).getByText(/8,?960\.00/u)).toBeInTheDocument();
  });

  it('says these figures can still move when no payout has been calculated', async () => {
    renderPanel(finance());

    expect(await screen.findByText('Projected')).toBeInTheDocument();
    expect(document.body.textContent).toContain('No payout has been calculated yet');
  });

  it('says they are the payout’s own figures once one exists', async () => {
    renderPanel(finance({ basis: 'SETTLED' }));

    expect(await screen.findByText('Settled')).toBeInTheDocument();
    expect(document.body.textContent).toContain('read from the payout itself');
    expect(document.body.textContent).not.toContain('No payout has been calculated yet');
  });

  /**
   * "No tax was due" and "this platform withholds none" are different sentences to put in
   * front of somebody who has to file a return, and only the second one is true.
   */
  it('says the platform withholds no tax, rather than printing a bare zero', async () => {
    renderPanel(finance());

    await screen.findByRole('heading', { level: 1, name: 'Financial summary' });
    expect(within(row('Tax withheld')).getByText(/withholds no tax/u)).toBeInTheDocument();
  });

  it('lists every payout, including one that never went anywhere', async () => {
    renderPanel(
      finance({
        basis: 'SETTLED',
        paidOut: { amount: '8960.00', currency: 'AZN' },
        payouts: [
          {
            id: 'p2',
            state: 'CANCELLED',
            net: { amount: '8960.00', currency: 'AZN' },
            calculatedAt: '2026-08-18T10:00:00.000Z',
            sentAt: null,
          },
          {
            id: 'p1',
            state: 'PAID',
            net: { amount: '8960.00', currency: 'AZN' },
            calculatedAt: '2026-08-10T10:00:00.000Z',
            sentAt: '2026-08-12T10:00:00.000Z',
          },
        ],
      }),
    );

    // A creator who saw one calculated and then saw nothing would have no way to tell a
    // cancellation from a screen that had stopped working.
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
  });

  it('says so when there are no payouts, rather than showing an empty list', async () => {
    renderPanel(finance());

    expect(await screen.findByText(/None yet/u)).toBeInTheDocument();
  });

  it('publishes the ledger, so the totals can be checked against something', async () => {
    renderPanel(finance());

    expect(await screen.findByText('escrow')).toBeInTheDocument();
    expect(screen.getByText('creator:0193f2a1-0000-7000-8000-000000000002')).toBeInTheDocument();
  });

  it('warns, once, when this campaign’s books do not balance', async () => {
    renderPanel(finance({ reconciled: false }));

    expect(await screen.findByText('These books do not balance')).toBeInTheDocument();
    expect(document.body.textContent).toContain('contact support');
  });

  it('says nothing about balancing when they do', async () => {
    renderPanel(finance());

    await screen.findByRole('heading', { level: 1, name: 'Financial summary' });
    expect(screen.queryByText('These books do not balance')).not.toBeInTheDocument();
  });

  it('names the missing grant when a collaborator may not see the money', async () => {
    refusing(new ApiError(403, undefined));

    expect(await screen.findByText(/collaborator grant/u)).toBeInTheDocument();
  });

  it('does not print a status code at somebody who cannot act on one', async () => {
    refusing(new TypeError('fetch failed'));

    const message = await screen.findByText(/could not be loaded/u);
    expect(message.textContent).not.toMatch(/\d{3}/u);
  });

  it('has no automatically detectable accessibility violation', async () => {
    const { container } = renderPanel(finance({ reconciled: false }));

    await screen.findByRole('heading', { level: 1, name: 'Financial summary' });
    await waitFor(() => expect(screen.getByText('escrow')).toBeInTheDocument());

    await expectNoViolations(container);
  });
});
