import { act, render, screen } from '@testing-library/react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import type { Card } from '../api/queries';
import { setLocale } from '../lib/locale';
import { CampaignColumn, CampaignColumnSkeleton } from './campaign-column';

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

describe('CampaignColumnSkeleton', () => {
  it('is one busy element named by its label', async () => {
    await renderIn(<CampaignColumnSkeleton label="Loading projects" count={2} />);
    expect(screen.getByLabelText('Loading projects').props.accessibilityState).toMatchObject({
      busy: true,
    });
  });
});
