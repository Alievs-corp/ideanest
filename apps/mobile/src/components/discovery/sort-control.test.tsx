import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { motion } from '../../theme';
import { MotionBudgetProvider } from '../ui';
import { SortControl } from './sort-control';

/**
 * The feed's sort opener as a design-language pill (#281): it names the order in force, gives
 * under the thumb with full motion, and stays still with reduced motion.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

async function show({ still = false }: { still?: boolean } = {}) {
  const control = <SortControl sort="newest" hasQuery={false} onChange={jest.fn()} />;
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="en" messages={en}>
        {still ? <MotionBudgetProvider level="none">{control}</MotionBudgetProvider> : control}
      </IntlProvider>
    </SafeAreaProvider>,
  );
}

const opener = () => screen.getByTestId('sort-control');

describe('the sort pill', () => {
  it('says what order is in force', async () => {
    await show();
    expect(screen.getByRole('button', { name: 'Sort by: Newest' })).toBeTruthy();
  });

  it('gives under the thumb with full motion', async () => {
    await show();
    fireEvent(opener(), 'pressIn');
    await waitFor(
      () => {
        const style = getAnimatedStyle(opener().parent as never) as {
          transform?: { scale: number }[];
        };
        expect(style.transform?.[0]?.scale).toBeCloseTo(motion.pressScale, 2);
      },
      { timeout: 3000 },
    );
  });

  it('stays still with reduced motion', async () => {
    await show({ still: true });
    fireEvent(opener(), 'pressIn');
    expect(StyleSheet.flatten(opener().parent?.props.style)?.transform).toBeUndefined();
  });
});
