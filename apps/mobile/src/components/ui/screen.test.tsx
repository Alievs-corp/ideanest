import type { ReactElement } from 'react';
import { act, fireEvent, render as renderBare } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, Text, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { Pill } from './pill';
import { Screen } from './screen';

/**
 * The scaffold every screen stands in: the insets and the 20pt sides, pull to refresh with its
 * haptic, one accent per screen, and the fixed order of cached data, error and empty state.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function render(ui: ReactElement) {
  return renderBare(
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="en" messages={en}>
        {ui}
      </IntlProvider>
    </SafeAreaProvider>,
  );
}

const noop = () => {};

/** The scroll view's content container, which is where the padding is. */
function contentStyle(tree: Awaited<ReturnType<typeof render>>): ViewStyle {
  return StyleSheet.flatten(tree.getByTestId('screen').props.contentContainerStyle as ViewStyle);
}

/** The refresh control the scroll view was handed, if any. */
function refreshControlOf(tree: Awaited<ReturnType<typeof render>>) {
  return tree.getByTestId('screen').props.refreshControl as
    ReactElement<{ onRefresh: () => void }> | undefined;
}

describe('Screen', () => {
  describe('the order of the states', () => {
    const error = { title: 'Your pledges did not load', onRetry: noop };
    const empty = <Text>empty</Text>;

    beforeEach(() => jest.clearAllMocks());

    it('shows the content — even an old one — and no full-screen error or empty state', async () => {
      const { getByText, queryByText, queryAllByRole } = await render(
        <Screen hasContent empty={empty}>
          <Text>content</Text>
        </Screen>,
      );
      expect(getByText('content')).toBeTruthy();
      expect(queryByText('empty')).toBeNull();
      expect(queryAllByRole('header')).toHaveLength(0);
    });

    it('says a failed refresh over cached content in a compact alert above it, with a retry', async () => {
      const onRetry = jest.fn();
      const { getByText, toJSON, getByRole } = await render(
        <Screen hasContent error={{ ...error, onRetry }}>
          <Text>cached list</Text>
        </Screen>,
      );
      expect(getByText('cached list')).toBeTruthy();
      expect(getByText(error.title)).toBeTruthy();
      const order = JSON.stringify(toJSON());
      expect(order.indexOf(error.title)).toBeLessThan(order.indexOf('cached list'));

      await fireEvent.press(getByRole('button', { name: en.common.tryAgain }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('shows the full error, not "nothing here", when there is no content', async () => {
      const { getByRole, queryByText } = await render(
        <Screen hasContent={false} error={error} empty={empty} />,
      );
      expect(getByRole('header', { name: error.title })).toBeTruthy();
      expect(queryByText('empty')).toBeNull();
    });

    it('does not mistake a child that is not content for content', async () => {
      // A header, or a list that renders nothing, is a child. Counting children hid the empty state.
      const { getByText } = await render(
        <Screen hasContent={false} empty={empty}>
          <Text>header</Text>
        </Screen>,
      );
      expect(getByText('empty')).toBeTruthy();
    });

    it('puts the offline notice above the cached content', async () => {
      const { toJSON, getByText } = await render(
        <Screen hasContent offlineNotice="These pledges are from your last visit.">
          <Text>cached list</Text>
        </Screen>,
      );
      expect(getByText('These pledges are from your last visit.')).toBeTruthy();
      const order = JSON.stringify(toJSON());
      expect(order.indexOf('These pledges')).toBeGreaterThan(-1);
      expect(order.indexOf('These pledges')).toBeLessThan(order.indexOf('cached list'));
    });

    it('keeps the offline notice polite: read in place, not announced on every mount', async () => {
      const spy = jest
        .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
        .mockImplementation(() => {});
      await render(
        <Screen hasContent offlineNotice="These pledges are from your last visit.">
          <Text>cached list</Text>
        </Screen>,
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  it('warns in development when pull to refresh is asked of a screen that does not scroll', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await render(<Screen hasContent scroll={false} onRefresh={noop} />);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('onRefresh needs scroll'));
    warn.mockRestore();
  });

  it('pads the sides by 20 and takes the insets only on the edges it owns', async () => {
    const plain = contentStyle(await render(<Screen hasContent testID="screen" />));
    expect(plain.paddingLeft).toBe(20);
    expect(plain.paddingRight).toBe(20);
    expect(plain.paddingTop).toBe(0);

    const owned = contentStyle(
      await render(
        <Screen hasContent testID="screen" edges={['top', 'bottom', 'left', 'right']} />,
      ),
    );
    expect(owned.paddingTop).toBe(47);
    expect(owned.paddingBottom).toBe(34);
  });

  it('refreshes on a pull, with the refresh haptic', async () => {
    jest.clearAllMocks();
    const onRefresh = jest.fn();
    const tree = await render(
      <Screen hasContent testID="screen" onRefresh={onRefresh}>
        <Text>content</Text>
      </Screen>,
    );
    const control = refreshControlOf(tree);
    if (control === undefined) throw new Error('no refresh control');
    await act(() => control.props.onRefresh());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Medium);
  });

  it('draws no refresh control without onRefresh', async () => {
    const tree = await render(
      <Screen hasContent testID="screen">
        <Text>content</Text>
      </Screen>,
    );
    expect(refreshControlOf(tree)).toBeUndefined();
  });

  it('counts accents per screen: two screens each with one are not a warning', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await render(
      <>
        <Screen hasContent>
          <Pill label="Back this project" variant="accent" onPress={noop} />
        </Screen>
        <Screen hasContent>
          <Pill label="Confirm pledge" variant="accent" onPress={noop} />
        </Screen>
      </>,
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('declares the route’s motion budget for everything under it', async () => {
    const tree = await render(
      <Screen hasContent motion="none">
        <Pill label="Continue" onPress={noop} />
      </Screen>,
    );
    // Under `none` the pill's press scale is not even attached.
    const wrapper = tree.getByRole('button').parent;
    expect(StyleSheet.flatten(wrapper?.props.style as ViewStyle)?.transform).toBeUndefined();
  });
});
