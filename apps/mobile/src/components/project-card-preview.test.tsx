import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import * as ExpoVideo from 'expo-video';
import type { Card } from '../api/queries';
import { AppIntlProvider } from '../lib/i18n';
import { setLocale } from '../lib/locale';
import { currentPreview } from '../lib/media/hold-preview';
import { ProjectCard } from './project-card';
import { MotionBudgetProvider, SharedTransitionHost, type MotionLevel } from './ui';

/**
 * A campaign with a video, on its card: the video's poster is the cover, a press and hold plays
 * the clip over it until release, a tap still opens the campaign, and one preview plays app-wide.
 */

const mockNavigate = jest.fn();
jest.mock('expo-router', () => {
  const { cloneElement } = require('react');
  return {
    // `asChild`, as the real one is used: the card receives the press and the Link navigates.
    Link: ({ href, children }: { href: unknown; children: { props: { onPress?: (event: unknown) => void } } }) =>
      cloneElement(children, {
        onPress: (event: unknown) => {
          children.props.onPress?.(event);
          mockNavigate(href);
        },
      }),
  };
});

jest.mock('expo-image', () => {
  const { View: Host } = require('react-native');
  return { Image: (props: Record<string, unknown>) => <Host testID="image" {...props} /> };
});

const players = (ExpoVideo as unknown as {
  __players: { source: unknown; play: jest.Mock; pause: jest.Mock; loop: boolean; muted?: boolean }[];
}).__players;

const VIDEO = {
  url: 'https://media.example/lamp.mp4',
  posterUrl: 'https://media.example/lamp.jpg',
  width: 1280,
  height: 720,
};

const CARD = {
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
  image: { url: 'https://cdn.example/cover.jpg', width: 1600, height: 900 },
  video: VIDEO,
} as Card;

async function renderCards(cards: readonly Card[], level: MotionLevel = 'full') {
  await act(async () => setLocale('en'));
  return render(
    <MotionBudgetProvider level={level}>
      <SharedTransitionHost>
        <AppIntlProvider>
          <View>
            {cards.map((card) => (
              <ProjectCard key={card.id} card={card} />
            ))}
          </View>
        </AppIntlProvider>
      </SharedTransitionHost>
    </MotionBudgetProvider>,
  );
}

function coverSources(): unknown[] {
  return screen.getAllByTestId('image', { includeHiddenElements: true }).map((image) => image.props.source);
}

beforeEach(() => {
  players.length = 0;
  mockNavigate.mockClear();
});

describe('a campaign card with a video', () => {
  it('is covered by the video’s poster, not the uploaded picture', async () => {
    await renderCards([CARD]);
    expect(coverSources()).toContainEqual({ uri: VIDEO.posterUrl });
    expect(coverSources()).not.toContainEqual({ uri: 'https://cdn.example/cover.jpg' });
    // Nothing plays, and no stream is opened, until the card is held.
    expect(screen.queryByTestId('campaign-card-preview', { includeHiddenElements: true })).toBeNull();
    expect(players).toHaveLength(0);
  });

  it('says how to preview it', async () => {
    await renderCards([CARD]);
    expect(screen.getByRole('link').props.accessibilityHint).toBe('Press and hold to preview the video');
  });

  it('plays the clip, muted and looping, while held, and stops it on release', async () => {
    await renderCards([CARD]);
    const card = screen.getByRole('link');

    await fireEvent(card, 'longPress');
    expect(screen.getByTestId('campaign-card-preview', { includeHiddenElements: true })).toBeTruthy();
    expect(players).toHaveLength(1);
    expect(players[0]).toMatchObject({ source: VIDEO.url, loop: true, muted: true });
    expect(players[0]?.play).toHaveBeenCalled();
    // A hold is not a tap: it opens nothing.
    expect(mockNavigate).not.toHaveBeenCalled();

    await fireEvent(card, 'pressOut');
    expect(screen.queryByTestId('campaign-card-preview', { includeHiddenElements: true })).toBeNull();
    expect(currentPreview()).toBeNull();
  });

  it('still opens the campaign on a tap, with the shared cover flight', async () => {
    await renderCards([CARD]);
    await fireEvent.press(screen.getByRole('link'));
    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/projects/[creatorSlug]/[projectSlug]',
      params: { creatorSlug: 'aysel', projectSlug: 'solar-lamp', transition: 'shared' },
    });
    expect(screen.queryByTestId('campaign-card-preview', { includeHiddenElements: true })).toBeNull();
  });

  it('plays one preview at a time: a second hold takes it from the first card', async () => {
    const other = { ...CARD, id: 'c-2', slug: 'water-filter', title: 'Water Filter' } as Card;
    await renderCards([CARD, other]);
    const [first, second] = screen.getAllByRole('link');
    if (first === undefined || second === undefined) throw new Error('two cards');

    await fireEvent(first, 'longPress');
    expect(screen.getAllByTestId('campaign-card-preview', { includeHiddenElements: true })).toHaveLength(1);
    await fireEvent(second, 'longPress');
    expect(screen.getAllByTestId('campaign-card-preview', { includeHiddenElements: true })).toHaveLength(1);
    expect(currentPreview()).toBe('campaign-cover:aysel/water-filter');

    // The first card's late release does not stop the second card's preview.
    await fireEvent(first, 'pressOut');
    expect(currentPreview()).toBe('campaign-cover:aysel/water-filter');
    await fireEvent(second, 'pressOut');
    expect(currentPreview()).toBeNull();
  });

  it('never plays under Reduce Motion, and does not offer to', async () => {
    await renderCards([CARD], 'none');
    const card = screen.getByRole('link');
    expect(card.props.accessibilityHint).toBeUndefined();
    await fireEvent(card, 'longPress');
    expect(screen.queryByTestId('campaign-card-preview', { includeHiddenElements: true })).toBeNull();
    expect(players).toHaveLength(0);
  });
});

describe('a campaign card without a video', () => {
  it('keeps its uploaded cover and has nothing to preview', async () => {
    const { video: _video, ...plain } = CARD;
    await renderCards([plain as Card]);
    expect(coverSources()).toContainEqual({ uri: 'https://cdn.example/cover.jpg' });
    const card = screen.getByRole('link');
    expect(card.props.accessibilityHint).toBeUndefined();
    await fireEvent(card, 'longPress');
    expect(players).toHaveLength(0);
  });
});
