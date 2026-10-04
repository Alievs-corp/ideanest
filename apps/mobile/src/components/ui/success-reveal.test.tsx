import type { ReactElement, ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { AccessibilityInfo, View } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { MotionBudgetProvider, useReducedMotion } from './motion-budget';
import {
  REVEAL_TOTAL_MS,
  SuccessReveal,
  TICK_PATH,
  coverScale,
  dashLength,
  polylineLength,
} from './success-reveal';

/**
 * `SuccessReveal` (#280): nothing until it is told the server confirmed, a circle that grows to
 * cover the screen, the success haptic when it lands, a tap anywhere to close, and the final screen
 * at once under Reduce Motion.
 */

const TITLE = '45.00 AZN';
const CAPTION = en.checkout.returned.paidTitle;

function English({ children }: { children: ReactNode }) {
  return (
    <IntlProvider locale="en" messages={en}>
      {children}
    </IntlProvider>
  );
}

const renderEn = (ui: ReactElement) => render(ui, { wrapper: English });

function circleScale(): number {
  const style = getAnimatedStyle(screen.getByTestId('success-reveal-circle') as never) as {
    transform?: { scale?: number }[];
  };
  return style.transform?.[0]?.scale ?? 0;
}

/** Holds the shared Reduce Motion reading open, and says when it has arrived. */
function ReducedProbe() {
  return useReducedMotion() ? <View testID="reduced" /> : null;
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe('geometry', () => {
  it('fits the skill’s 700ms ceiling', () => {
    expect(REVEAL_TOTAL_MS).toBeLessThanOrEqual(700);
  });

  it('draws along the Iconsax tick, measured from its own path', () => {
    expect(TICK_PATH.startsWith('m')).toBe(true);
    expect(polylineLength('m0 0 3 4')).toBe(5);
    expect(polylineLength(TICK_PATH)).toBeCloseTo(12.01, 1);
    expect(() => polylineLength('M0 0 C1 1 2 2 3 3')).toThrow();
  });

  it('falls back to drawing the check whole when the glyph changes shape, instead of throwing', () => {
    expect(dashLength(TICK_PATH)).toBeCloseTo(12.01, 1);
    expect(dashLength('M0 0 C1 1 2 2 3 3')).toBeNull();
    expect(dashLength('')).toBeNull();
  });

  it('scales the circle until it reaches the farthest corner from where it starts', () => {
    // From the centre of a 300 × 400 window the farthest corner is 250 away: a 100pt circle × 5.
    expect(coverScale({ x: 150, y: 200 }, 300, 400, 100)).toBeCloseTo(5);
    // From a corner, the opposite corner: 500 away.
    expect(coverScale({ x: 0, y: 0 }, 300, 400, 100)).toBeCloseTo(10);
  });
});

describe('SuccessReveal', () => {
  it('draws nothing until it is shown', async () => {
    await renderEn(<SuccessReveal visible={false} title={TITLE} caption={CAPTION} onClose={() => undefined} />);
    expect(screen.queryByTestId('success-reveal')).toBeNull();
    expect(jest.mocked(Haptics.notificationAsync)).not.toHaveBeenCalled();
  });

  it('grows the circle to cover the screen, then gives the success haptic once', async () => {
    await renderEn(<SuccessReveal visible title={TITLE} caption={CAPTION} onClose={() => undefined} />);
    expect(screen.getByTestId('success-reveal')).toBeTruthy();
    expect(jest.mocked(Haptics.notificationAsync)).not.toHaveBeenCalled();

    await waitFor(() => expect(jest.mocked(Haptics.notificationAsync)).toHaveBeenCalledWith('success'), {
      timeout: 3000,
    });
    await waitFor(() => expect(circleScale()).toBeGreaterThan(1), { timeout: 3000 });
    expect(jest.mocked(Haptics.notificationAsync)).toHaveBeenCalledTimes(1);
  });

  it('is one button to a screen reader, named by what it says', async () => {
    await renderEn(<SuccessReveal visible title={TITLE} caption={CAPTION} onClose={() => undefined} />);
    const whole = screen.getByRole('button', { name: `${TITLE}. ${CAPTION}` });
    expect(whole.props.accessibilityHint).toBe(en.mobile.kitMoney.tapToClose);
    expect(screen.getByText(en.mobile.kitMoney.tapToClose, { includeHiddenElements: true })).toBeTruthy();
  });

  it('still gives the success haptic, once, when closed before the circle lands', async () => {
    const tree = (shown: boolean) => (
      <SuccessReveal visible={shown} title={TITLE} caption={CAPTION} onClose={() => undefined} />
    );
    const view = await renderEn(tree(true));
    expect(jest.mocked(Haptics.notificationAsync)).not.toHaveBeenCalled();
    await view.rerender(tree(false));
    expect(jest.mocked(Haptics.notificationAsync)).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, REVEAL_TOTAL_MS + 200));
    expect(jest.mocked(Haptics.notificationAsync)).toHaveBeenCalledTimes(1);
  });

  it('gives the haptic once in all when it lands and is then closed', async () => {
    const tree = (shown: boolean) => (
      <SuccessReveal visible={shown} title={TITLE} caption={CAPTION} onClose={() => undefined} />
    );
    const view = await renderEn(tree(true));
    await waitFor(() => expect(jest.mocked(Haptics.notificationAsync)).toHaveBeenCalled(), { timeout: 3000 });
    await view.rerender(tree(false));
    expect(jest.mocked(Haptics.notificationAsync)).toHaveBeenCalledTimes(1);
  });

  it('closes on a tap anywhere', async () => {
    const onClose = jest.fn();
    await renderEn(<SuccessReveal visible title={TITLE} caption={CAPTION} onClose={onClose} />);
    await fireEvent.press(screen.getByTestId('success-reveal'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('with motion off, is the final screen at once, haptic included', async () => {
    await renderEn(
      <MotionBudgetProvider level="none">
        <SuccessReveal visible title={TITLE} caption={CAPTION} onClose={() => undefined} />
      </MotionBudgetProvider>,
    );
    expect(jest.mocked(Haptics.notificationAsync)).toHaveBeenCalledWith('success');
    expect(circleScale()).toBeGreaterThan(1);
    const title = screen.getByTestId('success-reveal-title', { includeHiddenElements: true });
    expect(title).toHaveTextContent(TITLE);
    expect(getAnimatedStyle(title as never)).not.toHaveProperty('opacity', 0);
  });

  it('with Reduce Motion on, shows the final screen at once', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const tree = (shown: boolean) => (
      <>
        <ReducedProbe />
        <SuccessReveal visible={shown} title={TITLE} caption={CAPTION} onClose={() => undefined} />
      </>
    );
    const view = await renderEn(tree(false));
    await waitFor(() => expect(screen.getByTestId('reduced')).toBeTruthy());
    await view.rerender(tree(true));
    // At once: no waiting for a circle to land.
    expect(jest.mocked(Haptics.notificationAsync)).toHaveBeenCalledWith('success');
    expect(circleScale()).toBeGreaterThan(1);
  });
});
