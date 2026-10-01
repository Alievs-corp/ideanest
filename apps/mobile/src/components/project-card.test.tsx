import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { formatMoney } from '@ideanest/money';
import type { Locale } from '@ideanest/messages';
import type { Card } from '../api/queries';
import { AppIntlProvider } from '../lib/i18n';
import { setLocale } from '../lib/locale';
import { colors } from '../theme';
import { ProjectCard, completionOf } from './project-card';
import { PROGRESS_FILL } from './ui';

/**
 * The card is issue #153's field-by-field table against the web's `ProjectCard`. Each describe
 * below is one row or one rule of it: the badges and the two extra tags, the lime urgency chip
 * and when it may appear, the "not open" swap, the days-left rule, the backers plural in the
 * four languages, the money path, and the one accessible name.
 */

const LIVE: Card = {
  id: 'c-1',
  slug: 'solar-lamp',
  creatorSlug: 'aysel',
  creator: { name: 'Aysel', slug: 'aysel' },
  title: 'Solar Lamp',
  state: 'LIVE',
  badge: 'live',
  completionPercent: '42.50',
  pledged: { amount: '1062.50', currency: 'AZN' },
  goal: { amount: '2500.00', currency: 'AZN' },
  backersCount: 12,
  daysLeft: 9,
} as Card;

async function renderCard(card: Card, locale: Locale = 'en') {
  await act(async () => setLocale(locale));
  return render(
    <AppIntlProvider>
      <ProjectCard card={card} />
    </AppIntlProvider>,
  );
}

interface HostNode {
  readonly type: string;
  readonly props: Record<string, unknown> & { style?: unknown; testID?: string };
  readonly children: readonly (HostNode | string)[] | null;
}

/** Every host element in a rendered tree, depth first. */
function hostNodes(tree: unknown): HostNode[] {
  if (tree === null || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(hostNodes);
  const node = tree as HostNode;
  return [node, ...(node.children ?? []).flatMap(hostNodes)];
}

afterAll(async () => {
  await act(async () => setLocale('en'));
});

describe('the status badge', () => {
  it.each([
    ['upcoming', 'Upcoming'],
    ['live', 'Live'],
    ['extended', 'Extended'],
    ['successful', 'Successful'],
  ])('draws %s as "%s"', async (badge, word) => {
    await renderCard({ ...LIVE, badge });
    expect(screen.getByText(word)).toBeTruthy();
  });

  it('draws successful in the success colour, never lime', async () => {
    await renderCard({ ...LIVE, badge: 'successful', state: 'FUNDED' });
    const color = StyleSheet.flatten(screen.getByText('Successful').props.style).color;
    expect(color).toBe(colors.success);
    expect(color).not.toBe(colors.lime500);
  });

  it('draws no badge for a value this build does not know, and none when absent', async () => {
    await renderCard({ ...LIVE, badge: 'cancelled' });
    expect(screen.queryByText('Live')).toBeNull();
    await renderCard({ ...LIVE, badge: undefined });
    expect(screen.queryByText('Live')).toBeNull();
  });
});

describe('the Extended and Closing soon tags', () => {
  it('adds Extended beside the badge when the card is extended', async () => {
    await renderCard({ ...LIVE, extended: true });
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByText('Extended')).toBeTruthy();
  });

  it('adds Closing soon in the warning colour', async () => {
    await renderCard({ ...LIVE, closingSoon: true });
    const color = StyleSheet.flatten(screen.getByText('Closing soon').props.style).color;
    expect(color).toBe(colors.warning);
  });

  it('can carry both', async () => {
    await renderCard({ ...LIVE, extended: true, closingSoon: true });
    expect(screen.getByText('Extended')).toBeTruthy();
    expect(screen.getByText('Closing soon')).toBeTruthy();
  });
});

describe('the lime urgency chip', () => {
  it('says "Last day" at zero days on a live card', async () => {
    await renderCard({ ...LIVE, daysLeft: 0 });
    expect(screen.getByTestId('urgency-chip')).toHaveTextContent('Last day');
  });

  it('counts down at two days, on a lime fill with on-lime text', async () => {
    await renderCard({ ...LIVE, daysLeft: 2 });
    const chip = screen.getByTestId('urgency-chip');
    expect(chip).toHaveTextContent('2 days left');
    expect(StyleSheet.flatten(chip.props.style).backgroundColor).toBe(colors.lime500);
    expect(StyleSheet.flatten(screen.getByText('2 days left').props.style).color).toBe(
      colors.textOnLime,
    );
  });

  it('is absent at three days, which are plain text instead', async () => {
    await renderCard({ ...LIVE, daysLeft: 3 });
    expect(screen.queryByTestId('urgency-chip')).toBeNull();
    expect(screen.getByText('3 days left')).toBeTruthy();
  });

  it.each([0, 1, 2])('never appears on a card that is not live (%i days)', async (daysLeft) => {
    await renderCard({ ...LIVE, state: 'FUNDED', badge: 'successful', daysLeft });
    expect(screen.queryByTestId('urgency-chip')).toBeNull();
  });

  it('is the only lime on the card', async () => {
    const { toJSON } = await renderCard({ ...LIVE, daysLeft: 1, extended: true, closingSoon: true });
    const lime = hostNodes(toJSON())
      .filter((node) => {
        const style: { backgroundColor?: unknown; color?: unknown } =
          StyleSheet.flatten(node.props.style as never) ?? {};
        return style.backgroundColor === colors.lime500 || style.color === colors.lime500;
      })
      // The progress fill is lime under 100% by design; it is the bar, not a card element.
      .filter((node) => node.props.testID !== PROGRESS_FILL);
    expect(lime.map((node) => node.props.testID)).toEqual(['urgency-chip']);
  });
});

describe('days left', () => {
  it('is hidden when there is no deadline', async () => {
    await renderCard({ ...LIVE, daysLeft: undefined });
    expect(screen.queryByText(/days? left|Last day/)).toBeNull();
  });

  it('is hidden at zero on a campaign that has closed', async () => {
    await renderCard({ ...LIVE, state: 'FUNDED', badge: 'successful', daysLeft: 0 });
    expect(screen.queryByText(/Last day|0 days left/)).toBeNull();
  });

  it('is shown on a closed card that still reports days, as the web does', async () => {
    await renderCard({ ...LIVE, state: 'UPCOMING', badge: 'upcoming', daysLeft: 5 });
    expect(screen.getByText('5 days left')).toBeTruthy();
  });

  it('uses the singular at one, in English', async () => {
    await renderCard({ ...LIVE, state: 'UPCOMING', badge: 'upcoming', daysLeft: 1 });
    expect(screen.getByText('1 day left')).toBeTruthy();
  });
});

describe('not open for pledges yet', () => {
  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['unparseable', 'eighty'],
  ])('replaces the funding block when the completion is %s', async (_case, completionPercent) => {
    await renderCard({ ...LIVE, completionPercent, state: 'PRELAUNCH', badge: 'upcoming' });
    expect(screen.getByText('Not open for pledges yet')).toBeTruthy();
    expect(screen.queryByText(/funded/)).toBeNull();
    expect(screen.queryByText('Succeeds at 80% of the goal')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('the money on the card', () => {
  it('rounds the percent through decimal.js: 79.995 is 80% funded', async () => {
    await renderCard({ ...LIVE, completionPercent: '79.995' });
    expect(screen.getByText('80% funded')).toBeTruthy();
    expect(completionOf({ completionPercent: '79.995' })?.toFixed(0)).toBe('80');
  });

  it('formats pledged and the goal with @ideanest/money', async () => {
    await renderCard(LIVE);
    expect(screen.getByText(formatMoney(LIVE.pledged))).toBeTruthy();
    expect(screen.getByText(`of ${formatMoney(LIVE.goal)} goal`)).toBeTruthy();
  });

  it('prints the 80% rule, and no words on the bar itself', async () => {
    await renderCard(LIVE);
    expect(screen.getByText('Succeeds at 80% of the goal')).toBeTruthy();
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({
      text: '43 percent of the goal',
    });
    expect(screen.getByRole('progressbar', { name: '43 percent of the goal' })).toBeTruthy();
  });

  it('leaves out "of goal" when there is no goal', async () => {
    await renderCard({ ...LIVE, goal: undefined });
    expect(screen.queryByText(/^of .* goal$/)).toBeNull();
    expect(screen.getByText('Succeeds at 80% of the goal')).toBeTruthy();
  });
});

describe('backers, in each language', () => {
  it.each<[Locale, number, string]>([
    ['en', 1, '1 backer'],
    ['en', 12, '12 backers'],
    ['az', 1, '1 dəstəkçi'],
    ['az', 12, '12 dəstəkçi'],
    ['tr', 1, '1 destekçi'],
    ['tr', 12, '12 destekçi'],
    ['ru', 1, '1 бэкер'],
    ['ru', 3, '3 бэкера'],
    ['ru', 12, '12 бэкеров'],
  ])('in %s, %i reads "%s"', async (locale, backersCount, words) => {
    await renderCard({ ...LIVE, backersCount }, locale);
    expect(screen.getByText(words)).toBeTruthy();
  });
});

describe('the card as one link', () => {
  it('is named by its title and byline, and points at the campaign', async () => {
    await renderCard(LIVE);
    const card = screen.getByRole('link', { name: 'Solar Lamp, by Aysel' });
    expect(card).toBeTruthy();
    expect(screen.getByTestId('link')).toHaveAccessibilityValue({
      text: '/projects/aysel/solar-lamp',
    });
  });

  it('is named by the title alone when there is no creator', async () => {
    await renderCard({ ...LIVE, creator: undefined });
    expect(screen.getByRole('link', { name: 'Solar Lamp' })).toBeTruthy();
  });

  it('draws the byline as "by" plus the name', async () => {
    await renderCard(LIVE);
    expect(screen.getByText('by Aysel')).toBeTruthy();
  });
});
