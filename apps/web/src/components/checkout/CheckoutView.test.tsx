import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  createPledgeDraft,
  getPublicRewards,
  payForPledge,
  type PaymentPageResponse,
  type PledgeResponse,
  type PublicReward,
} from '../../lib/pledges/api';
import { expectNoViolations } from '../../test-axe';
import { CheckoutView } from './CheckoutView';
import MESSAGES from '../../../messages/en.json';
import { checkoutCopyFrom } from '../../lib/i18n/checkout-copy';
import { leaveForPaymentPage } from '../../lib/pledges/payment';

/*
 * The copy the server would have resolved, built from `messages/en.json` by the same function
 * the page calls. Retyping the words here would give a test that passes whatever the
 * catalogue says, which is the opposite of what it is for.
 */
const COPY = checkoutCopyFrom(
  Object.assign(
    (key: string) => {
      let node: unknown = MESSAGES.checkout;
      for (const segment of key.split('.')) node = (node as Record<string, unknown>)[segment];
      if (typeof node !== 'string') throw new Error(`no message at checkout.${key}`);
      return node;
    },
    {
      raw(key: string) {
        let node: unknown = MESSAGES.checkout;
        for (const segment of key.split('.')) node = (node as Record<string, unknown>)[segment];
        return node;
      },
    },
  ),
);


/**
 * The checkout end to end, with the three endpoints stubbed.
 *
 * WHAT THESE COVER, and why each is here rather than left to Storybook:
 *
 *   - choosing a tier fills the contribution with its price and moves the total.
 *     PL-01 and PL-06 are one gesture to a backer and they are asserted as one
 *   - a sold-out tier is VISIBLE and INERT. Hiding it and disabling it look the
 *     same in a screenshot of a tier that is in stock
 *   - support with no reward is a choice, not a link. PL-02 is a third of the
 *     money on most campaigns
 *   - an amount below the tier price is refused before a request is made
 *   - add-on quantities multiply and sum. Arithmetic near money is not optional
 *     to test (CLAUDE.md §3)
 *   - the destination is asked for when something is posted and NOT when nothing
 *     is, and a destination the creator has not priced is refused by name
 *   - the idempotency key survives a retry. This is the one defect on this
 *     screen that costs somebody real money, and it is invisible everywhere else
 *   - `REWARD_SOLD_OUT` offers §10.4's alternatives, and `RESERVATION_EXPIRED`
 *     is a recovery rather than a dead end
 *   - the confirmation says no card was charged, because §9.2 means it
 *   - the whole flow is reachable by keyboard
 *
 * The module is stubbed rather than `fetch`, which is what `DiscoveryView.test`
 * does and for the same reason: what this suite is about is the behaviour above
 * the client. That the request itself carries `Idempotency-Key` as a header, in
 * the shape the contract gives, is pinned in `lib/pledges/api.test.ts` against a
 * stubbed `fetch`.
 */

vi.mock('../../lib/pledges/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/pledges/api')>()),
  getPublicRewards: vi.fn(),
  createPledgeDraft: vi.fn(),
  payForPledge: vi.fn(),
}));

/*
 * The navigation, observed rather than attempted: jsdom implements none, and a test that failed
 * to leave silently would pass for the wrong reason. The return addresses stay real, because
 * what they say is part of what is under test.
 */
vi.mock('../../lib/pledges/payment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/pledges/payment')>()),
  leaveForPaymentPage: vi.fn(),
}));

const rewardsMock = vi.mocked(getPublicRewards);
const draftMock = vi.mocked(createPledgeDraft);
const payMock = vi.mocked(payForPledge);
const leaveMock = vi.mocked(leaveForPaymentPage);

/** What the service answers when it has opened the provider's page for `pledge-1`. */
const PAGE: PaymentPageResponse = {
  pledgeId: 'pledge-1',
  providerTransactionId: 'provider-transaction-1',
  redirectUrl: 'https://payments.test/page/provider-transaction-1',
};

/* -------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------- */

function money(amount: string) {
  return { amount, currency: 'AZN' };
}

/** Limited, posted, and priced to two countries. The tier most cases use. */
const MUG: PublicReward = {
  id: 'reward-mug',
  title: 'Enamel mug',
  description: 'One mug, fired by hand.',
  price: money('45.00'),
  estimatedDelivery: '2026-11-01',
  shippingType: 'DOMESTIC',
  limitQuantity: 100,
  remainingQuantity: 3,
  isEarlyBird: true,
  isFeatured: false,
  items: [{ name: 'Mug', quantity: 1, isDigital: false }],
  shippingRates: [
    { countryCode: 'AZ', amount: '5.00', additionalItemAmount: '2.00' },
    { countryCode: 'TR', amount: '9.00', additionalItemAmount: '3.00' },
  ],
};

/** Unlimited and digital: no counter at all, and no destination question. */
const ALBUM: PublicReward = {
  id: 'reward-album',
  title: 'Digital album',
  price: money('10.00'),
  shippingType: 'DIGITAL',
  limitQuantity: null,
  remainingQuantity: null,
  isEarlyBird: false,
  isFeatured: false,
  items: [],
  shippingRates: [],
};

const SOLD_OUT: PublicReward = {
  id: 'reward-badge',
  title: 'Founder badge',
  price: money('20.00'),
  shippingType: 'NONE',
  limitQuantity: 50,
  remainingQuantity: 0,
  isEarlyBird: false,
  isFeatured: false,
  items: [],
  shippingRates: [],
};

/** Posted, and priced to ONE of the two countries the mug is priced to. */
const STICKERS: PublicReward = {
  id: 'addon-stickers',
  title: 'Sticker pack',
  price: money('8.50'),
  shippingType: 'DOMESTIC',
  limitQuantity: null,
  remainingQuantity: null,
  isEarlyBird: false,
  isFeatured: false,
  items: [],
  shippingRates: [{ countryCode: 'AZ', amount: '2.00', additionalItemAmount: '1.00' }],
};

const TRACK: PublicReward = {
  id: 'addon-track',
  title: 'Bonus track',
  price: money('4.25'),
  shippingType: 'DIGITAL',
  limitQuantity: null,
  remainingQuantity: null,
  isEarlyBird: false,
  isFeatured: false,
  items: [],
  shippingRates: [],
};

function draft(overrides: Partial<PledgeResponse> = {}): PledgeResponse {
  return {
    id: 'pledge-1',
    projectId: 'project-1',
    state: 'DRAFT',
    rewardTierId: MUG.id,
    addons: [],
    amounts: {
      base: money('45.00'),
      addons: money('0.00'),
      bonus: money('0.00'),
      shipping: money('5.00'),
      tax: money('0.00'),
      total: money('50.00'),
    },
    shippingCountry: 'AZ',
    isAnonymous: false,
    // Well into the future, so the countdown is running rather than expired.
    reservationExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    // What the service sends on every pledge this build can make: no payment
    // method, and no card verified. Both are overridden in the two cases that
    // exist to prove the screen reads them rather than asserting them.
    paymentMethodId: null,
    cardVerified: false,
    // Both always present on the wire — `latePledge` is a primitive on the record and
    // `supplements` is a list — and both added to the type by #287, which reads them on the
    // pledge manager. False and empty is what the service sends for a pledge made at checkout.
    latePledge: false,
    supplements: [],
    ...overrides,
  };
}

function summary(): HTMLElement {
  return screen.getByRole('complementary', { name: 'Pledge summary' });
}

/**
 * The figure on the total row.
 *
 * Read from beside the word rather than by searching the panel for the string:
 * a total that happens to equal one of the lines above it — a pledge with no
 * add-ons, no bonus and no delivery — would otherwise match twice and the
 * assertion would be about whichever came first.
 */
function total(): string {
  return within(summary()).getByText('Total').nextElementSibling?.textContent ?? '';
}

/** The key the nth draft request carried. */
function draftKey(call: number): string | undefined {
  return draftMock.mock.calls[call]?.[1];
}

async function open(
  initialRewardId: string | null = null,
  backerAgreementVersion: number | null = null,
): Promise<UserEvent> {
  const user = userEvent.setup();
  render(
    <CheckoutView
      projectId="project-1"
      copy={COPY}
      initialRewardId={initialRewardId}
      backerAgreementVersion={backerAgreementVersion}
    />,
  );
  await screen.findByRole('radio', { name: /Pledge without a reward/ });
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  rewardsMock.mockResolvedValue({
    currency: 'AZN',
    rewards: [MUG, ALBUM, SOLD_OUT],
    addons: [STICKERS, TRACK],
  });
  draftMock.mockResolvedValue(draft());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------
 * Choosing a reward — PL-01, PL-02, PL-15
 * ---------------------------------------------------------------------- */

describe('choosing a reward', () => {
  it('shows the tiers with their stock, and no counter where there is no limit', async () => {
    await open();

    expect(screen.getByRole('radio', { name: /Enamel mug/ })).toBeInTheDocument();
    expect(screen.getByText('3 of 100 left')).toBeInTheDocument();

    // `limitQuantity: null` shows NO counter at all — not "unlimited", which
    // would start a scarcity conversation the campaign did not start.
    const album = screen.getByRole('radio', { name: /Digital album/ });
    expect(album).toHaveAccessibleName(expect.not.stringContaining('left') as unknown as string);
  });

  it('fills the contribution with the tier price and totals it', async () => {
    const user = await open();

    await user.click(screen.getByRole('radio', { name: /Enamel mug/ }));

    // PL-03's floor: the field starts AT the price, and a bonus is what goes
    // above it.
    expect(screen.getByLabelText(/Your contribution/)).toHaveValue('45.00');

    // The mug is posted, so there is nothing honest to total until the backer
    // has said where it is going — the panel says so rather than quoting a
    // delivery of zero.
    expect(within(summary()).getByText(/The total appears once/)).toBeInTheDocument();

    await user.selectOptions(await screen.findByLabelText(/Where should this go/), 'AZ');

    expect(within(summary()).getByText('Reward')).toBeInTheDocument();
    expect(total()).toBe('50.00 AZN');
  });

  /*
   * `?reward=` — arriving from the campaign page's per-tier control.
   *
   * The identifier is a SEED and never a commitment: it reserves nothing, it prices nothing,
   * and every one of these cases ends somewhere the backer can still change their mind. The
   * three failures worth pinning are all "the link is older than the catalogue".
   */
  it('starts on the tier the campaign page named, priced as if it had been clicked', async () => {
    await open(MUG.id);

    await waitFor(() => expect(screen.getByRole('radio', { name: /Enamel mug/ })).toBeChecked());

    // Through `chooseReward`, so PL-03's floor is applied exactly as it is for a click. A
    // seeded choice with an empty contribution is refused by the service.
    expect(screen.getByLabelText(/Your contribution/)).toHaveValue('45.00');
  });

  it('leaves the seeded tier changeable, because it is a suggestion and not a lock', async () => {
    const user = await open(MUG.id);

    await waitFor(() => expect(screen.getByRole('radio', { name: /Enamel mug/ })).toBeChecked());
    await user.click(screen.getByRole('radio', { name: /Digital album/ }));

    expect(screen.getByRole('radio', { name: /Enamel mug/ })).not.toBeChecked();
    expect(screen.getByLabelText(/Your contribution/)).toHaveValue('10.00');
  });

  /**
   * A tier the creator withdrew after the link was shared. The reader gets the ordinary empty
   * form rather than a refusal about a tier they never saw.
   */
  it('ignores an identifier that names no tier', async () => {
    await open('reward-that-was-withdrawn');

    for (const name of [/Enamel mug/, /Digital album/, /Pledge without a reward/]) {
      expect(screen.getByRole('radio', { name })).not.toBeChecked();
    }
  });

  /**
   * Sold out between the campaign page and this one. Seeding it would open the checkout on a
   * selection whose only possible next step is `REWARD_SOLD_OUT`.
   */
  it('ignores a tier that has sold out since the link was made', async () => {
    await open(SOLD_OUT.id);

    const badge = screen.getByRole('radio', { name: /Founder badge/ });
    expect(badge).not.toBeChecked();
    expect(badge).toBeDisabled();
  });

  it('shows a sold-out tier and refuses to let it be chosen', async () => {
    await open();

    const badge = screen.getByRole('radio', { name: /Founder badge/ });
    // Shown, so a backer who came from the campaign page can see what happened
    // to it — and inert, so no route through the interface can select it.
    expect(badge).toBeDisabled();
    expect(screen.getByText('Sold out')).toBeInTheDocument();
  });

  it('takes a pledge with no reward at all (PL-02)', async () => {
    const user = await open();

    await user.click(screen.getByRole('radio', { name: /Pledge without a reward/ }));
    await user.type(screen.getByLabelText(/How much would you like to give/), '12.50');

    expect(total()).toBe('12.50 AZN');
    // The whole of a support-only pledge is its base, and none of it is a bonus.
    expect(within(summary()).getByText('Your support')).toBeInTheDocument();
    expect(within(summary()).queryByText('Bonus support')).not.toBeInTheDocument();
  });

  it('refuses a contribution below the tier price, and says what to do', async () => {
    const user = await open();

    await user.click(screen.getByRole('radio', { name: /Enamel mug/ }));
    const field = screen.getByLabelText(/Your contribution/);
    await user.clear(field);
    await user.type(field, '20.00');

    expect(
      await screen.findByText(/This reward costs 45\.00 AZN\. Give that or more/),
    ).toBeInTheDocument();
  });

  it('refuses an amount typed with a comma, in the wording this field needs', async () => {
    const user = await open();

    await user.click(screen.getByRole('radio', { name: /Pledge without a reward/ }));
    await user.type(screen.getByLabelText(/How much would you like to give/), '45,50');

    expect(await screen.findByText(/Use a full stop for the decimal point/)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------
 * Add-ons — PL-04
 * ---------------------------------------------------------------------- */

describe('add-ons', () => {
  it('multiplies the quantity and adds it to the total', async () => {
    const user = await open();

    await user.click(screen.getByRole('radio', { name: /Digital album/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: /Bonus track/ }), '4');

    // 10.00 + 4.25 × 4 = 27.00. A `double` reads 4.25 exactly, so this case is
    // about the summing rather than the representation — `quote.test.ts` holds
    // the one a double gets wrong.
    expect(within(summary()).getByText('17.00 AZN')).toBeInTheDocument();
    expect(total()).toBe('27.00 AZN');
  });
});

/* -------------------------------------------------------------------------
 * Shipping — PL-05
 * ---------------------------------------------------------------------- */

describe('the destination', () => {
  it('is not asked for when nothing in the pledge is posted', async () => {
    const user = await open();

    await user.click(screen.getByRole('radio', { name: /Digital album/ }));

    // Asking for a postal address in order to deliver a download is the visible
    // half of a shipping model that has not understood what it is charging for.
    expect(screen.queryByLabelText(/Where should this go/)).not.toBeInTheDocument();
  });

  it('is asked for as soon as something is', async () => {
    const user = await open();

    await user.click(screen.getByRole('radio', { name: /Enamel mug/ }));

    expect(await screen.findByLabelText(/Where should this go/)).toBeInTheDocument();
  });

  it('is asked for when an add-on is posted although the reward is not', async () => {
    const user = await open();

    await user.click(screen.getByRole('radio', { name: /Digital album/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: /Sticker pack/ }), '1');

    expect(await screen.findByLabelText(/Where should this go/)).toBeInTheDocument();
  });

  it('charges the rate for the destination chosen', async () => {
    const user = await open();

    await user.click(screen.getByRole('radio', { name: /Enamel mug/ }));
    await user.selectOptions(await screen.findByLabelText(/Where should this go/), 'AZ');

    expect(within(summary()).getByText('Delivery')).toBeInTheDocument();
    expect(within(summary()).getByText('5.00 AZN')).toBeInTheDocument();
    expect(total()).toBe('50.00 AZN');
  });

  it('refuses a destination the creator has not priced, naming the line that refuses it', async () => {
    const user = await open();

    await user.click(screen.getByRole('radio', { name: /Enamel mug/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: /Sticker pack/ }), '1');
    // Turkey is priced for the mug and not for the stickers, so it is offered
    // and then explained rather than silently missing from the list.
    await user.selectOptions(await screen.findByLabelText(/Where should this go/), 'TR');

    expect(
      await screen.findByText(/has not set a delivery cost to this destination for Sticker pack/),
    ).toBeInTheDocument();
    // And nothing is quoted at zero, which would have the creator paying the
    // carrier out of their own funding.
    expect(within(summary()).queryByText('Total')).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------
 * Reserving — PL-13, PL-14
 * ---------------------------------------------------------------------- */

async function reserveTheMug(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('radio', { name: /Enamel mug/ }));
  await user.selectOptions(await screen.findByLabelText(/Where should this go/), 'AZ');
  await user.click(screen.getByRole('button', { name: 'Reserve and review' }));
}

describe('reserving', () => {
  it('sends the selection, with the destination and the anonymity flag', async () => {
    const user = await open();

    await user.click(screen.getByRole('checkbox', { name: /Pledge anonymously/ }));
    await reserveTheMug(user);

    await waitFor(() => expect(draftMock).toHaveBeenCalledTimes(1));
    expect(draftMock.mock.calls[0]?.[0]).toEqual({
      projectId: 'project-1',
      rewardTierId: MUG.id,
      addons: [],
      contribution: money('45.00'),
      shippingCountry: 'AZ',
      isAnonymous: true,
      referrerCode: null,
    });
  });

  it('sends no destination for a pledge that posts nothing', async () => {
    const user = await open();

    await user.click(screen.getByRole('radio', { name: /Digital album/ }));
    await user.click(screen.getByRole('button', { name: 'Reserve and review' }));

    await waitFor(() => expect(draftMock).toHaveBeenCalledTimes(1));
    expect(draftMock.mock.calls[0]?.[0]?.shippingCountry).toBeNull();
  });

  it('KEEPS THE SAME IDEMPOTENCY KEY WHEN A FAILED ATTEMPT IS RETRIED', async () => {
    /*
     * The failure this is about: the request reached the server, the pledge was
     * written, and the response was lost on the way back. A fresh key on the
     * retry makes that a second pledge; the same key makes it the first one,
     * answered from the server's record.
     */
    draftMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const user = await open();

    await reserveTheMug(user);
    await screen.findByText(/The service could not be reached/);

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(draftMock).toHaveBeenCalledTimes(2));
    expect(draftKey(0)).toBeTruthy();
    expect(draftKey(1)).toBe(draftKey(0));
  });

  it('mints a different key once the selection has changed', async () => {
    draftMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const user = await open();

    await reserveTheMug(user);
    await screen.findByText(/The service could not be reached/);

    // A changed body is a different intent, and reusing the key would be
    // answered `409 IDEMPOTENCY_KEY_REUSED`.
    await user.click(screen.getByRole('radio', { name: /Digital album/ }));
    await user.click(screen.getByRole('button', { name: 'Reserve and review' }));

    await waitFor(() => expect(draftMock).toHaveBeenCalledTimes(2));
    expect(draftKey(1)).not.toBe(draftKey(0));
  });

  it('keeps the key when the backer goes back and changes nothing', async () => {
    const user = await open();
    await reserveTheMug(user);

    await user.click(await screen.findByRole('button', { name: 'Change what I chose' }));
    await user.click(screen.getByRole('button', { name: 'Reserve and review' }));

    await waitFor(() => expect(draftMock).toHaveBeenCalledTimes(2));
    /*
     * The reservation is still running. Replaying the key gives back the SAME
     * pledge with the SAME clock; a new key would hold a second lot of stock on
     * a campaign whose unique index allows this backer one.
     */
    expect(draftKey(1)).toBe(draftKey(0));
  });

  it('shows the server amounts once it has them, not its own preview', async () => {
    // The service quotes against the row it is reserving, inside the
    // transaction that reserves it. Its numbers replace the client's outright.
    draftMock.mockResolvedValue(
      draft({
        amounts: {
          base: money('45.00'),
          addons: money('0.00'),
          bonus: money('0.00'),
          shipping: money('7.50'),
          tax: money('0.00'),
          total: money('52.50'),
        },
      }),
    );

    const user = await open();
    await reserveTheMug(user);

    await waitFor(() => expect(total()).toBe('52.50 AZN'));
    expect(within(summary()).queryByText('50.00 AZN')).not.toBeInTheDocument();
    expect(
      within(summary()).getByText(/Confirmed by the campaign when it reserved your reward/),
    ).toBeInTheDocument();
  });

  it('shows how long the reward is held for', async () => {
    const user = await open();
    await reserveTheMug(user);

    expect(await screen.findByText(/Your reward is held for/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeEnabled();
  });

  it('offers a new reservation once the hold has run out', async () => {
    // A deadline already in the past, which is what a backer who left the tab
    // open comes back to.
    draftMock.mockResolvedValue(
      draft({ reservationExpiresAt: new Date(Date.now() - 1000).toISOString() }),
    );

    const user = await open();
    await reserveTheMug(user);

    expect(await screen.findByText(/Your reward is no longer held/)).toBeInTheDocument();
    // Confirming an expired reservation would be refused; the interface does not
    // offer it as though it might work.
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reserve again' })).toBeEnabled();
  });
});

/* -------------------------------------------------------------------------
 * Refusals — §10.4
 * ---------------------------------------------------------------------- */

function refusal(code: string, status: number, meta?: Record<string, unknown>): ApiError {
  return new ApiError(status, { code, status, title: 'Refused', meta });
}

/**
 * `409 IDEMPOTENT_REQUEST_IN_PROGRESS`, as the service sends it.
 *
 * `retryAfterSeconds` is the mirror of the `Retry-After` header that
 * `ApiExceptionHandler` sets on this refusal and this one only; `errorFrom`
 * prefers the header and falls back to this, so a client that reads the problem
 * gets the same number either way.
 */
function inProgress(retryAfterSeconds = 1): ApiError {
  return new ApiError(409, {
    code: 'IDEMPOTENT_REQUEST_IN_PROGRESS',
    status: 409,
    title: 'Request already in progress',
    retryAfterSeconds,
  });
}

describe('a refusal', () => {
  it('offers the alternatives the service named for a sold-out tier', async () => {
    draftMock.mockRejectedValue(
      refusal('REWARD_SOLD_OUT', 409, {
        rewardTierId: MUG.id,
        availableAlternatives: [ALBUM.id, SOLD_OUT.id],
      }),
    );

    const user = await open();
    await reserveTheMug(user);

    expect(await screen.findByText('That reward has just gone')).toBeInTheDocument();

    // The alternatives are resolved to titles a backer can act on, and the one
    // that is itself sold out is not offered however loudly it was suggested.
    const alternative = screen.getByRole('button', { name: /Digital album/ });
    expect(screen.queryByRole('button', { name: /Founder badge/ })).not.toBeInTheDocument();

    await user.click(alternative);
    expect(screen.getByRole('radio', { name: /Digital album/ })).toBeChecked();
  });

  it('makes an expired reservation recoverable, with a new key', async () => {
    const user = await open();
    await reserveTheMug(user);
    await screen.findByRole('button', { name: 'Continue to payment' });

    payMock.mockRejectedValue(refusal('RESERVATION_EXPIRED', 409));
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));

    expect(await screen.findByText('Your reward was only held for five minutes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reserve again' }));
    await waitFor(() => expect(draftMock).toHaveBeenCalledTimes(2));

    /*
     * A NEW KEY, and this is the subtle half of idempotency. The body is
     * identical to the one that produced the expired draft, so replaying its key
     * would hand back the very draft that just expired and the screen would
     * loop. A new reservation after an expiry is a new intent.
     */
    expect(draftKey(1)).not.toBe(draftKey(0));
  });

  it('does not pretend a pledge that already exists can be made again', async () => {
    draftMock.mockRejectedValue(refusal('PLEDGE_ALREADY_EXISTS', 409));

    const user = await open();
    await reserveTheMug(user);

    expect(await screen.findByText('You are already backing this campaign')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  /*
   * The two below cannot happen while `lib/pledges/idempotency.ts` sends a
   * `crypto.randomUUID()` on every mutation, which is exactly why they are
   * asserted: if one of them ever reaches a backer it is because a change to
   * this application stopped it doing that, and the screen has to say so rather
   * than blame the service with "that did not work — try again".
   */
  it.each([
    ['IDEMPOTENCY_KEY_REQUIRED', 'This page sent an incomplete request'],
    ['IDEMPOTENCY_KEY_INVALID', 'This page sent a malformed request'],
  ])('reports %s as a fault in this page rather than as a refusal', async (code, title) => {
    draftMock.mockRejectedValue(refusal(code, 400));

    const user = await open();
    await reserveTheMug(user);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(title)).toBeInTheDocument();
    expect(within(alert).getByText(/a fault in this site rather than anything you did/)).toBeInTheDocument();

    // NOT the generic fallback, which would offer a retry that is certain to
    // fail in exactly the same way — the header will be missing or malformed
    // again, because the client is what is wrong.
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByText(/did not say why/)).not.toBeInTheDocument();
    // Nothing was reserved, so nothing moved on from the form.
    expect(screen.queryByRole('button', { name: 'Continue to payment' })).not.toBeInTheDocument();
  });

  it('recovers from a pledge that was changed underneath the confirmation', async () => {
    const user = await open();
    await reserveTheMug(user);
    await screen.findByRole('button', { name: 'Continue to payment' });

    /*
     * §8.4's sweep expiring the draft in the moment its backer confirms it. The
     * service will not report a cause it has inferred rather than observed, so
     * this arrives as `PLEDGE_MODIFIED` and not as `RESERVATION_EXPIRED` — and
     * it is a recovery either way rather than a dead end.
     */
    payMock.mockRejectedValue(refusal('PLEDGE_MODIFIED', 409));
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));

    expect(
      await screen.findByText('This pledge changed while you were confirming it'),
    ).toBeInTheDocument();
    // And it does not claim a card was involved, because none was.
    expect(screen.getByText(/no card was involved/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reserve again' }));
    await waitFor(() => expect(draftMock).toHaveBeenCalledTimes(2));

    // A NEW key: this client's copy of the pledge is stale, so the second
    // reservation is a new intent rather than a replay that would hand back the
    // draft something else has already written to.
    expect(draftKey(1)).not.toBe(draftKey(0));
  });
});

/* -------------------------------------------------------------------------
 * A request that is already running — IDEMPOTENT_REQUEST_IN_PROGRESS
 *
 * What a double-click produces: the first request still holds the claim on the
 * key and the second is told to ask again. The backer can do nothing about it
 * and their pledge is already being made, so the checkout waits and asks again
 * itself — with the same key, which is the whole point.
 * ---------------------------------------------------------------------- */

describe('a request whose first attempt is still running', () => {
  /** Lets pending promises settle, and a `Retry-After` elapse when asked. */
  async function tick(ms = 1): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  beforeEach(() => {
    /*
     * `shouldAdvanceTime` lets real time drive the fake clock, which is what
     * makes `userEvent` usable at all here: its async wrapper waits on a
     * macrotask that a frozen clock never reaches. The waits under test are
     * seconds long, so they still need `tick` to elapse.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function openWithTimers(): Promise<UserEvent> {
    const user = userEvent.setup({ advanceTimers: (ms) => void vi.advanceTimersByTime(ms) });
    render(<CheckoutView projectId="project-1" copy={COPY} />);
    await tick();
    return user;
  }

  it('WAITS THE TIME IT WAS TOLD TO AND RETRIES WITH THE SAME KEY', async () => {
    draftMock.mockRejectedValueOnce(inProgress(2)).mockResolvedValue(draft());

    const user = await openWithTimers();
    await reserveTheMug(user);

    // Nothing yet: retrying immediately earns the same refusal, because the
    // request it collided with is still running.
    expect(draftMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await tick(2000);

    expect(draftMock).toHaveBeenCalledTimes(2);
    /*
     * THE SAME KEY. A fresh one would make the retry a second pledge on a
     * campaign that allows this backer one — which is the exact failure the
     * mechanism exists to prevent, and the reason the key belongs to the intent
     * rather than to the attempt.
     */
    expect(draftKey(0)).toBeTruthy();
    expect(draftKey(1)).toBe(draftKey(0));

    // And it succeeded, so the backer never saw the collision at all.
    expect(await screen.findByRole('button', { name: 'Continue to payment' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('waits no longer than five seconds however long it is asked to', async () => {
    draftMock.mockRejectedValueOnce(inProgress(3600)).mockResolvedValue(draft());

    const user = await openWithTimers();
    await reserveTheMug(user);

    await tick(4000);
    expect(draftMock).toHaveBeenCalledTimes(1);

    // An hour of "Reserving…" is a page somebody reloads, and a reload is the
    // one thing that loses the in-memory key.
    await tick(1000);
    expect(draftMock).toHaveBeenCalledTimes(2);
    expect(draftKey(1)).toBe(draftKey(0));
  });

  it('gives up after a bounded number of attempts rather than looping', async () => {
    draftMock.mockRejectedValue(inProgress(1));

    const user = await openWithTimers();
    await reserveTheMug(user);
    await tick(60_000);

    // Four: the first attempt and three retries. A client that kept asking
    // would keep asking for as long as the first attempt is stuck, which is
    // when asking helps least.
    expect(draftMock).toHaveBeenCalledTimes(4);
    expect(draftKey(3)).toBe(draftKey(0));

    // Now it is the backer's decision, and the message says what happened
    // rather than reporting a generic failure for something about to succeed.
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Your first attempt is still going')).toBeInTheDocument();
    expect(within(alert).getByText(/Nothing has been pledged twice/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('does the same for the payment, and retries the payment rather than the draft', async () => {
    const user = await openWithTimers();
    await reserveTheMug(user);
    await screen.findByRole('button', { name: 'Continue to payment' });

    payMock
      .mockRejectedValueOnce(inProgress(2))
      .mockResolvedValue(PAGE);

    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(payMock).toHaveBeenCalledTimes(1);

    await tick(2000);

    expect(payMock).toHaveBeenCalledTimes(2);
    // The payment intent's key, unchanged — and the draft was not sent again,
    // which would have been a second reservation for a pledge that already has
    // one.
    expect(payMock.mock.calls[1]?.[2]).toBe(payMock.mock.calls[0]?.[2]);
    expect(draftMock).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(leaveMock).toHaveBeenCalledWith(PAGE.redirectUrl));
  });
});

/* -------------------------------------------------------------------------
 * Payment and confirmation — PL-07, PL-08
 * ---------------------------------------------------------------------- */

describe('the payment step', () => {
  it('takes no card, and says where it is taken', async () => {
    const user = await open();
    await reserveTheMug(user);

    expect(await screen.findByText('You pay on the payment provider’s page')).toBeInTheDocument();
    // Not a disabled card form, not a placeholder that looks like one: nothing
    // on this page may teach somebody that a card number goes here (§17.2).
    expect(screen.queryByLabelText(/card number/i)).not.toBeInTheDocument();
    expect(document.querySelectorAll('input[autocomplete*="cc-"]')).toHaveLength(0);
  });
});

describe('the risk statement §22.3 requires inside the pledge flow', () => {
  it('is on the screen with the confirm control, and the control says what pressing it means', async () => {
    /*
     * ISSUE #427. §22.3 asks that "rewards are not guaranteed" be stated within the pledge
     * flow — not in the terms, not behind a link, not in a footer. The requirement is about
     * what a person saw, so this asserts the sentence is rendered on the step that has the
     * confirm button rather than that a link to it exists.
     */
    const user = await open(null, 3);
    await reserveTheMug(user);

    const risk = within(await screen.findByRole('region', { name: 'What backing means' }));
    expect(risk.getByText(/not a purchase/i)).toBeInTheDocument();
    expect(risk.getByText(/not guaranteed/i)).toBeInTheDocument();

    /*
     * And the acceptance is the confirm control's own label, which is the design #427 settled
     * on: one action rather than a tick beside a button. A separate checkbox is stronger
     * evidence and is also friction on the platform's most important conversion; a control
     * whose words say what pressing it means cannot be clicked past.
     */
    expect(screen.getByRole('button', { name: 'I understand — continue to payment' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue to payment' })).not.toBeInTheDocument();
  });

  it('sends the version it showed, so a stale page is refused rather than recorded', async () => {
    payMock.mockResolvedValue(PAGE);

    const user = await open(null, 3);
    await reserveTheMug(user);
    await user.click(await screen.findByRole('button', { name: 'I understand — continue to payment' }));

    await waitFor(() => expect(leaveMock).toHaveBeenCalledWith(PAGE.redirectUrl));
    // The number, not a boolean. A boolean would say "the client ticked something"; what has
    // to be recorded is which sentence the person read.
    expect(payMock.mock.calls[0]?.[1]).toMatchObject({ acknowledgedAgreementVersion: 3 });
  });

  it('is absent, and asks for nothing, while no agreement is published', async () => {
    /*
     * The state of this platform until #439 seeds the words. The service treats an
     * unpublished agreement as no requirement, and a statement the confirmation does not
     * record would be decoration on the one screen where decoration costs the most.
     */
    const user = await open();
    await reserveTheMug(user);

    await screen.findByRole('button', { name: 'Continue to payment' });
    expect(screen.queryByRole('region', { name: 'What backing means' })).not.toBeInTheDocument();
  });
});

describe('paying', () => {
  it('opens the provider’s page and leaves for it, and claims nothing was paid', async () => {
    payMock.mockResolvedValue(PAGE);

    const user = await open();
    await reserveTheMug(user);
    await user.click(await screen.findByRole('button', { name: 'Continue to payment' }));

    await waitFor(() => expect(leaveMock).toHaveBeenCalledWith(PAGE.redirectUrl));
    // IDN-EXT-01 (#44): the provider returns the backer to the pledge's own page, in the
    // language the checkout was read in, and says which door they came through.
    const page = `${window.location.origin}/en/pledges/pledge-1`;
    expect(payMock.mock.calls[0]?.[1]).toEqual({
      // #427: null because no backer agreement is published in this fixture.
      acknowledgedAgreementVersion: null,
      language: 'en',
      successUrl: `${page}?payment=returned`,
      errorUrl: `${page}?payment=failed`,
    });
    // Its own key, not the draft's.
    expect(payMock.mock.calls[0]?.[2]).toBeTruthy();
    expect(payMock.mock.calls[0]?.[2]).not.toBe(draftKey(0));

    // Nothing is settled on this screen, so nothing here says it is.
    expect(screen.queryByText(/thank you for your payment/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/is paid/i)).not.toBeInTheDocument();
    // And the control cannot open a second page while the browser is on its way.
    expect(screen.queryByRole('button', { name: 'Continue to payment' })).not.toBeInTheDocument();
  });

  it('states the rule and where the charge happens before the control, and takes no card', async () => {
    const user = await open();
    await reserveTheMug(user);
    await screen.findByRole('button', { name: 'Continue to payment' });

    expect(screen.getByText(COPY.review.rule)).toBeInTheDocument();
    expect(screen.getByText(COPY.review.charged)).toBeInTheDocument();
    expect(screen.queryByLabelText(/card number/i)).not.toBeInTheDocument();
  });

  it('stays on the review step, with nothing opened, when the service refuses', async () => {
    payMock.mockRejectedValue(refusal('RESERVATION_EXPIRED', 409));

    const user = await open();
    await reserveTheMug(user);
    await user.click(await screen.findByRole('button', { name: 'Continue to payment' }));

    expect(await screen.findByText('Your reward was only held for five minutes')).toBeInTheDocument();
    expect(leaveMock).not.toHaveBeenCalled();
  });

  it('announces leaving politely rather than stealing focus to a toast', async () => {
    payMock.mockResolvedValue(PAGE);

    const user = await open();
    await reserveTheMug(user);
    await user.click(await screen.findByRole('button', { name: 'Continue to payment' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    await waitFor(() => expect(status).toHaveTextContent(COPY.review.confirming));
  });
});

/* -------------------------------------------------------------------------
 * Keyboard
 * ---------------------------------------------------------------------- */

describe('by keyboard alone', () => {
  it('reaches every control of the first step, and never the sold-out tier', async () => {
    const user = await open();

    /*
     * A native radio group is ONE tab stop and the arrow keys move within it,
     * which is exactly why `RadioGroup` does not reimplement any of that. So the
     * tier is chosen with an arrow rather than a Tab, and the rest of the form —
     * which only exists once something is chosen — is walked from there.
     */
    await user.tab();
    expect(screen.getByRole('radio', { name: /Pledge without a reward/ })).toHaveFocus();
    await user.keyboard('{ArrowDown}');

    const reached = new Set<Element>();
    for (let press = 0; press < 20; press += 1) {
      await user.tab();
      if (document.activeElement !== null) reached.add(document.activeElement);
    }

    expect(reached.has(screen.getByLabelText(/Your contribution/))).toBe(true);
    expect(reached.has(screen.getByRole('combobox', { name: /Sticker pack/ }))).toBe(true);
    expect(reached.has(screen.getByRole('checkbox', { name: /Pledge anonymously/ }))).toBe(true);
    expect(reached.has(screen.getByRole('button', { name: 'Reserve and review' }))).toBe(true);

    // The sold-out tier is `disabled`, so nothing can put focus on it.
    expect(reached.has(screen.getByRole('radio', { name: /Founder badge/ }))).toBe(false);
  });

  it('completes the flow from the keyboard', async () => {
    payMock.mockResolvedValue(PAGE);
    const user = await open();

    // Reach the group, choose within it with an arrow key, and drive the rest
    // with Enter — no pointer anywhere.
    await user.tab();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: /Enamel mug/ })).toBeChecked();

    await user.selectOptions(await screen.findByLabelText(/Where should this go/), 'AZ');

    screen.getByRole('button', { name: 'Reserve and review' }).focus();
    await user.keyboard('{Enter}');

    payMock.mockResolvedValue(PAGE);
    const payButton = await screen.findByRole('button', { name: 'Continue to payment' });
    payButton.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(leaveMock).toHaveBeenCalledWith(PAGE.redirectUrl));
  });

  it('moves focus to the heading when the step changes', async () => {
    const user = await open();
    await reserveTheMug(user);

    // Without this the backer's focus is left on a button that no longer exists,
    // which drops them at the top of the document with nothing announced.
    const heading = await screen.findByRole('heading', { level: 1, name: 'Review and confirm' });
    await waitFor(() => expect(heading).toHaveFocus());
  });
});

describe('accessibility', () => {
  /**
   * #129. Both steps, because they are two different trees: the choosing step is a radio
   * group, a select and two checkboxes, and the review step replaces all of it. A pass over
   * only the first would be a pass over the half of the checkout that costs nothing to get
   * wrong.
   *
   * `src/test-axe.ts` says what this catches and what it cannot. Focus moving to the new
   * step's heading, and the fact that both steps are reachable with the keyboard alone, are
   * the two assertions above this one — neither is machine-checkable.
   */
  it('has no automatically detectable violation while choosing', async () => {
    await open();

    await expectNoViolations(document.body);
  });

  it('has none on the review step either', async () => {
    const user = await open();
    await reserveTheMug(user);
    await screen.findByRole('heading', { level: 1, name: 'Review and confirm' });

    await expectNoViolations(document.body);
  });
});
