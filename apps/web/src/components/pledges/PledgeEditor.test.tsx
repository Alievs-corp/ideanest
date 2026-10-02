import Decimal from 'decimal.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { changesFrom, PledgeEditor, type Draft } from './PledgeEditor';
import { NO_REWARD } from '../checkout/useCheckout';
import { editPledge, getPublicRewards, type PledgeResponse } from '../../lib/pledges/api';
import { checkoutCopyFrom } from '../../lib/i18n/checkout-copy';
import { pledgeManagerCopyFrom } from '../../lib/i18n/pledges-copy';
import { translatorFor } from '../../test-copy';

vi.mock('../../lib/pledges/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/pledges/api')>()),
  getPublicRewards: vi.fn(),
  editPledge: vi.fn(),
}));

/* The words the page resolves, built from the catalogue with the same builders (#131). */
const CHECKOUT = checkoutCopyFrom(translatorFor('checkout'));
const EDITOR = pledgeManagerCopyFrom(translatorFor('account.pledges')).editor;

/**
 * The Merge-Patch body §4.5's PL-09 edit sends — issue #287.
 *
 * <h2>Why this is tested without rendering anything</h2>
 *
 * CLAUDE.md §3 makes money arithmetic, state transitions and idempotency non-optional to test,
 * and this function is where all three meet. The failure it guards against is silent and
 * expensive: `PATCH /v1/pledges/{id}` reads **absent as "keep" and null as "clear"**, so a
 * body that carried every field would strip the reward off a pledge whose backer only raised
 * their contribution — and the screen would show the service's honest answer for a pledge
 * nobody meant to change. Nothing about that is visible in a screenshot.
 *
 * The second thing it decides is the idempotency key, which is derived from a canonical
 * serialisation of this body (`lib/pledges/idempotency.ts`). A field that appears in the body
 * when it did not change makes two identical saves two different intents.
 */

function pledge(overrides: Partial<PledgeResponse> = {}): PledgeResponse {
  return {
    id: 'pledge-1',
    projectId: 'project-1',
    state: 'CONFIRMED',
    rewardTierId: 'tier-mug',
    addons: [{ rewardTierId: 'addon-track', quantity: 2 }],
    amounts: {
      base: { amount: '45.00', currency: 'AZN' },
      addons: { amount: '8.50', currency: 'AZN' },
      bonus: { amount: '5.00', currency: 'AZN' },
      shipping: { amount: '2.00', currency: 'AZN' },
      tax: { amount: '0.00', currency: 'AZN' },
      total: { amount: '60.50', currency: 'AZN' },
    },
    shippingCountry: 'AZ',
    isAnonymous: false,
    reservationExpiresAt: null,
    confirmedAt: '2026-01-01T00:00:00Z',
    canceledAt: null,
    paymentMethodId: null,
    cardVerified: false,
    latePledge: false,
    supplements: [],
    ...overrides,
  };
}

/** The form as it looks the instant it is seeded from the pledge above. */
function untouched(): Draft {
  return {
    choice: 'tier-mug',
    // base + bonus, which is what a backer chose to give (PL-03).
    contributionText: '50.00',
    addons: [{ rewardTierId: 'addon-track', quantity: 2 }],
    destination: 'AZ',
    isAnonymous: false,
  };
}

describe('a form nobody has touched', () => {
  it('produces an empty body, so the save button has nothing to send', () => {
    expect(changesFrom(pledge(), untouched(), new Decimal('50.00'))).toEqual({});
  });

  it('is unmoved by a reordered add-on list, which is a spelling and not a change', () => {
    const draft: Draft = {
      ...untouched(),
      addons: [
        { rewardTierId: 'addon-track', quantity: 2 },
      ],
    };

    expect(changesFrom(pledge(), draft, new Decimal('50.00'))).toEqual({});
  });

  it('is unmoved by a differently written but equal amount', () => {
    // `50` and `50.00` are the same money. A body containing a contribution that did not change
    // would spend a fresh idempotency key on a request that changes nothing.
    expect(changesFrom(pledge(), untouched(), new Decimal('50'))).toEqual({});
  });
});

describe('changing one thing', () => {
  it('sends only the contribution, and never the reward with it', () => {
    const edit = changesFrom(pledge(), untouched(), new Decimal('75.00'));

    expect(edit).toEqual({ contribution: { amount: '75.00', currency: 'AZN' } });
    // THE POINT OF THE WHOLE FUNCTION: `rewardTierId` is ABSENT, not null. Present-and-null
    // would give up the reward on a pledge whose backer only raised what they were giving.
    expect(Object.hasOwn(edit, 'rewardTierId')).toBe(false);
  });

  it('sends a null reward when the backer gives it up, because absent would keep it', () => {
    const edit = changesFrom(
      pledge(),
      { ...untouched(), choice: NO_REWARD },
      new Decimal('50.00'),
    );

    expect(edit.rewardTierId).toBeNull();
    expect(Object.hasOwn(edit, 'rewardTierId')).toBe(true);
  });

  it('sends the whole add-on selection when it changes, because the field is replaced', () => {
    const edit = changesFrom(
      pledge(),
      { ...untouched(), addons: [{ rewardTierId: 'addon-track', quantity: 3 }] },
      new Decimal('50.00'),
    );

    expect(edit).toEqual({ addons: [{ rewardTierId: 'addon-track', quantity: 3 }] });
  });

  it('sends an empty list when every add-on is removed', () => {
    const edit = changesFrom(pledge(), { ...untouched(), addons: [] }, new Decimal('50.00'));

    expect(edit.addons).toEqual([]);
  });

  it('drops a zero quantity rather than sending it as a line', () => {
    const edit = changesFrom(
      pledge(),
      { ...untouched(), addons: [{ rewardTierId: 'addon-track', quantity: 0 }] },
      new Decimal('50.00'),
    );

    expect(edit.addons).toEqual([]);
  });

  it('clears the destination with null when the selection no longer ships', () => {
    const edit = changesFrom(pledge(), { ...untouched(), destination: null }, new Decimal('50.00'));

    expect(edit.shippingCountry).toBeNull();
  });

  it('sends the anonymity flag on its own', () => {
    const edit = changesFrom(
      pledge(),
      { ...untouched(), isAnonymous: true },
      new Decimal('50.00'),
    );

    expect(edit).toEqual({ isAnonymous: true });
  });
});

describe('the money', () => {
  it('is a string at the column’s scale, never a JavaScript number', () => {
    const edit = changesFrom(pledge(), untouched(), new Decimal('0.1').plus('0.2'));

    // 0.1 + 0.2 !== 0.3 in floating point, and on a funding platform that is somebody's
    // pledge. `decimal.js` gives the exact figure and `toWireAmount` fixes the scale.
    expect(edit.contribution).toEqual({ amount: '0.30', currency: 'AZN' });
    expect(typeof edit.contribution?.amount).toBe('string');
  });

  it('takes the currency from the pledge rather than assuming one', () => {
    const usd = pledge({
      amounts: {
        base: { amount: '45.00', currency: 'USD' },
        addons: { amount: '0.00', currency: 'USD' },
        bonus: { amount: '0.00', currency: 'USD' },
        shipping: { amount: '0.00', currency: 'USD' },
        tax: { amount: '0.00', currency: 'USD' },
        total: { amount: '45.00', currency: 'USD' },
      },
    });

    const edit = changesFrom(
      usd,
      { ...untouched(), contributionText: '60.00' },
      new Decimal('60.00'),
    );

    expect(edit.contribution?.currency).toBe('USD');
  });
});

/**
 * #131: what the editor tells a backer about money, drawn from the catalogue.
 *
 * The editor used to say "Nothing has been charged yet" and, after a save, that collection
 * "happens when the campaign closes successfully" — the retired model. What an edit actually
 * does is re-price the whole pledge, refuse to lower a confirmed one, and take no payment
 * (`ReservationService#edit` moves places and never charges). The assertions go through the
 * builder, so they are about the wiring; the last test holds the words themselves to the rule.
 */
describe('the editor’s account of the money', () => {
  const noReward = pledge({
    rewardTierId: null,
    addons: [],
    shippingCountry: null,
    amounts: {
      base: { amount: '50.00', currency: 'AZN' },
      addons: { amount: '0.00', currency: 'AZN' },
      bonus: { amount: '0.00', currency: 'AZN' },
      shipping: { amount: '0.00', currency: 'AZN' },
      tax: { amount: '0.00', currency: 'AZN' },
      total: { amount: '50.00', currency: 'AZN' },
    },
  });

  afterEach(cleanup);

  async function renderEditor(onSaved = vi.fn()) {
    vi.mocked(getPublicRewards).mockResolvedValue({ currency: 'AZN', rewards: [], addons: [] });
    render(<PledgeEditor copy={CHECKOUT} pledges={EDITOR} pledge={noReward} onSaved={onSaved} />);
    await screen.findByRole('heading', { name: EDITOR.heading });
  }

  it('introduces the form with the catalogue’s sentence', async () => {
    await renderEditor();

    expect(screen.getByText(EDITOR.intro)).toBeInTheDocument();
  });

  it('confirms a save with the catalogue’s sentence', async () => {
    const saved = pledge({ ...noReward, amounts: { ...noReward.amounts, total: { amount: '75.00', currency: 'AZN' } } });
    vi.mocked(editPledge).mockResolvedValue(saved);
    const user = userEvent.setup();
    await renderEditor();

    const field = screen.getByLabelText(CHECKOUT.contribution.legendNoReward, { exact: false });
    await user.clear(field);
    await user.type(field, '75.00');
    await user.click(screen.getByRole('button', { name: EDITOR.save }));

    expect(await screen.findByText(EDITOR.savedBody)).toBeInTheDocument();
    expect(screen.getByText(EDITOR.savedTitle)).toBeInTheDocument();
  });

  /*
   * The anonymity box read `event.currentTarget.checked` inside the state updater, which React
   * may run after the event is released and `currentTarget` is null — the crash the contribution
   * field already had fixed. Ticking it and saving is the whole path.
   */
  it('sends the anonymity box as ticked, without losing the event on the way', async () => {
    vi.mocked(editPledge).mockResolvedValue(pledge({ ...noReward, isAnonymous: true }));
    const user = userEvent.setup();
    await renderEditor();

    const box = screen.getByRole('checkbox', { name: new RegExp(`^${CHECKOUT.anonymous.label}`, 'u') });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(box).toBeChecked();
    await user.click(screen.getByRole('button', { name: EDITOR.save }));

    await screen.findByText(EDITOR.savedBody);
    expect(vi.mocked(editPledge).mock.calls.at(-1)?.[1]).toEqual({ isAnonymous: true });
  });

  it('mints a new key for an edit sent again after it succeeded, so it is not replayed', async () => {
    vi.mocked(editPledge).mockResolvedValue(pledge({ ...noReward, isAnonymous: true }));
    const user = userEvent.setup();
    await renderEditor();

    await user.click(screen.getByRole('checkbox', { name: new RegExp(`^${CHECKOUT.anonymous.label}`, 'u') }));
    await user.click(screen.getByRole('button', { name: EDITOR.save }));
    await screen.findByText(EDITOR.savedBody);
    await user.click(screen.getByRole('button', { name: EDITOR.save }));
    await screen.findByText(EDITOR.savedBody);

    const calls = vi.mocked(editPledge).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[2]).not.toBe(calls[1]?.[2]);
  });

  it('never tells a backer the charge happens later', () => {
    for (const sentence of [EDITOR.intro, EDITOR.savedBody]) {
      expect(sentence).not.toMatch(/when the campaign closes|collection happens|nothing has been charged/iu);
    }
    expect(EDITOR.intro).toMatch(/only be raised/u);
    expect(EDITOR.savedBody).toMatch(/refunded in full/u);
  });
});

