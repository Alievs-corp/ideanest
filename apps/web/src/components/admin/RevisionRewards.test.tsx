import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { RevisionReward, RevisionRewardWriting } from '../../lib/admin/revisions';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { revisionReviewCopyFrom } from '../../lib/i18n/admin/revision-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { translatorFor } from '../../test-copy';
import { RevisionRewards } from './RevisionRewards';

const COPY = revisionReviewCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);
const RC = COPY.rewards;

const PRICE = { amount: '25.00', currency: 'AZN' };
const ITEM_A = '0193f2a1-0000-7000-8000-00000000e001';
const ITEM_B = '0193f2a1-0000-7000-8000-00000000e002';
const ZONE = '0193f2a1-0000-7000-8000-00000000f001';

function writing(overrides: Partial<RevisionRewardWriting> = {}): RevisionRewardWriting {
  return {
    title: 'Signed print',
    description: 'A print on cotton paper',
    estimatedDelivery: '2027-03-01',
    shippingType: 'INTERNATIONAL',
    isEarlyBird: false,
    isFeatured: false,
    isSecret: false,
    isAddon: false,
    items: [{ itemId: ITEM_A, name: 'Print', quantity: 1 }],
    shippingRules: [{ countryCode: 'TR', amount: '5.00', additionalItemAmount: '1.00', perKilogramAmount: '2.00' }],
    shippingZoneRates: [],
    ...overrides,
  };
}

function reward(overrides: Partial<RevisionReward>): RevisionReward {
  return {
    id: '0193f2a1-0000-7000-8000-00000000a001',
    changes: ['changed'],
    livePosition: 0,
    proposedPosition: 0,
    price: PRICE,
    changedFields: [],
    live: writing(),
    proposed: writing(),
    ...overrides,
  };
}

function renderRewards(...rewards: RevisionReward[]) {
  return render(<RevisionRewards rewards={rewards} locale="en" copy={COPY} />);
}

function tier(title: string): HTMLElement {
  return screen.getByRole('article', { name: fillPlaceholders(RC.tierLabel, { title }) });
}

function pane(root: HTMLElement, heading: string, field: string, title: string): HTMLElement {
  return within(root).getByRole('group', { name: `${heading}: ${title}: ${field}` });
}

describe('the reward tiers of an edit, issue #569', () => {
  it('draws a created tier whole, as new, with a word, an icon and a spoken marker', () => {
    renderRewards(
      reward({
        changes: ['created'],
        livePosition: null,
        proposedPosition: 2,
        live: null,
        proposed: writing({
          title: 'Workshop seat',
          image: { mediaId: ITEM_B, url: 'https://img.test/seat.jpg', width: 400, height: 300 },
          limitQuantity: 12,
          isEarlyBird: true,
        }),
        changedFields: [],
      }),
    );

    const card = tier('Workshop seat');
    expect(within(card).getByText(RC.changes.created)).toBeInTheDocument();
    expect(card.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(within(card).getByText(RC.createdNote)).toBeInTheDocument();
    expect(within(card).getByText(COPY.added, { exact: false })).toBeInTheDocument();
    expect(within(card).getByText(fillPlaceholders(RC.placeProposed, { place: '3' }))).toBeInTheDocument();
    expect(within(card).getByText(fillPlaceholders(RC.price, { price: '25.00 AZN' }))).toBeInTheDocument();
    expect(within(card).getByText('12')).toBeInTheDocument();
    expect(within(card).getByText('Print × 1')).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: fillPlaceholders(RC.imageAlt, { title: 'Workshop seat' }) })).toBeInTheDocument();
    // Nothing of the tier is compared with a live one: it has none.
    expect(within(card).queryByText(COPY.removed, { exact: false })).not.toBeInTheDocument();
  });

  it('draws a deleted tier as to be removed and still live', () => {
    renderRewards(
      reward({
        changes: ['deleted'],
        livePosition: 1,
        proposedPosition: null,
        live: writing({ title: 'Old bundle' }),
        proposed: null,
      }),
    );

    const card = tier('Old bundle');
    expect(within(card).getByText(RC.changes.deleted)).toBeInTheDocument();
    expect(within(card).getByText(RC.deletedNote)).toBeInTheDocument();
    expect(within(card).getByText(COPY.removed, { exact: false })).toBeInTheDocument();
    expect(within(card).getByText(fillPlaceholders(RC.placeLive, { place: '2' }))).toBeInTheDocument();
  });

  it('shows a moved tier by its place alone', () => {
    renderRewards(reward({ changes: ['reordered'], livePosition: 0, proposedPosition: 2 }));

    const card = tier('Signed print');
    expect(within(card).getByText(RC.changes.reordered)).toBeInTheDocument();
    expect(within(card).getByText(fillPlaceholders(RC.placeBoth, { live: '1', proposed: '3' }))).toBeInTheDocument();
    expect(within(card).getByText(RC.movedOnly)).toBeInTheDocument();
  });

  it('marks changed writing in words on both sides, field by field', () => {
    renderRewards(
      reward({
        changes: ['changed', 'reordered'],
        livePosition: 0,
        proposedPosition: 1,
        changedFields: ['title', 'description'],
        proposed: writing({ title: 'Signed art print', description: 'A print on heavy cotton paper' }),
      }),
    );

    const card = tier('Signed art print');
    expect(within(card).getByText(RC.changes.changed)).toBeInTheDocument();
    expect(within(card).getByText(RC.changes.reordered)).toBeInTheDocument();
    expect(within(card).getByText(RC.priceFrozen, { exact: false })).toBeInTheDocument();

    const live = pane(card, COPY.liveHeading, RC.fields.title, 'Signed art print');
    const proposed = pane(card, COPY.proposedHeading, RC.fields.title, 'Signed art print');
    const added = within(proposed).getByText('art', { exact: false });
    expect(added.tagName).toBe('INS');
    expect(added).toHaveTextContent(COPY.added);
    expect(within(live).queryByText('art', { exact: false })).not.toBeInTheDocument();

    const description = pane(card, COPY.proposedHeading, RC.fields.description, 'Signed art print');
    expect(within(description).getByText('heavy', { exact: false }).tagName).toBe('INS');
    // A field the service did not name is not drawn.
    expect(within(card).queryByText(RC.fields.limitQuantity)).not.toBeInTheDocument();
  });

  it('shows the picture and the video before and after', () => {
    renderRewards(
      reward({
        changedFields: ['imageMediaId', 'videoMediaId'],
        live: writing({
          image: { mediaId: ITEM_A, url: 'https://img.test/old.jpg', width: 400, height: 300 },
          video: { mediaId: ITEM_A, url: 'https://v.test/old.mp4', posterUrl: 'https://img.test/old-poster.jpg' },
        }),
        proposed: writing({
          image: { mediaId: ITEM_B, url: 'https://img.test/new.jpg', width: 400, height: 300 },
          video: undefined,
        }),
      }),
    );

    const card = tier('Signed print');
    const imageLive = pane(card, COPY.liveHeading, RC.fields.imageMediaId, 'Signed print');
    const imageProposed = pane(card, COPY.proposedHeading, RC.fields.imageMediaId, 'Signed print');
    expect(within(imageLive).getByRole('img')).toHaveAttribute('src', expect.stringContaining('old.jpg'));
    expect(within(imageLive).getByText(COPY.removed, { exact: false })).toBeInTheDocument();
    expect(within(imageProposed).getByRole('img')).toHaveAttribute('src', expect.stringContaining('new.jpg'));
    expect(within(imageProposed).getByText(COPY.added, { exact: false })).toBeInTheDocument();

    const videoLive = pane(card, COPY.liveHeading, RC.fields.videoMediaId, 'Signed print');
    const videoProposed = pane(card, COPY.proposedHeading, RC.fields.videoMediaId, 'Signed print');
    expect(within(videoLive).getByRole('link', { name: COPY.openVideo })).toHaveAttribute('href', 'https://v.test/old.mp4');
    expect(within(videoProposed).getByText(COPY.noVideo)).toBeInTheDocument();
  });

  it('shows delivery, quantity limit, shipping type, flags and availability as before and after', () => {
    renderRewards(
      reward({
        changedFields: [
          'estimatedDelivery',
          'limitQuantity',
          'shippingType',
          'isEarlyBird',
          'isFeatured',
          'isSecret',
          'isAddon',
          'availableFrom',
          'availableUntil',
        ],
        live: writing({ limitQuantity: 10, shippingType: 'DOMESTIC' }),
        proposed: writing({
          estimatedDelivery: '2027-05-01',
          limitQuantity: 40,
          shippingType: 'DIGITAL',
          isEarlyBird: true,
          isFeatured: true,
          isSecret: true,
          isAddon: true,
          availableFrom: '2027-01-10T08:00:00Z',
          availableUntil: '2027-02-10T08:00:00Z',
        }),
      }),
    );

    const card = tier('Signed print');
    const cell = (side: string, field: string) => pane(card, side, field, 'Signed print');

    expect(within(cell(COPY.liveHeading, RC.fields.limitQuantity)).getByText('10')).toBeInTheDocument();
    expect(within(cell(COPY.proposedHeading, RC.fields.limitQuantity)).getByText('40')).toBeInTheDocument();
    expect(within(cell(COPY.liveHeading, RC.fields.shippingType)).getByText(RC.shippingTypes.DOMESTIC ?? '')).toBeInTheDocument();
    expect(within(cell(COPY.proposedHeading, RC.fields.shippingType)).getByText(RC.shippingTypes.DIGITAL ?? '')).toBeInTheDocument();
    expect(within(cell(COPY.liveHeading, RC.fields.estimatedDelivery)).getByText(/2027/)).toBeInTheDocument();
    expect(within(cell(COPY.proposedHeading, RC.fields.estimatedDelivery)).getByText(/May/)).toBeInTheDocument();
    for (const field of [RC.fields.isEarlyBird, RC.fields.isFeatured, RC.fields.isSecret, RC.fields.isAddon]) {
      expect(within(cell(COPY.liveHeading, field)).getByText(RC.no)).toBeInTheDocument();
      expect(within(cell(COPY.proposedHeading, field)).getByText(RC.yes)).toBeInTheDocument();
    }
    expect(within(cell(COPY.liveHeading, RC.fields.availableFrom)).getByText(RC.none)).toBeInTheDocument();
    expect(within(cell(COPY.proposedHeading, RC.fields.availableUntil)).getByText(/Feb/)).toBeInTheDocument();
  });

  it('lists a replaced private link for a tier that stays secret', () => {
    renderRewards(
      reward({
        changedFields: ['isSecret'],
        live: writing({ isSecret: true }),
        proposed: writing({ isSecret: true }),
      }),
    );

    const proposed = pane(tier('Signed print'), COPY.proposedHeading, RC.fields.isSecret, 'Signed print');
    expect(within(proposed).getByText(RC.secretLinkReplaced)).toBeInTheDocument();
  });

  it('compares composition and shipping rates line by line with amounts as written', () => {
    renderRewards(
      reward({
        changedFields: ['items', 'shippingRules', 'shippingZoneRates'],
        live: writing({
          items: [{ itemId: ITEM_A, name: 'Print', quantity: 1 }],
          shippingRules: [{ countryCode: 'TR', amount: '5.00', additionalItemAmount: '1.00', perKilogramAmount: '2.00' }],
          shippingZoneRates: [],
        }),
        proposed: writing({
          items: [
            { itemId: ITEM_A, name: 'Print', quantity: 1 },
            { itemId: ITEM_B, name: 'Frame', quantity: 2 },
          ],
          shippingRules: [{ countryCode: 'TR', amount: '7.50', additionalItemAmount: '1.00', perKilogramAmount: '2.00' }],
          shippingZoneRates: [{ zoneId: ZONE, zoneName: 'Europe', amount: '9.00', additionalItemAmount: '0.00', perKilogramAmount: '3.00' }],
        }),
      }),
    );

    const card = tier('Signed print');

    const itemsProposed = pane(card, COPY.proposedHeading, RC.fields.items, 'Signed print');
    expect(within(itemsProposed).getByText('Frame × 2').tagName).toBe('INS');
    expect(within(itemsProposed).getByText('Print × 1').tagName).not.toBe('INS');
    expect(within(pane(card, COPY.liveHeading, RC.fields.items, 'Signed print')).queryByText('Frame × 2')).not.toBeInTheDocument();

    const rate = (amount: string) =>
      `Türkiye: ${fillPlaceholders(RC.rateLine, { amount, additional: '1.00 AZN', perKilogram: '2.00 AZN' })}`;
    const rulesLive = pane(card, COPY.liveHeading, RC.fields.shippingRules, 'Signed print');
    const rulesProposed = pane(card, COPY.proposedHeading, RC.fields.shippingRules, 'Signed print');
    expect(within(rulesLive).getByText(rate('5.00 AZN'), { exact: false }).tagName).toBe('DEL');
    expect(within(rulesProposed).getByText(rate('7.50 AZN'), { exact: false }).tagName).toBe('INS');

    expect(within(pane(card, COPY.liveHeading, RC.fields.shippingZoneRates, 'Signed print')).getByText(RC.noRates)).toBeInTheDocument();
    expect(within(pane(card, COPY.proposedHeading, RC.fields.shippingZoneRates, 'Signed print')).getByText(/Europe: /)).toBeInTheDocument();
  });

  it('names an item or a zone that has been deleted since', () => {
    renderRewards(
      reward({
        changedFields: ['items', 'shippingZoneRates'],
        live: writing({ items: [], shippingZoneRates: [] }),
        proposed: writing({
          items: [{ itemId: ITEM_B, quantity: 3 }],
          shippingZoneRates: [{ zoneId: ZONE, amount: '1.00', additionalItemAmount: '0.00', perKilogramAmount: '0.00' }],
        }),
      }),
    );

    const card = tier('Signed print');
    expect(within(card).getByText(fillPlaceholders(RC.itemLine, { name: RC.itemGone, quantity: '3' }))).toBeInTheDocument();
    expect(within(card).getByText(new RegExp(`^${RC.zoneGone}: `))).toBeInTheDocument();
  });

  it('draws every tier of the edit under one heading', () => {
    renderRewards(
      reward({ id: 'a', changes: ['reordered'], livePosition: 0, proposedPosition: 1 }),
      reward({ id: 'b', changes: ['deleted'], live: writing({ title: 'Gone' }), proposed: null }),
    );

    expect(screen.getByRole('heading', { name: COPY.fields.rewards })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });
});
