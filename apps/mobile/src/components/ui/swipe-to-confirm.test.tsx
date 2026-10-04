import { useState, type ReactElement, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { AccessibilityInfo, Platform } from 'react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { getAnimatedStyle } from 'react-native-reanimated';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { colors } from '../../theme';
import { MotionBudgetProvider } from './motion-budget';
import { SWIPE_COMMIT, SwipeToConfirm, swipeCommits, swipeProgress } from './swipe-to-confirm';

/**
 * `SwipeToConfirm` (#280): the thumb follows the pan and commits past the line, the amount turns
 * to its success layer with it, it is operable without the gesture, and it sends once per request.
 */

const LABEL = en.mobile.checkout.swipeToPay;
const ACTION = en.checkout.review.confirm;
const TRACK = 300;
/** The track's width less the thumb and its inset on both sides. */
const TRAVEL = TRACK - 48 - 8;

function English({ children }: { children: ReactNode }) {
  return (
    <IntlProvider locale="en" messages={en}>
      {children}
    </IntlProvider>
  );
}

const renderEn = (ui: ReactElement) => render(ui, { wrapper: English });

async function measure() {
  await fireEvent(screen.getByTestId('swipe-to-confirm'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: TRACK, height: 56 } },
  });
}

async function drag(to: number) {
  await act(async () => {
    fireGestureHandler(getByGestureTestId('swipe-to-confirm-pan'), [
      { translationX: 0 },
      { translationX: to / 2 },
      { translationX: to },
    ]);
  });
}

function translateX(): number {
  const style = getAnimatedStyle(screen.getByTestId('swipe-to-confirm-thumb') as never) as {
    transform?: { translateX?: number }[];
  };
  return style.transform?.[0]?.translateX ?? 0;
}

function successOpacity(): number {
  const layer = screen.getByTestId('swipe-to-confirm-success', { includeHiddenElements: true });
  return (getAnimatedStyle(layer as never) as { opacity?: number }).opacity ?? 0;
}

/** The checkout's shape: confirm starts a request, which the test ends by hand. */
function Checkout({ onConfirm }: { readonly onConfirm: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <SwipeToConfirm
        label={LABEL}
        actionLabel={ACTION}
        amount="45.00 AZN"
        busy={busy}
        onConfirm={() => {
          onConfirm();
          setBusy(true);
        }}
      />
      <EndRequest onEnd={() => setBusy(false)} />
    </>
  );
}

let endRequest: () => void = () => undefined;
function EndRequest({ onEnd }: { readonly onEnd: () => void }) {
  endRequest = onEnd;
  return null;
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe('swipe geometry', () => {
  it('commits from 85% of the travel, and never on an unmeasured track', () => {
    expect(SWIPE_COMMIT).toBe(0.85);
    expect(swipeCommits(85, 100)).toBe(true);
    expect(swipeCommits(84, 100)).toBe(false);
    expect(swipeCommits(10, 0)).toBe(false);
    expect(swipeProgress(50, 100)).toBe(0.5);
    expect(swipeProgress(150, 100)).toBe(1);
    expect(swipeProgress(-5, 100)).toBe(0);
  });
});

describe('SwipeToConfirm, by gesture', () => {
  it('is a named button with an activate action and a hint', async () => {
    await renderEn(<SwipeToConfirm label={LABEL} actionLabel={ACTION} onConfirm={() => undefined} />);
    const track = screen.getByRole('button', { name: ACTION });
    expect(track.props.accessibilityHint).toBe(en.mobile.kitMoney.swipeHint);
    expect(track.props.accessibilityActions).toEqual([{ name: 'activate' }]);
    expect(screen.getByText(LABEL, { includeHiddenElements: true })).toBeTruthy();
  });

  it('commits past the line: the thumb settles at the end, a medium impact, the amount in success', async () => {
    const onConfirm = jest.fn();
    await renderEn(<Checkout onConfirm={onConfirm} />);
    await measure();
    await drag(TRAVEL * 0.95);

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(jest.mocked(Haptics.impactAsync)).toHaveBeenCalledWith('medium');
    expect(jest.mocked(Haptics.notificationAsync)).not.toHaveBeenCalled();
    await waitFor(() => expect(translateX()).toBeCloseTo(TRAVEL, 0), { timeout: 3000 });
    await waitFor(() => expect(successOpacity()).toBeCloseTo(1, 1), { timeout: 3000 });
    expect(screen.getByRole('button', { name: ACTION })).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ busy: true }),
    );
  });

  it('springs back short of the line and sends nothing', async () => {
    const onConfirm = jest.fn();
    await renderEn(<Checkout onConfirm={onConfirm} />);
    await measure();
    await drag(TRAVEL * 0.6);

    await waitFor(() => expect(translateX()).toBeCloseTo(0, 0), { timeout: 3000 });
    expect(successOpacity()).toBeCloseTo(0, 1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(jest.mocked(Haptics.impactAsync)).not.toHaveBeenCalled();
  });

  it('holds while the request is in flight, then comes back for a retry', async () => {
    const onConfirm = jest.fn();
    await renderEn(<Checkout onConfirm={onConfirm} />);
    await measure();
    await drag(TRAVEL);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1), { timeout: 3000 });

    // In flight: neither the gesture nor the action sends a second time.
    await drag(TRAVEL);
    await fireEvent(screen.getByTestId('swipe-to-confirm'), 'accessibilityAction', {
      nativeEvent: { actionName: 'activate' },
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await act(async () => endRequest());
    await waitFor(() => expect(translateX()).toBeCloseTo(0, 0), { timeout: 3000 });
    await drag(TRAVEL);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });

  it('returns to the start when the caller does not send', async () => {
    const onConfirm = jest.fn();
    await renderEn(<SwipeToConfirm label={LABEL} actionLabel={ACTION} onConfirm={onConfirm} />);
    await measure();
    await drag(TRAVEL);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await waitFor(() => expect(translateX()).toBeCloseTo(0, 0), { timeout: 3000 });
  });

  it('does nothing while disabled', async () => {
    const onConfirm = jest.fn();
    await renderEn(<SwipeToConfirm label={LABEL} actionLabel={ACTION} onConfirm={onConfirm} disabled />);
    await measure();
    await drag(TRAVEL);
    await fireEvent(screen.getByTestId('swipe-to-confirm'), 'accessibilityAction', {
      nativeEvent: { actionName: 'activate' },
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: ACTION })).toBeDisabled();
  });

  it('keeps the thumb lime with near-black on it, the one urgent surface', async () => {
    await renderEn(<SwipeToConfirm label={LABEL} actionLabel={ACTION} onConfirm={() => undefined} />);
    const thumb = screen.getByTestId('swipe-to-confirm-thumb');
    const style = Object.assign({}, ...[thumb.props.style].flat(3).filter(Boolean));
    expect(style.backgroundColor).toBe(colors.lime500);
  });

  it('with motion off, lands at the end without a spring', async () => {
    const onConfirm = jest.fn();
    await renderEn(
      <MotionBudgetProvider level="none">
        <Checkout onConfirm={onConfirm} />
      </MotionBudgetProvider>,
    );
    await measure();
    await drag(TRAVEL * 0.9);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(translateX()).toBeCloseTo(TRAVEL, 0);
  });
});

describe('SwipeToConfirm, without the gesture', () => {
  it('confirms through the activate action a screen reader or Switch Control performs', async () => {
    const onConfirm = jest.fn();
    await renderEn(<SwipeToConfirm label={LABEL} actionLabel={ACTION} onConfirm={onConfirm} />);
    await fireEvent(screen.getByRole('button', { name: ACTION }), 'accessibilityAction', {
      nativeEvent: { actionName: 'activate' },
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(jest.mocked(Haptics.impactAsync)).toHaveBeenCalledWith('medium');
  });

  it('is an ordinary accent button while a screen reader is on', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const onConfirm = jest.fn();
    await renderEn(
      <SwipeToConfirm label={LABEL} actionLabel={ACTION} amount="45.00 AZN" onConfirm={onConfirm} />,
    );
    await waitFor(() => expect(screen.queryByTestId('swipe-to-confirm-thumb')).toBeNull());

    const button = screen.getByRole('button', { name: ACTION });
    expect(screen.queryByText(LABEL, { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('swipe-to-confirm-amount')).toHaveAccessibleName('45.00 AZN');
    await fireEvent.press(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('is a busy, disabled button while its request is in flight', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    await renderEn(<SwipeToConfirm label={LABEL} actionLabel={ACTION} onConfirm={() => undefined} busy />);
    await waitFor(() => expect(screen.queryByTestId('swipe-to-confirm-thumb')).toBeNull());
    expect(screen.getByRole('button', { name: ACTION })).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ busy: true, disabled: true }),
    );
  });

  it('is a button on Android while an accessibility service such as Switch Access runs', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'isAccessibilityServiceEnabled').mockResolvedValue(true);
    const os = Platform.OS;
    Platform.OS = 'android';
    try {
      await renderEn(<SwipeToConfirm label={LABEL} actionLabel={ACTION} onConfirm={() => undefined} />);
      await waitFor(() => expect(screen.queryByTestId('swipe-to-confirm-thumb')).toBeNull());
      expect(screen.getByRole('button', { name: ACTION })).toBeTruthy();
    } finally {
      Platform.OS = os;
    }
  });
});
