import { StyleSheet, Text } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { spacing } from '../theme';
import {
  FloatingTabBar,
  TAB_BAR_HEIGHT,
  TabBarInsetProvider,
  tabBarFootprint,
  tabBarOffset,
  useTabBarInset,
  type TabBarProps,
} from './tab-bar';
import { TAB_GLYPHS } from './tab-icon';
import { Screen } from './ui';
import { MotionBudgetProvider } from './ui/motion-budget';

/**
 * The floating bar on its own (#276): where it sits against the safe area, the footprint every
 * tab screen pads by, the capsule that follows the focused tab, and the glyph's shape change.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const ROUTES = ['index', 'search', 'pledges', 'me'].map((name) => ({ key: `${name}-key`, name }));

function props(index: number, navigate = jest.fn()): TabBarProps {
  return {
    state: { index, routes: ROUTES },
    descriptors: Object.fromEntries(
      ROUTES.map((route) => [route.key, { options: { tabBarAccessibilityLabel: route.name } }]),
    ),
    navigation: { emit: () => ({ defaultPrevented: false }), navigate },
    insets: { top: 0, right: 0, bottom: 34, left: 0 },
  } as unknown as TabBarProps;
}

function bar(index: number, onCreate = jest.fn()) {
  return <FloatingTabBar {...props(index)} glyphs={TAB_GLYPHS} createLabel="Start a campaign" onCreate={onCreate} />;
}

/** Lays the four slots out 80pt apart, as a 390pt phone would. */
async function layOut() {
  const tabs = screen.getAllByRole('tab');
  for (const [index, tab] of tabs.entries()) {
    const x = index < 2 ? spacing[2] + index * 80 : spacing[2] + index * 80 + 72;
    await fireEvent(tab, 'layout', { nativeEvent: { layout: { x, y: 8, width: 80, height: 48 } } });
  }
}

const capsule = () => getAnimatedStyle(screen.getByTestId('tab-capsule') as never) as {
  opacity?: number;
  transform?: { translateX: number }[];
};

describe('the bar against the safe area', () => {
  it('sits a gap above the home indicator, and never flush on a phone without one', () => {
    expect(tabBarOffset(34)).toBe(34 + spacing[2]);
    expect(tabBarOffset(0)).toBe(spacing[3]);
  });

  it('publishes its footprint to tab screens, and nothing outside the tab group', async () => {
    let inside = -1;
    let outside = -1;
    function Inside() {
      inside = useTabBarInset();
      return null;
    }
    function Outside() {
      outside = useTabBarInset();
      return null;
    }
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <TabBarInsetProvider>
          <Inside />
        </TabBarInsetProvider>
        <Outside />
      </SafeAreaProvider>,
    );
    expect(inside).toBe(tabBarFootprint(34));
    expect(inside).toBe(34 + spacing[2] + TAB_BAR_HEIGHT + spacing[4]);
    expect(outside).toBe(0);
  });

  it('pads a scaffolded tab screen by the footprint, so its last row clears the bar', async () => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <IntlProvider locale="en" messages={en}>
          <TabBarInsetProvider>
            <Screen hasContent testID="screen">
              <Text>Row</Text>
            </Screen>
          </TabBarInsetProvider>
        </IntlProvider>
      </SafeAreaProvider>,
    );
    const content = StyleSheet.flatten(screen.getByTestId('screen').props.contentContainerStyle);
    expect(content.paddingBottom).toBe(tabBarFootprint(34));
  });
});

describe('the capsule and the glyphs', () => {
  it('centres the capsule on the focused slot once the slots are measured', async () => {
    await render(bar(1));
    expect(capsule().opacity).toBe(0);
    await layOut();
    await waitFor(() => expect(capsule().opacity).toBe(1));
    expect(capsule().transform).toEqual([{ translateX: spacing[2] + 80 + (80 - 56) / 2 }]);
  });

  it('springs to the next tab when focus moves', async () => {
    const view = await render(bar(0));
    await layOut();
    await view.rerender(bar(3));
    await waitFor(
      () => expect(capsule().transform).toEqual([{ translateX: spacing[2] + 3 * 80 + 72 + (80 - 56) / 2 }]),
      { timeout: 3000 },
    );
  });

  it('jumps without motion, and still moves', async () => {
    const view = await render(<MotionBudgetProvider level="none">{bar(0)}</MotionBudgetProvider>);
    await layOut();
    await view.rerender(<MotionBudgetProvider level="none">{bar(2)}</MotionBudgetProvider>);
    expect(capsule().transform).toEqual([{ translateX: spacing[2] + 2 * 80 + 72 + (80 - 56) / 2 }]);
  });

  it('draws each tab in both shapes, the Bold one showing only on the focused tab', async () => {
    await render(<MotionBudgetProvider level="none">{bar(0)}</MotionBudgetProvider>);
    const layer = (name: string) =>
      screen
        .getAllByTestId(name, { includeHiddenElements: true })
        .map((icon) => (getAnimatedStyle(icon.parent as never) as { opacity?: number }).opacity);
    // Before the capsule is placed, the near-black Bold glyph would sit on the dark bar.
    expect(layer('icon-Home')).toEqual([1, 0]);
    await layOut();
    const home = screen.getAllByTestId('icon-Home', { includeHiddenElements: true });
    expect(home).toHaveLength(2);
    const layers = home.map((icon) => getAnimatedStyle(icon.parent as never) as { opacity?: number });
    expect(layers.map((layer) => layer.opacity)).toEqual([0, 1]);
    const search = screen
      .getAllByTestId('icon-SearchNormal1', { includeHiddenElements: true })
      .map((icon) => (getAnimatedStyle(icon.parent as never) as { opacity?: number }).opacity);
    expect(search).toEqual([1, 0]);
  });
});
