import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { listMyPledges, type BackerPledgeSummary } from '../../lib/pledges/backer';
import { pledgeListCopyFrom } from '../../lib/i18n/pledges-copy';
import { translatorFor } from '../../test-copy';
import { chargeNoteOf, PledgeList } from './PledgeList';
import az from '../../../messages/az.json';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import tr from '../../../messages/tr.json';

/**
 * The pledge list's account of the money — issue #131.
 *
 * IDN-EXT-01 moved the charge to confirmation: paying on the provider's page is what makes a
 * pledge `COLLECTED`. The list kept the old model's words — an empty state promising "what you
 * will be charged when the campaign closes", and "to be collected when the campaign closes"
 * under every pledge that was not `COLLECTED`, refunded ones included. The words come from the
 * catalogue through the builder the route calls, so these assertions are about the wiring.
 */

vi.mock('../../lib/pledges/backer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/pledges/backer')>()),
  listMyPledges: vi.fn(),
}));

const listMock = vi.mocked(listMyPledges);

const COPY = pledgeListCopyFrom(translatorFor('account.pledges'));

function summary(id: string, state: string): BackerPledgeSummary {
  const money = (amount: string) => ({ amount, currency: 'AZN' });
  return {
    pledgeId: id,
    state,
    amounts: {
      base: money('40.00'),
      addons: money('0.00'),
      bonus: money('0.00'),
      shipping: money('0.00'),
      tax: money('0.00'),
      total: money('40.00'),
    },
    rewardTierId: null,
    rewardTitle: null,
    isAnonymous: false,
    latePledge: false,
    confirmedAt: null,
    canceledAt: null,
    project: {
      id: `project-${id}`,
      title: `Campaign ${id}`,
      slug: `campaign-${id}`,
      creatorSlug: 'aysel',
      state: 'LIVE',
      deadline: null,
      coverImage: null,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('the pledge list', () => {
  it('says a paid pledge was charged, and promises nothing later', async () => {
    listMock.mockResolvedValue({ items: [summary('a', 'COLLECTED')], nextCursor: null });
    render(<PledgeList copy={COPY} />);

    const row = (await screen.findByText('Campaign a')).closest('li') as HTMLElement;
    expect(within(row).getByText(COPY.charged)).toBeInTheDocument();
    expect(row.textContent).not.toMatch(/campaign closes/u);
  });

  it('says an abandoned checkout was not charged', async () => {
    listMock.mockResolvedValue({ items: [summary('b', 'EXPIRED')], nextCursor: null });
    render(<PledgeList copy={COPY} />);

    const row = (await screen.findByText('Campaign b')).closest('li') as HTMLElement;
    expect(within(row).getByText(COPY.notCharged)).toBeInTheDocument();
  });

  it('leaves a refunded pledge to its state tag rather than guessing about the money', async () => {
    listMock.mockResolvedValue({ items: [summary('c', 'REFUNDED')], nextCursor: null });
    render(<PledgeList copy={COPY} />);

    const row = (await screen.findByText('Campaign c')).closest('li') as HTMLElement;
    expect(within(row).getByText(COPY.states['REFUNDED'] as string)).toBeInTheDocument();
    expect(within(row).queryByText(COPY.charged)).not.toBeInTheDocument();
    expect(within(row).queryByText(COPY.notCharged)).not.toBeInTheDocument();
  });

  it('explains, when empty, that a pledge is charged when it is confirmed', async () => {
    listMock.mockResolvedValue({ items: [], nextCursor: null });
    render(<PledgeList copy={COPY} />);

    expect(await screen.findByText(COPY.emptyBody)).toBeInTheDocument();
  });
});

describe('the word under a pledge’s total', () => {
  it.each([
    ['COLLECTED', COPY.charged],
    ['FULFILLED', COPY.charged],
    ['DRAFT', COPY.notCharged],
    ['EXPIRED', COPY.notCharged],
    ['CANCELED_BY_BACKER', COPY.notCharged],
    ['CONFIRMED', null],
    ['CHARGE_PENDING', null],
    ['CHARGE_FAILED', null],
    ['REFUNDED', null],
    ['CHARGEBACK', null],
    ['DROPPED', null],
    ['CANCELED_BY_PROJECT', null],
  ])('is right for %s', (state, expected) => {
    expect(chargeNoteOf(state, COPY)).toBe(expected);
  });
});

/**
 * The acceptance criterion itself, in all four languages: no pledge screen says or implies that
 * the charge happens later. The phrases are the old model's, as each catalogue spelled them.
 */
describe('the pledge screens’ money sentences in every language', () => {
  const LATER: Record<string, RegExp> = {
    en: /when the campaign closes|to be collected|collection happens|nothing has been charged/iu,
    az: /bağlananda|tutulacaq|hələ heç nə tutulmayıb/iu,
    ru: /когда кампания закроется|спишется|пока ничего не списано|списание происходит/iu,
    tr: /kapandığında|tahsil edilecek|henüz hiçbir tahsilat/iu,
  };

  it.each([
    ['en', en],
    ['az', az],
    ['ru', ru],
    ['tr', tr],
  ] as const)('says nothing about a later charge in %s', (language, catalogue) => {
    const pledges = catalogue.account.pledges;
    for (const sentence of [
      pledges.list.emptyBody,
      pledges.list.charged,
      pledges.list.notCharged,
      pledges.editor.intro,
      pledges.editor.savedBody,
    ]) {
      expect(sentence, `${language}: ${sentence}`).not.toMatch(LATER[language] as RegExp);
    }
  });
});
