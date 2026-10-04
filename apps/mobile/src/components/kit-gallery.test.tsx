import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import KitGalleryRoute from '../app/dev/kit';

/**
 * The kit gallery — issue #151: every component on one development screen, and nothing at all in
 * a release build, where the route redirects to `+not-found`.
 *
 * <p>Here rather than beside `app/dev/kit.tsx` because every file under `src/app` is a route to
 * Expo Router, and a test file there would be offered as a screen.
 */

jest.mock('expo-router', () => {
  const { createElement } = require('react');
  const { Text } = require('react-native');
  return {
    // What the redirect is to, as text a test can read.
    Redirect: ({ href }: { href: string }) => createElement(Text, { testID: 'redirect' }, href),
    Stack: Object.assign(() => null, { Screen: () => null }),
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  };
});

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/* Every kit component in one tree, and the first render pays for loading all of them. */
jest.setTimeout(30_000);

function inApp(ui: ReactNode) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="en" messages={en}>
        {ui}
      </IntlProvider>
    </SafeAreaProvider>,
  );
}

/** React Native's `__DEV__` global, which the route reads when it renders. */
const runtime = globalThis as unknown as { __DEV__: boolean };
const dev = runtime.__DEV__;
afterEach(() => {
  runtime.__DEV__ = dev;
});

describe('the kit gallery', () => {
  it('shows every section of the barrel in a development build', async () => {
    runtime.__DEV__ = true;
    await inApp(<KitGalleryRoute />);

    expect(screen.queryByTestId('redirect')).toBeNull();
    // The sections are headed by the components' own names, in the barrel's order.
    for (const heading of [
      'Icon',
      'PressableScale',
      'AnimatedAmount',
      'accent',
      'Pill',
      'SegmentedPill',
      'AmountKeypad',
      'SwipeToConfirm',
      'IconButton',
      'Tag',
      'Chip · ChipRow · RemovableChip',
      'Card',
      'AccentCard',
      'HeroFigure',
      'AvatarStack · SourceDot',
      'Avatar',
      'ProgressBar',
      'StatBlock · StatRow',
      'FloatingPanel',
      'InlineAlert',
      'EmptyState · ErrorState',
      'Skeleton · SkeletonGroup · SkeletonCard',
      'Media · MediaFrame',
      'EdgeFade',
      'Screen',
      'Field · TextInput · PasswordInput · Textarea · CharacterCount',
      'Select · Checkbox · Radio · Switch',
      'FilePicker · SearchField',
      'Dialog · Sheet · SuccessReveal',
    ]) {
      // At least one: a panel titled with its own name (FloatingPanel) is a second header.
      expect(screen.getAllByRole('header', { name: heading }).length).toBeGreaterThan(0);
    }

    // A sample of the variants: every pill variant and size (the icon buttons share some of these
    // names — `accent sm` is both), busy and disabled among them.
    for (const variant of ['primary', 'accent', 'ghost', 'outline', 'danger']) {
      for (const size of ['sm', 'md', 'lg']) {
        const name = `${variant} ${size}`;
        expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
        // The pill's own visible label; an icon button draws no text.
        expect(screen.getByText(name, { includeHiddenElements: true })).toBeTruthy();
      }
    }
    expect(
      screen
        .getAllByRole('button', { name: 'accent' })
        .some((pill) => pill.props.accessibilityState?.busy),
    ).toBe(true);
    for (const value of [0, 42, 100, 340]) {
      expect(screen.getByRole('progressbar', { name: `ProgressBar ${value}` })).toBeTruthy();
    }
    expect(screen.getByRole('switch', { name: en.mobile.lock.face, checked: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dialog' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sheet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'SuccessReveal' })).toBeTruthy();
    // #280: the keypad's keys, and the swipe as a named button with its activate action.
    expect(screen.getByRole('keyboardkey', { name: en.mobile.kitMoney.backspace })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.mobile.kitMoney.divide })).toBeTruthy();
    expect(screen.getByTestId('swipe-to-confirm').props.accessibilityActions).toEqual([{ name: 'activate' }]);
    expect(screen.getByTestId('swipe-to-confirm-disabled')).toBeDisabled();
    // #282 retired the dark sheet: there is one sheet, and it is white.
    expect(screen.queryByRole('button', { name: 'Sheet · dark' })).toBeNull();
    expect(screen.getAllByRole('radio', { name: en.mobile.tabs.home, checked: true })).toHaveLength(2);
    for (const name of ['sun', 'mint', 'sky']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('redirects to not-found in a release build, drawing none of the kit', async () => {
    runtime.__DEV__ = false;
    await inApp(<KitGalleryRoute />);

    expect(screen.getByTestId('redirect')).toHaveTextContent('/+not-found');
    expect(screen.queryByRole('header')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
