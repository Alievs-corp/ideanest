import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { MotionBudgetProvider } from '../../components/ui';
import { setLocale } from '../../lib/locale';
import { size } from '../../theme';
import { dashboardHref } from '../account/campaign-routes';
import { DashboardFrame } from './dashboard-frame';
import {
  DASHBOARD_TABS,
  DashboardTabs,
  dashboardTabHref,
  dashboardTabOf,
  type DashboardTab,
} from './dashboard-tabs';

const mockRouter = { replace: jest.fn(), push: jest.fn(), back: jest.fn() };
let mockPathname = '/campaigns/c1/dashboard';
let mockSession = { signedIn: true, locked: false, unlocked: false };
const mockScreenOptions: unknown[] = [];

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathname,
  useLocalSearchParams: () => ({ id: 'c1' }),
  Slot: () => null,
  Stack: {
    Screen: ({ options }: { options: unknown }) => {
      mockScreenOptions.push(options);
      return null;
    },
  },
}));
jest.mock('../../lib/use-session', () => ({ useSession: () => mockSession }));

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 320, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const LABELS = DASHBOARD_TABS.map((tab) => en.dashboard.nav[tab]);

function wrap(children: ReactNode, motion?: 'none' | 'full') {
  const tree = (
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="en" messages={en}>
        {children}
      </IntlProvider>
    </SafeAreaProvider>
  );
  return motion === undefined ? tree : <MotionBudgetProvider level={motion}>{tree}</MotionBudgetProvider>;
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  mockScreenOptions.length = 0;
  mockPathname = '/campaigns/c1/dashboard';
  mockSession = { signedIn: true, locked: false, unlocked: false };
});

describe('dashboard routes', () => {
  it.each([
    ['/campaigns/c1/dashboard', 'overview'],
    ['/campaigns/c1/dashboard/', 'overview'],
    ['/campaigns/c1/dashboard/charts', 'charts'],
    ['/campaigns/c1/dashboard/backers', 'backers'],
    ['/campaigns/c1/dashboard/finance', 'finance'],
    ['/campaigns/c1/dashboard/surveys', 'surveys'],
  ] as const)('%s is the %s tab', (pathname, tab) => {
    expect(dashboardTabOf(pathname)).toBe(tab);
  });

  it('gives each tab its own static route', () => {
    expect(dashboardTabHref('c1', 'overview')).toEqual({ pathname: '/campaigns/[id]/dashboard', params: { id: 'c1' } });
    for (const tab of ['charts', 'backers', 'finance', 'surveys'] as const) {
      expect(dashboardTabHref('c1', tab)).toEqual({ pathname: `/campaigns/[id]/dashboard/${tab}`, params: { id: 'c1' } });
    }
  });

  it('is where My campaigns’ "More actions" sends a creator (#159)', () => {
    expect(dashboardHref('c1')).toEqual(dashboardTabHref('c1', 'overview'));
  });
});

describe.each(['full', 'none'] as const)('DashboardTabs, motion %s', (motion) => {
  async function show(active: DashboardTab, onSelect = jest.fn()) {
    await render(wrap(<DashboardTabs active={active} onSelect={onSelect} />, motion));
    return onSelect;
  }

  it('draws the five tabs in the web’s order, as tabs in a named tab list', async () => {
    await show('overview');
    const list = screen.getByTestId('dashboard-tabs');
    expect(list.props.accessibilityRole).toBe('tablist');
    expect(list.props.accessibilityLabel).toBe(en.dashboard.nav.label);
    expect(screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel)).toEqual(LABELS);
  });

  it('marks only the active tab as selected', async () => {
    await show('finance');
    const selected = screen
      .getAllByRole('tab')
      .filter((tab) => tab.props.accessibilityState?.selected === true)
      .map((tab) => tab.props.accessibilityLabel);
    expect(selected).toEqual([en.dashboard.nav.finance]);
  });

  it('switches on a press, and does nothing for the tab already shown', async () => {
    const onSelect = await show('overview');
    await fireEvent.press(screen.getByRole('tab', { name: en.dashboard.nav.charts }));
    expect(onSelect).toHaveBeenCalledWith('charts');
    await fireEvent.press(screen.getByRole('tab', { name: en.dashboard.nav.overview }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('is 44pt to the thumb, and the chosen tab differs by weight as well as colour', async () => {
    await show('backers');
    for (const tab of screen.getAllByRole('tab')) {
      expect(StyleSheet.flatten(tab.props.style).minHeight).toBeGreaterThanOrEqual(size.touchTarget);
    }
    const weightOf = (label: string) =>
      StyleSheet.flatten(screen.getByText(label, { includeHiddenElements: true }).props.style).fontWeight;
    expect(weightOf(en.dashboard.nav.backers)).not.toBe(weightOf(en.dashboard.nav.charts));
  });
});

describe('at the largest text size', () => {
  it('keeps every label whole: scaled, never truncated, in a row that scrolls', async () => {
    await render(wrap(<DashboardTabs active="overview" onSelect={jest.fn()} />));
    expect(screen.getByTestId('dashboard-tabs').props.horizontal).toBe(true);
    for (const label of LABELS) {
      const text = screen.getByText(label, { includeHiddenElements: true });
      expect(text.props.numberOfLines).toBeUndefined();
      expect(text.props.adjustsFontSizeToFit).toBeUndefined();
      expect(text.props.allowFontScaling).not.toBe(false);
      expect(text.props.maxFontSizeMultiplier).toBeUndefined();
    }
  });
});

describe('DashboardFrame', () => {
  it('names the screen "Campaign dashboard" and draws the tabs for the route shown', async () => {
    mockPathname = '/campaigns/c1/dashboard/surveys';
    await render(wrap(<DashboardFrame />));
    expect(mockScreenOptions).toContainEqual(expect.objectContaining({ title: en.dashboard.meta.title }));
    expect(screen.getByRole('tab', { name: en.dashboard.nav.surveys }).props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('replaces the route, so Back leaves the dashboard rather than stepping through tabs', async () => {
    await render(wrap(<DashboardFrame />));
    await fireEvent.press(screen.getByRole('tab', { name: en.dashboard.nav.charts }));
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/campaigns/[id]/dashboard/charts', params: { id: 'c1' } });
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('sends a signed-out reader to sign in, and back to the tab they asked for', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    mockPathname = '/campaigns/c1/dashboard/finance';
    await render(wrap(<DashboardFrame />));
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/campaigns/c1/dashboard/finance' },
    });
    expect(screen.queryByTestId('dashboard-tabs')).toBeNull();
  });
});
