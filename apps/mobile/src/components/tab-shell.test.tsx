import type { ReactElement, ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import TabsLayout from '../app/(tabs)/_layout';
import { useSessionState, useUnreadCount, type SessionState } from '../lib/account';

/**
 * The tab shell — issues #150 and #276: the floating bar's five slots, the Create button's route
 * signed in and out, and the header's bell with its count.
 *
 * <p>The tabs draw a glyph and no label (the owner's call), so the accessible name is the only
 * name a tab has, and it must come from the catalogue. The router is replaced by a `Tabs` that
 * hands the layout's own `tabBar` the navigator state its screens describe, focused on the first,
 * and renders the header's right-hand control once, as it appears on every tab.
 *
 * <p>Here rather than beside `app/(tabs)/_layout.tsx` because every file under `src/app` is a
 * route to Expo Router, and a test file there would be offered as a screen.
 */

const mockPush = jest.fn();
const mockNavigate = jest.fn();

jest.mock('expo-router', () => {
  const { Children, createElement } = require('react');
  const { View: MockView } = require('react-native');
  interface MockScreenProps {
    name: string;
    options: { title?: string; tabBarAccessibilityLabel?: string };
  }
  const Tabs = ({
    children,
    screenOptions,
    tabBar,
  }: {
    children: ReactNode;
    screenOptions: { headerRight: () => ReactElement; tabBarShowLabel?: boolean };
    tabBar: (props: unknown) => ReactElement;
  }) => {
    const screens = Children.toArray(children).map(
      (child: unknown) => (child as { props: MockScreenProps }).props,
    );
    const routes = screens.map((props: MockScreenProps) => ({ key: `${props.name}-key`, name: props.name }));
    const descriptors = Object.fromEntries(
      screens.map((props: MockScreenProps) => [`${props.name}-key`, { options: props.options }]),
    );
    return createElement(
      MockView,
      { testID: screenOptions.tabBarShowLabel === false ? 'icons-only' : 'labelled' },
      createElement(MockView, { testID: 'header-right' }, screenOptions.headerRight()),
      tabBar({
        state: { index: 0, routes },
        descriptors,
        navigation: { emit: () => ({ defaultPrevented: false }), navigate: mockNavigate },
        insets: { top: 0, right: 0, bottom: 34, left: 0 },
      }),
    );
  };
  return {
    Tabs: Object.assign(Tabs, { Screen: () => null }),
    Link: ({ children }: { children: ReactNode }) => children,
    useRouter: () => ({ push: mockPush, navigate: mockNavigate, replace: jest.fn(), back: jest.fn() }),
  };
});

jest.mock('../lib/account', () => ({
  ...jest.requireActual('../lib/account'),
  useSessionState: jest.fn(),
  useUnreadCount: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

function given(state: SessionState, unread?: number): void {
  jest.mocked(useSessionState).mockReturnValue(state);
  jest.mocked(useUnreadCount).mockReturnValue(unread);
}

/* The tab layout and its header's module graph load on the first render; slow on a CI runner. */
jest.setTimeout(20_000);

async function renderTabs() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <TabsLayout />
    </IntlProvider>,
  );
}

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel as string);

describe('the tab bar', () => {
  it('has five slots: four tabs named from the catalogue, and Create in the middle', async () => {
    given('signed-out');
    await renderTabs();
    const words = en.mobile.tabs;
    expect(tabNames()).toEqual([words.home, words.search, words.pledges, words.me]);
    // Saved left the bar for the Me hub (#276): no sixth slot, no "More".
    expect(screen.queryByRole('tab', { name: words.saved })).toBeNull();

    const order = within(screen.getByTestId('floating-tab-bar')).getAllByRole(/^(tab|button)$/);
    expect(order.map((node) => node.props.accessibilityLabel)).toEqual([
      words.home,
      words.search,
      en.shell.actions.startCampaign,
      words.pledges,
      words.me,
    ]);
    // Icons only, by the owner's decision: the accessible name above is the tab's whole name.
    expect(screen.getByTestId('icons-only')).toBeTruthy();
  });

  it('marks the focused tab selected and no other', async () => {
    given('signed-out');
    await renderTabs();
    expect(screen.getByRole('tab', { name: en.mobile.tabs.home, selected: true })).toBeTruthy();
    expect(screen.getAllByRole('tab', { selected: false })).toHaveLength(3);
  });

  it('Create, signed in: opens the campaign form, with a medium impact', async () => {
    given('signed-in', 0);
    await renderTabs();
    await fireEvent.press(screen.getByRole('button', { name: en.shell.actions.startCampaign }));
    expect(mockPush).toHaveBeenCalledWith('/campaigns/new');
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Medium);
  });

  it('Create, signed out: sign-in first, then back to the campaign form', async () => {
    given('signed-out');
    await renderTabs();
    await fireEvent.press(screen.getByRole('button', { name: en.shell.actions.startCampaign }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/campaigns/new' },
    });
  });

  it('Create has no selected state: it is a button, not a tab', async () => {
    given('signed-in', 0);
    await renderTabs();
    const create = screen.getByRole('button', { name: en.shell.actions.startCampaign });
    expect(create.props.accessibilityState?.selected).toBeUndefined();
  });

  it('switches tabs through the navigator; a press on the focused tab does not navigate', async () => {
    given('signed-out');
    await renderTabs();
    await fireEvent.press(screen.getByRole('tab', { name: en.mobile.tabs.pledges }));
    expect(mockNavigate).toHaveBeenCalledWith('pledges', undefined);
    mockNavigate.mockClear();
    await fireEvent.press(screen.getByRole('tab', { name: en.mobile.tabs.home }));
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('the header control', () => {
  it('signed out: "Sign in"', async () => {
    given('signed-out');
    await renderTabs();
    expect(screen.getByRole('button', { name: en.shell.actions.signIn })).toBeTruthy();
  });

  it('signed in: the bell, its name carrying the count', async () => {
    given('signed-in', 3);
    await renderTabs();
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBeTruthy();
    // The badge is hidden from a screen reader, which hears the count in the name instead.
    expect(screen.getByText('3', { includeHiddenElements: true })).toBeTruthy();
  });

  it('signed in with nothing unread: says so, and draws no badge', async () => {
    given('signed-in', 0);
    await renderTabs();
    expect(screen.getByRole('button', { name: 'Notifications, none unread' })).toBeTruthy();
    expect(screen.queryByText('0', { includeHiddenElements: true })).toBeNull();
  });

  it('past ninety-nine: 99+ on the badge and in words', async () => {
    given('signed-in', 250);
    await renderTabs();
    expect(screen.getByRole('button', { name: en.mobile.header.over })).toBeTruthy();
    expect(screen.getByText('99+', { includeHiddenElements: true })).toBeTruthy();
  });

  it('count not read yet: the bell by its plain name, no badge', async () => {
    given('signed-in', undefined);
    await renderTabs();
    expect(screen.getByRole('button', { name: en.shell.actions.notifications })).toBeTruthy();
  });

  it('unknown session: a blank of the same width, nothing to press', async () => {
    given('unknown');
    await renderTabs();
    expect(screen.getByTestId('header-right').children).toHaveLength(1);
    // Nothing to press in the header: the only button on screen is the bar's Create.
    expect(screen.getAllByRole('button').map((node) => node.props.accessibilityLabel)).toEqual([
      en.shell.actions.startCampaign,
    ]);
  });
});
