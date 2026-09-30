import type { ReactElement } from 'react';
import { act, render as renderBare } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { FadeInDown } from 'react-native-reanimated';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { CampaignList, CampaignListSkeleton } from './campaign-list';
import { MotionBudgetProvider } from './ui';
import type { Card } from '../api/queries';
import { colors } from '../theme';

/**
 * §4.3's actual requirement: **long lists never crawl** — and `docs/motion-system.md` §5.1's:
 * **no animation on campaign cards**, not even a capped stagger over the first screenful. The
 * list used to fade its first six cards up; issue #151 took that out, and the first describe
 * below keeps it out.
 *
 * <p>A card's words come from the catalogue (issue #150), so the list is rendered in English
 * through the provider every screen sits in.
 */

// A cold first render of FlashList with Reanimated has taken more than 5 s on CI.
jest.setTimeout(20_000);

/**
 * Renders, then lets FlashList finish loading inside `act`. It marks itself loaded from a
 * `requestAnimationFrame` — a zero-delay timer under Jest — after the first render, and that state
 * update outside `act` logged "not wrapped in act(...)" for every list rendered here.
 */
async function render(ui: ReactElement) {
  const tree = await renderBare(
    <IntlProvider locale="en" messages={en}>
      {ui}
    </IntlProvider>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return tree;
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

describe('motion on the feed', () => {
  afterEach(() => jest.restoreAllMocks());

  it('builds no entry animation for any card, even where the budget would allow one', async () => {
    // Read off Reanimated's builder, as `FadeUp`'s own test does: `FadeUp` calls
    // `FadeInDown.duration(...)` whenever it animates, and a card list must never reach it.
    const built = jest.spyOn(FadeInDown, 'duration');
    await render(
      <MotionBudgetProvider level="full">
        <CampaignList cards={cards(10)} />
      </MotionBudgetProvider>,
    );
    expect(built).not.toHaveBeenCalled();
  });

  it('refreshes with the refresh haptic and a spinner that is not lime', async () => {
    jest.clearAllMocks();
    const onRefresh = jest.fn();
    const { container } = await render(<CampaignList cards={cards(2)} onRefresh={onRefresh} />);

    const [scroller] = container.queryAll((node) => node.props.refreshControl !== undefined);
    const control = scroller?.props.refreshControl as ReactElement<{
      onRefresh: () => void;
      tintColor: string;
      colors: string[];
    }>;
    expect(control.props.tintColor).not.toBe(colors.lime500);
    expect(control.props.colors).not.toContain(colors.lime500);

    await act(() => control.props.onRefresh());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Medium);
  });

  it('stands in for the first page with one busy placeholder named by the screen', async () => {
    const { getByLabelText } = await render(<CampaignListSkeleton label="Loading projects" />);
    expect(getByLabelText('Loading projects').props.accessibilityState).toMatchObject({
      busy: true,
    });
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
