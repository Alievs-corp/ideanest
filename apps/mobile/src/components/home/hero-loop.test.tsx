import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as ExpoVideo from 'expo-video';
import { HERO_LOOP } from '@ideanest/messages/hero-loop';
import { MotionBudgetProvider } from '../ui';
import { HeroLoopCard, type HeroLines } from './hero-loop';

let mockFocused = true;
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));

let mockWindow = { width: 390, height: 844 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ ...mockWindow, scale: 3, fontScale: 1 }),
}));

const players = (ExpoVideo as unknown as {
  __players: { source: unknown; play: jest.Mock; pause: jest.Mock; loop: boolean; muted?: boolean }[];
}).__players;

const LINES: HeroLines = [
  'A creator shares an idea with a goal and a deadline',
  'Backers join in from every side',
  'At 80% of its goal, the campaign succeeds',
  'When small pledges come together, big ideas become real.',
];
/** The lines are hidden from the screen reader, so a query has to ask for hidden elements. */
const HIDDEN = { includeHiddenElements: true };
const LABEL = 'Creators publish a campaign with a goal and a deadline.';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

async function mount(wrap: (card: ReactElement) => ReactElement = (card) => card) {
  return await render(
    <SafeAreaProvider initialMetrics={METRICS}>{wrap(<HeroLoopCard lines={LINES} label={LABEL} />)}</SafeAreaProvider>,
  );
}

beforeEach(() => {
  mockFocused = true;
  mockWindow = { width: 390, height: 844 };
  players.length = 0;
});

describe('HeroLoopCard (#490)', () => {
  it('is one image named by the standfirst, over the square loop and its poster', async () => {
    await mount();

    const card = screen.getByTestId('hero-loop');
    expect(card.props.accessibilityRole).toBe('image');
    expect(card.props.accessibilityLabel).toBe(LABEL);
    expect(screen.getByTestId('hero-loop-poster').props.source).toEqual({ uri: HERO_LOOP.phone.posterUrl });
    expect(screen.getByTestId('hero-loop-video')).toBeTruthy();
  });

  it('plays the phone cut silently on a loop while Home is in front', async () => {
    await mount();

    const player = players.at(-1);
    expect(player?.source).toBe(HERO_LOOP.phone.url);
    expect(player?.loop).toBe(true);
    expect(player?.muted).toBe(true);
    expect(player?.play).toHaveBeenCalled();
  });

  it('pauses when another screen covers Home', async () => {
    mockFocused = false;
    await mount();

    const player = players.at(-1);
    expect(player?.play).not.toHaveBeenCalled();
    expect(player?.pause).toHaveBeenCalled();
  });

  it('plays the four lines, each hidden from the screen reader', async () => {
    await mount();

    LINES.forEach((line, index) => {
      const node = screen.getByTestId(`hero-loop-line-${index}`, HIDDEN);
      expect(node.props.children).toBe(line);
      expect(node.props.importantForAccessibility).toBe('no');
    });
  });

  it('keeps the poster and the last line still when motion is off, and opens no stream', async () => {
    await mount((card) => <MotionBudgetProvider level="none">{card}</MotionBudgetProvider>);

    expect(screen.queryByTestId('hero-loop-video')).toBeNull();
    expect(screen.queryByTestId('hero-loop-line-0', HIDDEN)).toBeNull();
    expect(screen.getByTestId('hero-loop-still', HIDDEN).props.children).toBe(LINES[3]);
    expect(players.at(-1)?.source).toBeNull();
  });

  it('is square, and the full width between the gutters on a tall phone', async () => {
    await mount();

    expect(sideOf()).toEqual({ width: 350, height: 350 });
  });

  it('shrinks on a short phone so the actions under it stay on the first screen', async () => {
    mockWindow = { width: 390, height: 640 };
    await mount();

    const { width, height } = sideOf();
    expect(width).toBe(height);
    expect(width).toBeLessThan(350);
    expect(width).toBeGreaterThanOrEqual(260);
  });
});

function sideOf(): { width: number; height: number } {
  const parts = [screen.getByTestId('hero-loop').props.style].flat() as Record<string, unknown>[];
  const sized = parts.find((part) => part !== null && typeof part === 'object' && 'width' in part);
  return { width: sized?.width as number, height: sized?.height as number };
}
