import { act, render, screen } from '@testing-library/react-native';
import { FadeInDown } from 'react-native-reanimated';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import type { Card } from '../api/queries';
import { setLocale } from '../lib/locale';
import { staggerDelay } from '../theme';
import { CampaignColumn, CampaignColumnSkeleton } from './campaign-column';
import { FIRST_SCREENFUL } from './motion';
import { MotionBudgetProvider } from './ui';

jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: (props: Record<string, unknown>) => <View testID="cover" {...props} /> };
});

function cards(count: number): Card[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `c-${index}`,
    slug: `campaign-${index}`,
    creatorSlug: 'aysel',
    creator: { name: 'Aysel', slug: 'aysel' },
    title: `Campaign ${index}`,
    image: { url: `https://cdn.ideanest.az/${index}.jpg`, width: 1600, height: 900 },
    completionPercent: '40',
    pledged: { amount: '1000.00', currency: 'AZN' },
    backersCount: 3,
  })) as Card[];
}

/**
 * The delay of every entry rise `FadeUp` builds — its stagger, so which list positions rose. It
 * builds one per render of a rising cell, so a count would also count re-renders; the delays say
 * which positions it was for.
 */
function spyOnRises(): number[] {
  const delays: number[] = [];
  const build = FadeInDown.duration.bind(FadeInDown);
  jest.spyOn(FadeInDown, 'duration').mockImplementation((ms: number) => {
    const builder = build(ms);
    const delay = builder.delay.bind(builder);
    builder.delay = ((ms: number) => {
      delays.push(ms);
      return delay(ms);
    }) as typeof builder.delay;
    return builder;
  });
  return delays;
}

async function renderIn(ui: React.ReactElement) {
  await act(async () => setLocale('en'));
  return render(
    <IntlProvider locale="en" messages={en}>
      {ui}
    </IntlProvider>,
  );
}

describe('CampaignColumn', () => {
  it('draws every card as one link, in order', async () => {
    await renderIn(<CampaignColumn cards={cards(4)} />);
    expect(screen.getAllByRole('link').map((link) => link.props.accessibilityLabel)).toEqual([
      'Campaign 0, by Aysel',
      'Campaign 1, by Aysel',
      'Campaign 2, by Aysel',
      'Campaign 3, by Aysel',
    ]);
  });

  it('fetches only the first covers it is told to with high priority', async () => {
    await renderIn(<CampaignColumn cards={cards(5)} priority={3} />);
    expect(screen.getAllByTestId('cover', { includeHiddenElements: true }).map((cover) => cover.props.priority)).toEqual([
      'high',
      'high',
      'high',
      'normal',
      'normal',
    ]);
  });

  it('gives no cover priority by default', async () => {
    await renderIn(<CampaignColumn cards={cards(2)} />);
    expect(screen.getAllByTestId('cover', { includeHiddenElements: true }).map((cover) => cover.props.priority)).toEqual([
      'normal',
      'normal',
    ]);
  });
});

describe('the first screenful rises in', () => {
  afterEach(() => jest.restoreAllMocks());

  it('staggers the first eight cards in, and no card after them, with full motion', async () => {
    const built = jest.spyOn(FadeInDown, 'duration');
    await renderIn(<CampaignColumn cards={cards(10)} />);
    expect(built).toHaveBeenCalledTimes(FIRST_SCREENFUL);
  });

  it('stays still with reduced motion', async () => {
    const built = jest.spyOn(FadeInDown, 'duration');
    await renderIn(
      <MotionBudgetProvider level="none">
        <CampaignColumn cards={cards(4)} />
      </MotionBudgetProvider>,
    );
    expect(built).not.toHaveBeenCalled();
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });

  it('does not animate cards that arrive after the first ones', async () => {
    const delays = spyOnRises();
    const view = await renderIn(<CampaignColumn cards={cards(2)} />);
    expect(delays).toEqual([staggerDelay(0), staggerDelay(1)]);

    // Three more at positions 2–4: no rise is built for any of them.
    await view.rerender(
      <IntlProvider locale="en" messages={en}>
        <CampaignColumn cards={cards(5)} />
      </IntlProvider>,
    );
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(delays.every((delay) => delay <= staggerDelay(1))).toBe(true);
  });

  it('does not animate a refetch that replaces the cards', async () => {
    const built = jest.spyOn(FadeInDown, 'duration');
    const view = await renderIn(<CampaignColumn cards={cards(2)} />);
    expect(built).toHaveBeenCalledTimes(2);

    const fresh = cards(2).map((card, index) => ({ ...card, id: 'fresh-' + String(index) }));
    await view.rerender(
      <IntlProvider locale="en" messages={en}>
        <CampaignColumn cards={fresh} />
      </IntlProvider>,
    );
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(built).toHaveBeenCalledTimes(2);
  });
});

describe('CampaignColumnSkeleton', () => {
  it('is one busy element named by its label', async () => {
    await renderIn(<CampaignColumnSkeleton label="Loading projects" count={2} />);
    expect(screen.getByLabelText('Loading projects').props.accessibilityState).toMatchObject({
      busy: true,
    });
  });
});
