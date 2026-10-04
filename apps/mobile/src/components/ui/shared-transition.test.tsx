import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { getAnimatedStyle } from 'react-native-reanimated';
import { colors } from '../../theme';
import { MotionBudgetProvider, type MotionLevel } from './motion-budget';
import {
  ARRIVAL_WINDOW_MS,
  SharedTarget,
  SharedTransitionHost,
  sharedMeasure,
  useSharedArrival,
  useSharedSnapshot,
  useSharedSource,
  type SharedFrame,
} from './shared-transition';

/**
 * The measured-overlay shared element (#279). The test renderer never calls a `measureInWindow`
 * callback, so `sharedMeasure.inWindow` answers from a table keyed by the measured view's testID:
 * the card at the top left, the page cover full width further down.
 */

const mockListeners: Array<() => void> = [];
jest.mock('expo-router', () => ({
  useNavigation: () => ({
    addListener: (_event: string, callback: () => void) => {
      mockListeners.push(callback);
      return () => {
        const index = mockListeners.indexOf(callback);
        if (index >= 0) mockListeners.splice(index, 1);
      };
    },
  }),
}));

const CARD: SharedFrame = { x: 16, y: 300, width: 160, height: 90 };
const PAGE: SharedFrame = { x: 0, y: 100, width: 400, height: 225 };
const frames: Record<string, SharedFrame | null> = { card: CARD, page: PAGE };

function testIdOf(node: unknown): string | undefined {
  const candidate = node as {
    props?: { testID?: string };
    _componentRef?: { props?: { testID?: string } };
  } | null;
  return candidate?.props?.testID ?? candidate?._componentRef?.props?.testID;
}

beforeEach(() => {
  mockListeners.length = 0;
  frames.card = CARD;
  frames.page = PAGE;
  jest
    .spyOn(sharedMeasure, 'inWindow')
    .mockImplementation(async (node) => frames[testIdOf(node) ?? ''] ?? null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const TAG = 'campaign-cover:maker/desk';
const SNAPSHOT = { uri: 'https://example.test/cover.jpg', radius: 16, background: colors.surface3 };

function Card({ tag = TAG, onOpen }: { readonly tag?: string; readonly onOpen: () => void }) {
  const shared = useSharedSource(tag, SNAPSHOT);
  return (
    <Pressable
      testID="press"
      onPress={() => {
        shared.launch();
        onOpen();
      }}
    >
      <Text testID="enabled">{String(shared.enabled)}</Text>
      <Animated.View {...shared.props} testID="card" />
    </Pressable>
  );
}

function Page({ tag = TAG }: { readonly tag?: string }) {
  const arriving = useSharedArrival(tag);
  const snapshot = useSharedSnapshot(tag);
  return (
    <>
      <Text testID="arriving">{String(arriving)}</Text>
      <Text testID="snapshot">{snapshot?.uri ?? 'none'}</Text>
      <SharedTarget tag={tag} testID="page">
        <Text>cover</Text>
      </SharedTarget>
    </>
  );
}

function App({
  level = 'full',
  showCard = true,
  cardTag = TAG,
}: {
  readonly level?: MotionLevel;
  readonly showCard?: boolean;
  readonly cardTag?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <MotionBudgetProvider level={level}>
      <SharedTransitionHost>
        {showCard ? <Card tag={cardTag} onOpen={() => setOpen(true)} /> : null}
        {open ? <Page /> : null}
        <Pressable testID="close" onPress={() => setOpen(false)} />
      </SharedTransitionHost>
    </MotionBudgetProvider>
  );
}

function opacity(testID: string): unknown {
  return (getAnimatedStyle(screen.getByTestId(testID) as never) as { opacity?: number }).opacity;
}

function cloneTransform(): Record<string, number> {
  const style = getAnimatedStyle(screen.getByTestId('shared-clone') as never) as {
    transform?: Array<Record<string, number>>;
  };
  return Object.assign({}, ...(style.transform ?? []));
}

async function openPage() {
  await fireEvent.press(screen.getByTestId('press'));
  await act(async () => {
    await Promise.resolve();
  });
  await fireEvent(screen.getByTestId('page'), 'layout', { nativeEvent: { layout: PAGE } });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('SharedTransition', () => {
  it('flies the card to the page and hands over to the real cover when it lands', async () => {
    await render(<App />);
    expect(screen.getByTestId('enabled')).toHaveTextContent('true');

    await openPage();

    expect(screen.getByTestId('arriving')).toHaveTextContent('true');
    expect(screen.getByTestId('snapshot')).toHaveTextContent(SNAPSHOT.uri);
    const clone = screen.getByTestId('shared-clone');
    const box = StyleSheet.flatten(clone.props.style as never) as Record<string, number>;
    expect([box.left, box.top, box.width, box.height]).toEqual([
      PAGE.x,
      PAGE.y,
      PAGE.width,
      PAGE.height,
    ]);
    // It starts over the card: scaled down to the card's width, centred on it.
    const start = cloneTransform();
    expect(start.scaleX).toBeCloseTo(CARD.width / PAGE.width, 2);
    expect(start.translateX).toBeCloseTo(CARD.x + CARD.width / 2 - (PAGE.x + PAGE.width / 2), 1);
    expect(opacity('page')).toBe(0);
    // The card stays until the clone's picture is drawn, so the swap never shows an empty box.
    expect(opacity('card')).toBe(1);
    await waitFor(() => expect(opacity('card')).toBe(0));

    await waitFor(() => expect(screen.queryByTestId('shared-clone')).toBeNull(), { timeout: 3000 });
    expect(opacity('page')).toBe(1);
    expect(opacity('card')).toBe(1);
  });

  it('flies back to the card when the page is removed', async () => {
    await render(<App />);
    await openPage();
    await waitFor(() => expect(screen.queryByTestId('shared-clone')).toBeNull(), { timeout: 3000 });

    await act(() => mockListeners.forEach((listener) => listener()));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('shared-clone')).toBeTruthy();
    expect(cloneTransform().scaleX).toBeCloseTo(1, 2);
    await waitFor(() => expect(opacity('card')).toBe(0));
    expect(opacity('page')).toBe(0);

    await waitFor(() => expect(screen.queryByTestId('shared-clone')).toBeNull(), { timeout: 3000 });
    expect(opacity('card')).toBe(1);
  });

  it('turns round from where the clone is when the page is left mid-flight', async () => {
    await render(<App />);
    await openPage();
    await waitFor(() => expect(opacity('card')).toBe(0));
    const midway = cloneTransform().scaleX ?? 1;

    await act(() => mockListeners.forEach((listener) => listener()));

    // No measuring and no restart from the page: the same frames, heading back to the card.
    expect(screen.getByTestId('shared-clone')).toBeTruthy();
    expect(cloneTransform().scaleX).toBeLessThan(1);
    expect(Math.abs((cloneTransform().scaleX ?? 1) - midway)).toBeLessThan(0.5);
    await waitFor(() => expect(screen.queryByTestId('shared-clone')).toBeNull(), { timeout: 3000 });
    expect(opacity('card')).toBe(1);
    expect(opacity('page')).toBe(0);
  });

  it('goes back plainly when the card was recycled for another campaign', async () => {
    const { rerender } = await render(<App />);
    await openPage();
    await waitFor(() => expect(screen.queryByTestId('shared-clone')).toBeNull(), { timeout: 3000 });

    await rerender(<App cardTag="campaign-cover:someone/else" />);
    await act(() => mockListeners.forEach((listener) => listener()));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId('shared-clone')).toBeNull();
  });

  it('uses the frame from the press when the card can no longer be measured', async () => {
    await render(<App />);
    await openPage();
    await waitFor(() => expect(screen.queryByTestId('shared-clone')).toBeNull(), { timeout: 3000 });

    frames.card = null;
    await act(() => mockListeners.forEach((listener) => listener()));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('shared-clone')).toBeTruthy();
  });

  it('navigates plainly under Reduce Motion', async () => {
    await render(<App level="none" />);
    expect(screen.getByTestId('enabled')).toHaveTextContent('false');

    await openPage();

    expect(screen.queryByTestId('shared-clone')).toBeNull();
    expect(screen.getByTestId('arriving')).toHaveTextContent('false');
    expect(opacity('page')).toBe(1);
  });

  it('drops the flight when the page arrives after the window', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    await render(<App />);
    await fireEvent.press(screen.getByTestId('press'));
    await act(async () => {
      await Promise.resolve();
    });

    now.mockReturnValue(1_000 + ARRIVAL_WINDOW_MS + 1);
    await fireEvent(screen.getByTestId('page'), 'layout', { nativeEvent: { layout: PAGE } });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId('shared-clone')).toBeNull();
    await waitFor(() => expect(opacity('page')).toBe(1));
  });

  it('shows the page cover when the page cannot be measured', async () => {
    frames.page = null;
    await render(<App />);
    await openPage();

    expect(screen.queryByTestId('shared-clone')).toBeNull();
    await waitFor(() => expect(opacity('page')).toBe(1));
    expect(opacity('card')).toBe(1);
  });

  it('draws nothing outside a host', async () => {
    function Lone() {
      const shared = useSharedSource(TAG, SNAPSHOT);
      return <Text testID="lone">{String(shared.enabled)}</Text>;
    }
    await render(
      <>
        <Lone />
        <SharedTarget tag={TAG} testID="page">
          <Text>cover</Text>
        </SharedTarget>
      </>,
    );
    expect(screen.getByTestId('lone')).toHaveTextContent('false');
    expect(opacity('page')).toBe(1);
  });
});
