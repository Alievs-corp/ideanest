import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { getAnimatedStyle } from 'react-native-reanimated';
import { colors } from '../../theme';
import { MotionBudgetProvider, type MotionLevel } from './motion-budget';
import {
  ARRIVAL_WINDOW_MS,
  LANDED_POINTS,
  landingEnergy,
  SharedTarget,
  SharedTransitionHost,
  sharedMeasure,
  useSharedArrival,
  useSharedSnapshot,
  useSharedSource,
  useSharedTargetDisplay,
  type SharedFrame,
} from './shared-transition';

/**
 * The measured-overlay shared element (#279). The test renderer never calls a `measureInWindow`
 * callback, so `sharedMeasure.inWindow` answers from a table keyed by the measured view's testID:
 * the card at the top left, the page cover full width further down.
 */

type MockListener = { event: string; callback: (event?: unknown) => void };
const mockListeners: MockListener[] = [];
jest.mock('expo-router', () => ({
  useNavigation: () => ({
    addListener: (event: string, callback: (event?: unknown) => void) => {
      const entry = { event, callback };
      mockListeners.push(entry);
      return () => {
        const index = mockListeners.indexOf(entry);
        if (index >= 0) mockListeners.splice(index, 1);
      };
    },
  }),
}));

/** Emits a navigation event to every listener for it, then lets the deferred work run. */
async function emit(event: string, payload?: unknown) {
  await act(async () => {
    mockListeners.filter((entry) => entry.event === event).forEach((entry) => entry.callback(payload));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

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
  pageKey = 'page',
}: {
  readonly level?: MotionLevel;
  readonly showCard?: boolean;
  readonly cardTag?: string;
  readonly pageKey?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <MotionBudgetProvider level={level}>
      <SharedTransitionHost>
        {showCard ? <Card tag={cardTag} onOpen={() => setOpen(true)} /> : null}
        {open ? <Page key={pageKey} /> : null}
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

    await emit('beforeRemove', {});
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

    await emit('beforeRemove', {});

    // No measuring and no restart from the page: the same frames, heading back to the card.
    expect(screen.getByTestId('shared-clone')).toBeTruthy();
    expect(cloneTransform().scaleX).toBeLessThan(1);
    expect(Math.abs((cloneTransform().scaleX ?? 1) - midway)).toBeLessThan(0.5);
    await waitFor(() => expect(screen.queryByTestId('shared-clone')).toBeNull(), { timeout: 3000 });
    expect(opacity('card')).toBe(1);
  });

  it('goes back plainly when the card was recycled for another campaign', async () => {
    const { rerender } = await render(<App />);
    await openPage();
    await waitFor(() => expect(screen.queryByTestId('shared-clone')).toBeNull(), { timeout: 3000 });

    await rerender(<App cardTag="campaign-cover:someone/else" />);
    await emit('beforeRemove', {});
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
    await emit('beforeRemove', {});
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

  it('still counts as arrived for a page that remounts just after the landing', async () => {
    const { rerender } = await render(<App />);
    await openPage();
    await waitFor(() => expect(screen.queryByTestId('shared-clone')).toBeNull(), { timeout: 3000 });

    // The loading cover is swapped for the real page: it must not rise in after the flight.
    await rerender(<App pageKey="remounted" />);
    expect(screen.getByTestId('arriving')).toHaveTextContent('true');
    expect(opacity('page')).toBe(1);
  });

  it('does not fly back when the page was closed natively', async () => {
    await render(<App />);
    await openPage();
    await waitFor(() => expect(screen.queryByTestId('shared-clone')).toBeNull(), { timeout: 3000 });

    // A swipe or the iOS header's back: the closing transition runs first, the removal after it.
    await emit('transitionStart', { data: { closing: true } });
    await emit('beforeRemove', {});

    expect(screen.queryByTestId('shared-clone')).toBeNull();
    expect(opacity('card')).toBe(1);
  });

  it('does not fly back when another listener prevents the removal', async () => {
    await render(<App />);
    await openPage();
    await waitFor(() => expect(screen.queryByTestId('shared-clone')).toBeNull(), { timeout: 3000 });

    await emit('beforeRemove', { defaultPrevented: true });

    expect(screen.queryByTestId('shared-clone')).toBeNull();
    expect(opacity('page')).toBe(1);
  });

  it('gives a replaced flight its card back', async () => {
    frames.second = { x: 200, y: 300, width: 160, height: 90 };
    function Two() {
      const [open, setOpen] = useState<string | null>(null);
      return (
        <MotionBudgetProvider level="full">
          <SharedTransitionHost>
            <Card onOpen={() => setOpen(TAG)} />
            <Second onOpen={() => setOpen('campaign-cover:other/lamp')} />
            {open === null ? null : <Page key={open} tag={open} />}
          </SharedTransitionHost>
        </MotionBudgetProvider>
      );
    }
    function Second({ onOpen }: { readonly onOpen: () => void }) {
      const shared = useSharedSource('campaign-cover:other/lamp', SNAPSHOT);
      return (
        <Pressable
          testID="press-second"
          onPress={() => {
            shared.launch();
            onOpen();
          }}
        >
          <Animated.View {...shared.props} testID="second" />
        </Pressable>
      );
    }

    await render(<Two />);
    await openPage();
    await waitFor(() => expect(opacity('card')).toBe(0));

    // A second card is pressed while the first flight is still in the air.
    await fireEvent.press(screen.getByTestId('press-second'));
    await act(async () => {
      await Promise.resolve();
    });
    await fireEvent(screen.getByTestId('page'), 'layout', { nativeEvent: { layout: PAGE } });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(opacity('card')).toBe(1));
    await waitFor(() => expect(screen.queryByTestId('shared-clone')).toBeNull(), { timeout: 3000 });
    expect(opacity('second')).toBe(1);
    delete frames.second;
  });

  it('holds the clone until the page picture is drawn', async () => {
    let draw: (() => void) | undefined;
    function Picture() {
      draw = useSharedTargetDisplay();
      return <Text>cover</Text>;
    }
    function Waiting() {
      const [open, setOpen] = useState(false);
      return (
        <MotionBudgetProvider level="full">
          <SharedTransitionHost>
            <Card onOpen={() => setOpen(true)} />
            {open ? (
              <SharedTarget tag={TAG} testID="page" waitForDisplay>
                <Picture />
              </SharedTarget>
            ) : null}
          </SharedTransitionHost>
        </MotionBudgetProvider>
      );
    }

    await render(<Waiting />);
    await openPage();
    await waitFor(() => expect(opacity('card')).toBe(0));
    // Landed, but the page's picture is not drawn: the clone stays over the empty frame.
    await waitFor(() => expect(cloneTransform().scaleX).toBeCloseTo(1, 2), { timeout: 3000 });
    expect(screen.getByTestId('shared-clone')).toBeTruthy();

    await act(async () => draw?.());
    await waitFor(() => expect(screen.queryByTestId('shared-clone')).toBeNull());
    expect(opacity('page')).toBe(1);
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

describe('landingEnergy', () => {
  it('stops the spring within half a point of its end', () => {
    // Energy goes with the square of the distance left, so the ratio is the distance ratio squared.
    expect(landingEnergy(400)).toBeCloseTo((0.5 / 400) ** 2, 12);
    expect(Math.sqrt(landingEnergy(400)) * 400).toBeCloseTo(LANDED_POINTS, 6);
  });

  it('lands at once when there is nowhere to go', () => {
    expect(landingEnergy(0)).toBe(1);
    expect(landingEnergy(0.25)).toBe(1);
  });

  it('is far looser than Reanimated’s default for any flight on a phone screen', () => {
    expect(landingEnergy(3000)).toBeGreaterThan(6e-9);
  });
});

describe('SharedTransition landing', () => {
  it('removes the clone back over the card soon after it arrives, not a second later', async () => {
    await render(<App />);
    await openPage();
    await waitFor(() => expect(screen.queryByTestId('shared-clone')).toBeNull(), { timeout: 3000 });

    await emit('beforeRemove', {});
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(opacity('card')).toBe(0));
    const flying = Date.now();

    await waitFor(() => expect(screen.queryByTestId('shared-clone')).toBeNull(), { timeout: 3000 });
    expect(Date.now() - flying).toBeLessThan(850);
    expect(opacity('card')).toBe(1);
  });

  it('gives the card its cover back the moment a finger touches the screen', async () => {
    await render(<App />);
    await openPage();
    await waitFor(() => expect(screen.queryByTestId('shared-clone')).toBeNull(), { timeout: 3000 });

    await emit('beforeRemove', {});
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(opacity('card')).toBe(0));

    // The list under the clone is about to scroll: the clone cannot follow it, so it goes now.
    await fireEvent(screen.getByTestId('enabled'), 'touchStart');
    expect(screen.queryByTestId('shared-clone')).toBeNull();
    expect(opacity('card')).toBe(1);
  });

  it('shows the page cover at once when a finger lands during the flight in', async () => {
    await render(<App />);
    await openPage();
    await waitFor(() => expect(opacity('card')).toBe(0));
    expect(screen.getByTestId('shared-clone')).toBeTruthy();

    await fireEvent(screen.getByTestId('arriving'), 'touchStart');
    expect(screen.queryByTestId('shared-clone')).toBeNull();
    expect(opacity('page')).toBe(1);
    expect(opacity('card')).toBe(1);
  });

  it('does not fly back when a finger lands while the card is being measured', async () => {
    await render(<App />);
    await openPage();
    await waitFor(() => expect(screen.queryByTestId('shared-clone')).toBeNull(), { timeout: 3000 });

    let release: (() => void) | undefined;
    jest.spyOn(sharedMeasure, 'inWindow').mockImplementation((node) => {
      const id = testIdOf(node) ?? '';
      if (id !== 'card') return Promise.resolve(frames[id] ?? null);
      return new Promise((resolve) => {
        release = () => resolve(frames.card ?? null);
      });
    });

    await emit('beforeRemove', {});
    // The list starts to scroll before the card's frame comes back.
    await fireEvent(screen.getByTestId('enabled'), 'touchStart');
    await act(async () => {
      release?.();
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });

    expect(screen.queryByTestId('shared-clone')).toBeNull();
    expect(opacity('card')).toBe(1);
  });

  it('ignores a touch when nothing is flying', async () => {
    await render(<App />);
    await fireEvent(screen.getByTestId('enabled'), 'touchStart');
    expect(screen.queryByTestId('shared-clone')).toBeNull();
    expect(opacity('card')).toBe(1);
  });
});
