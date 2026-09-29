import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { PledgeManager, RaiseReturnNotice } from './PledgeManager';
import { getPledge, getPublicRewards, type PledgeRaise, type PledgeResponse } from '../../lib/pledges/api';
import { findMyPledge } from '../../lib/pledges/backer';
import type { PaymentReturnHint } from '../../lib/pledges/payment';
import { checkoutCopyFrom } from '../../lib/i18n/checkout-copy';
import { pledgeManagerCopyFrom } from '../../lib/i18n/pledges-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { formatExactTime } from '../../lib/time';
import { translatorFor } from '../../test-copy';

vi.mock('../../lib/pledges/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/pledges/api')>()),
  getPledge: vi.fn(),
  getPublicRewards: vi.fn(),
}));

vi.mock('../../lib/pledges/backer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/pledges/backer')>()),
  findMyPledge: vi.fn(),
}));

/* The words the page resolves, built from the catalogue with the same builders (#131). */
const CHECKOUT = checkoutCopyFrom(translatorFor('checkout'));
const PLEDGES = pledgeManagerCopyFrom(translatorFor('account.pledges'));
const RAISED = PLEDGES.raiseReturned;

/**
 * #171: the pledge screen for a paid pledge — whether it offers a raise, what it says to a backer
 * the provider sent back from paying one, and how long it keeps asking.
 *
 * The notice is decided by the raise's state and not by the word in the address, which is only a
 * hint that somebody has just come back; so every state is tried through both doors. The polling is
 * tried with a clock this file controls: it has to stop when the raise settles, and it has to stop
 * after its bound when it does not.
 */

const NOW = new Date('2026-09-29T12:00:00Z').getTime();
const IN_TEN_MINUTES = new Date(NOW + 10 * 60 * 1000).toISOString();
const A_MINUTE_AGO = new Date(NOW - 60 * 1000).toISOString();

function raiseOf(state: string, overrides: Partial<PledgeRaise> = {}): PledgeRaise {
  return {
    id: 'raise-1',
    state,
    amount: { amount: '25.00', currency: 'AZN' },
    total: { amount: '75.00', currency: 'AZN' },
    holdExpiresAt: IN_TEN_MINUTES,
    createdAt: new Date(NOW - 60 * 1000).toISOString(),
    endedAt: null,
    resumeUrl: null,
    ...overrides,
  };
}

function paid(overrides: Partial<PledgeResponse> = {}): PledgeResponse {
  return {
    id: 'pledge-1',
    projectId: 'project-1',
    state: 'COLLECTED',
    rewardTierId: null,
    addons: [],
    amounts: {
      base: { amount: '50.00', currency: 'AZN' },
      addons: { amount: '0.00', currency: 'AZN' },
      bonus: { amount: '0.00', currency: 'AZN' },
      shipping: { amount: '0.00', currency: 'AZN' },
      tax: { amount: '0.00', currency: 'AZN' },
      total: { amount: '50.00', currency: 'AZN' },
    },
    shippingCountry: null,
    isAnonymous: false,
    reservationExpiresAt: null,
    confirmedAt: '2026-09-01T00:00:00Z',
    canceledAt: null,
    paymentMethodId: null,
    cardVerified: false,
    latePledge: false,
    supplements: [],
    raisable: true,
    latestRaise: null,
    ...overrides,
  };
}

const held = () => fillPlaceholders(RAISED.heldBody, { time: formatExactTime(IN_TEN_MINUTES, 'en') });

afterEach(cleanup);

describe('what a backer back from paying a raise is told', () => {
  type Expected = { title: string; body: string } | null;

  const RAISED_NOTICE = { title: RAISED.raisedTitle, body: RAISED.raisedBody };
  const UNAPPLIED_NOTICE = { title: RAISED.unappliedTitle, body: RAISED.unappliedBody };
  const FAILED_NOTICE = { title: RAISED.failedTitle, body: RAISED.failedBody };
  const WAITING_NOTICE = { title: CHECKOUT.returned.waitingTitle, body: CHECKOUT.returned.waitingBody };

  const CASES: Array<[string, PaymentReturnHint, PledgeRaise | null, () => Expected]> = [
    ['no raise at all', 'returned', null, () => null],
    ['no raise at all', 'failed', null, () => null],
    ['SUCCEEDED', 'returned', raiseOf('SUCCEEDED'), () => RAISED_NOTICE],
    ['SUCCEEDED', 'failed', raiseOf('SUCCEEDED'), () => RAISED_NOTICE],
    ['UNAPPLIED', 'returned', raiseOf('UNAPPLIED'), () => UNAPPLIED_NOTICE],
    ['UNAPPLIED', 'failed', raiseOf('UNAPPLIED'), () => UNAPPLIED_NOTICE],
    ['FAILED', 'returned', raiseOf('FAILED'), () => FAILED_NOTICE],
    ['FAILED', 'failed', raiseOf('FAILED'), () => FAILED_NOTICE],
    ['EXPIRED', 'returned', raiseOf('EXPIRED'), () => FAILED_NOTICE],
    ['EXPIRED', 'failed', raiseOf('EXPIRED'), () => FAILED_NOTICE],
    ['ABANDONED', 'returned', raiseOf('ABANDONED'), () => FAILED_NOTICE],
    ['ABANDONED', 'failed', raiseOf('ABANDONED'), () => FAILED_NOTICE],
    ['PENDING and holding', 'returned', raiseOf('PENDING'), () => WAITING_NOTICE],
    // The error door while the raise still holds: nothing charged, and the hold's end named.
    ['PENDING and holding', 'failed', raiseOf('PENDING'), () => ({ title: RAISED.failedTitle, body: held() })],
    ['PENDING past its hold', 'returned', raiseOf('PENDING', { holdExpiresAt: A_MINUTE_AGO }), () => WAITING_NOTICE],
    ['PENDING past its hold', 'failed', raiseOf('PENDING', { holdExpiresAt: A_MINUTE_AGO }), () => FAILED_NOTICE],
    // A state a later service adds is not guessed at, and above all not called "nothing was charged".
    ['a state this build does not know', 'returned', raiseOf('REVERSED'), () => null],
    ['a state this build does not know', 'failed', raiseOf('REVERSED'), () => null],
  ];

  it.each(CASES)('%s, through the %s door', (_, hint, raise, expected) => {
    const { container } = render(
      <RaiseReturnNotice hint={hint} raise={raise} copy={RAISED} checkout={CHECKOUT} locale="en" now={NOW} />,
    );

    const notice = expected();
    if (notice === null) {
      expect(container).toBeEmptyDOMElement();
      return;
    }
    expect(screen.getByText(notice.title)).toBeInTheDocument();
    expect(screen.getByText(notice.body)).toBeInTheDocument();
    if (notice.body !== RAISED.failedBody) {
      expect(screen.queryByText(RAISED.failedBody)).not.toBeInTheDocument();
    }
  });
});

describe('the pledge screen for a paid pledge', () => {
  const pledgeMock = vi.mocked(getPledge);

  function at(search: string): void {
    window.history.replaceState({}, '', `/en/pledges/pledge-1${search}`);
  }

  /** Lets the reads the screen made on mount, and the renders they cause, finish. */
  async function settle(ms = 0): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function open(): Promise<void> {
    render(<PledgeManager pledgeId="pledge-1" copy={CHECKOUT} pledges={PLEDGES} />);
    await settle();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    pledgeMock.mockReset();
    vi.mocked(findMyPledge).mockResolvedValue(null);
    vi.mocked(getPublicRewards).mockResolvedValue({ currency: 'AZN', rewards: [], addons: [] });
    at('');
  });

  afterEach(() => {
    vi.useRealTimers();
    at('');
  });

  describe('offers a raise only when the service says it may be raised', () => {
    it('draws the raise form for a raisable paid pledge', async () => {
      pledgeMock.mockResolvedValue(paid({ raisable: true }));
      await open();

      expect(screen.getByRole('heading', { name: PLEDGES.editor.raiseHeading })).toBeInTheDocument();
      expect(screen.queryByText(PLEDGES.lockedTitle)).not.toBeInTheDocument();
    });

    it.each([
      ['says it may not', { raisable: false }],
      ['predates the field', { raisable: undefined }],
    ])('draws the locked notice for a paid pledge whose service %s', async (_, overrides) => {
      pledgeMock.mockResolvedValue(paid(overrides));
      await open();

      expect(screen.getByText(PLEDGES.lockedTitle)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: PLEDGES.editor.raiseHeading })).not.toBeInTheDocument();
    });

    it('never offers a raise for a pledge that is not paid, whatever the flag says', async () => {
      pledgeMock.mockResolvedValue(paid({ state: 'REFUNDED', raisable: true }));
      await open();

      expect(screen.getByText(PLEDGES.lockedTitle)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: PLEDGES.editor.raiseHeading })).not.toBeInTheDocument();
    });
  });

  describe('while a raise it came back from settles', () => {
    it('asks again until the raise succeeds, announces it, and then stops asking', async () => {
      at('?raise=returned');
      pledgeMock
        .mockResolvedValueOnce(paid({ latestRaise: raiseOf('PENDING') }))
        .mockResolvedValueOnce(paid({ latestRaise: raiseOf('PENDING') }))
        .mockResolvedValue(paid({ latestRaise: raiseOf('SUCCEEDED') }));
      await open();

      const region = screen.getByRole('status');
      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(within(region).getByText(CHECKOUT.returned.waitingTitle)).toBeInTheDocument();

      await settle(3000);
      expect(pledgeMock).toHaveBeenCalledTimes(2);
      expect(within(region).getByText(CHECKOUT.returned.waitingTitle)).toBeInTheDocument();

      await settle(3000);
      expect(pledgeMock).toHaveBeenCalledTimes(3);
      // The same live region, so the change is read out rather than drawn silently.
      expect(within(region).getByText(RAISED.raisedTitle)).toBeInTheDocument();

      await settle(30_000);
      expect(pledgeMock).toHaveBeenCalledTimes(3);
    });

    it('asks again after the error door too, and says the payment is held until the hold ends', async () => {
      at('?raise=failed');
      pledgeMock
        .mockResolvedValueOnce(paid({ latestRaise: raiseOf('PENDING') }))
        .mockResolvedValue(paid({ latestRaise: raiseOf('FAILED') }));
      await open();

      expect(screen.getByText(held())).toBeInTheDocument();
      expect(screen.queryByText(RAISED.failedBody)).not.toBeInTheDocument();

      await settle(3000);
      expect(pledgeMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText(RAISED.failedBody)).toBeInTheDocument();

      await settle(30_000);
      expect(pledgeMock).toHaveBeenCalledTimes(2);
    });

    it('stops after its bound when the raise never settles', async () => {
      at('?raise=returned');
      pledgeMock.mockResolvedValue(paid({ latestRaise: raiseOf('PENDING') }));
      await open();

      // Twenty further reads, three seconds apart — and none after them.
      for (let check = 0; check < 25; check += 1) await settle(3000);
      expect(pledgeMock).toHaveBeenCalledTimes(21);
      expect(screen.getByText(CHECKOUT.returned.waitingTitle)).toBeInTheDocument();
    });

    it('does not ask again when nobody has just come back from paying', async () => {
      pledgeMock.mockResolvedValue(paid({ latestRaise: raiseOf('PENDING') }));
      await open();

      await settle(30_000);
      expect(pledgeMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(CHECKOUT.returned.waitingTitle)).not.toBeInTheDocument();
    });
  });
});
