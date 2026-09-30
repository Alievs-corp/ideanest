import type { ReactElement } from 'react';
import { render as renderBare } from '@testing-library/react-native';
import { Text } from 'react-native';
import { IntlProvider } from 'use-intl';
import { staggerDelay } from '@ideanest/design-tokens';
import en from '@ideanest/messages/en.json';
import { ANIMATED_PREFIX, CampaignList } from './campaign-list';
import type { Card } from '../api/queries';

/**
 * §4.3's actual requirement: **capped stagger so long lists never crawl.**
 *
 * <p>Two separate caps, and both are needed. `staggerDelay` bounds the delay at 300ms, so
 * the fiftieth card does not wait two and a half seconds. {@link ANIMATED_PREFIX} bounds
 * how many cards animate at all, and that one is this component's: FlashList recycles
 * rows, so an `entering` animation keyed off an absolute index replays halfway down a list
 * somebody is already reading, and fifty animated cards in a feed produce visible jank
 * (motion-system §8).
 *
 * <p>A card's words come from the catalogue (issue #150), so the list is rendered in English
 * through the provider every screen sits in.
 */

// A cold first render of FlashList with Reanimated has taken more than 5 s on CI.
jest.setTimeout(20_000);

function render(ui: ReactElement) {
  return renderBare(
    <IntlProvider locale="en" messages={en}>
      {ui}
    </IntlProvider>,
  );
}

function cards(count: number): Card[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `campaign-${index}`,
    slug: `campaign-${index}`,
    creatorSlug: 'aysel',
    creator: { name: 'Aysel', slug: 'aysel' },
    title: `Campaign ${index}`,
    completionPercent: '40',
    pledged: { amount: '1000.00', currency: 'AZN' },
    goal: { amount: '2500.00', currency: 'AZN' },
    daysLeft: 12,
  })) as Card[];
}

describe('the stagger ceiling', () => {
  it('stops growing at 300ms, so the fiftieth card does not wait', () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(ANIMATED_PREFIX - 1)).toBeLessThanOrEqual(300);
    expect(staggerDelay(50)).toBe(300);
  });

  it('animates about two screenfuls and no more', () => {
    // Not a round number for its own sake: beyond what a thumb reaches before it moves,
    // an entry animation is a cost with nobody watching it.
    expect(ANIMATED_PREFIX).toBeGreaterThan(0);
    expect(ANIMATED_PREFIX).toBeLessThanOrEqual(10);
  });
});

describe('CampaignList', () => {
  it('renders the cards it is given', async () => {
    const { getByText } = await render(<CampaignList cards={cards(3)} />);

    expect(getByText('Campaign 0')).toBeTruthy();
    expect(getByText('Campaign 2')).toBeTruthy();
  });

  it('shows the empty element rather than an empty list', async () => {
    const { getByText } = await render(
      <CampaignList cards={[]} empty={<Text>Nothing here yet</Text>} />,
    );

    expect(getByText('Nothing here yet')).toBeTruthy();
  });

  it('names each card as one link, not as four unlabelled fragments', async () => {
    const { getByLabelText } = await render(<CampaignList cards={cards(1)} />);

    // The whole card is the target: a thumb aims at the picture, and a card whose only
    // target is a line of 14px text is a card people miss.
    expect(getByLabelText('Campaign 0, by Aysel')).toBeTruthy();
  });

  it('points each card at the campaign it is about', async () => {
    const { getAllByTestId } = await render(<CampaignList cards={cards(2)} />);

    // The path both halves of §4.12 MB-02 agree on: `apps/web` serves a campaign here and
    // `lib/links.ts` resolves an incoming link to the same string.
    const [first] = getAllByTestId('link');
    expect(first?.props.accessibilityValue.text).toBe('/projects/aysel/campaign-0');
  });

  it('formats the pledged amount through the shared money rules', async () => {
    const { getByText } = await render(<CampaignList cards={cards(1)} />);

    // Grouped digits and the ISO code, from `@ideanest/money` — the same module the web
    // formats with, which is the whole reason that package exists.
    expect(getByText('1,000.00 AZN pledged')).toBeTruthy();
  });

  it('counts the days left with the campaign page’s plural', async () => {
    const { getByText } = await render(<CampaignList cards={cards(1)} />);

    expect(getByText('12 days left')).toBeTruthy();
    expect(getByText('40% funded')).toBeTruthy();
  });
});
