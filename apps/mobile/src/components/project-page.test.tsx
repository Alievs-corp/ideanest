import type { ReactNode } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import ProjectScreen from '../app/projects/[creatorSlug]/[projectSlug]';
import { colors } from '../theme';

/**
 * The campaign page's call to action — issue #151: the one lime pill in the app so far, and only
 * one on the page. The page provides its own accent scope, so a second accent would warn in
 * development.
 *
 * <p>Here rather than beside the route because every file under `src/app` is a route to Expo
 * Router, and a test file there would be offered as a screen.
 */

jest.mock('expo-router', () => ({
  Stack: Object.assign(() => null, { Screen: () => null }),
  useLocalSearchParams: () => ({ creatorSlug: 'aysel', projectSlug: 'solar-lamp' }),
}));

jest.mock('../api/queries', () => ({
  useProjectPage: () => ({
    data: {
      id: 'project-1',
      title: 'Solar Lamp',
      blurb: null,
      creator: { name: 'Aysel' },
      pledged: { amount: '420.00', currency: 'AZN' },
      goal: { amount: '1000.00', currency: 'AZN' },
      backersCount: 3,
      story: null,
      coverImage: null,
    },
    isLoading: false,
    isError: false,
    isStale: false,
    isFetching: false,
    refetch: jest.fn(),
  }),
  useProjectRewards: () => ({ data: { rewards: [] } }),
  useProjectUpdates: () => ({ data: { updates: [] } }),
}));

jest.setTimeout(20_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderPage() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="en" messages={en}>
        {children}
      </IntlProvider>
    </SafeAreaProvider>
  );
  return render(<ProjectScreen />, { wrapper });
}

function background(node: { props: { style?: unknown } }): unknown {
  return StyleSheet.flatten(node.props.style as ViewStyle)?.backgroundColor;
}

describe('the campaign page', () => {
  it('has exactly one lime action — backing the campaign — and no accent warning', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await renderPage();

    const back = screen.getByRole('button', { name: en.campaign.back.cta });
    expect(background(back)).toBe(colors.lime500);
    expect(back.props.accessibilityHint).toBe('Back Solar Lamp on the web');

    const share = screen.getByRole('button', { name: en.campaign.actions.share });
    expect(background(share)).not.toBe(colors.lime500);

    const lime = screen
      .getAllByRole('button')
      .filter((button) => background(button) === colors.lime500);
    expect(lime).toHaveLength(1);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('accent pills'));
    warn.mockRestore();
  });
});
