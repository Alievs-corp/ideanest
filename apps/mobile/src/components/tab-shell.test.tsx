import type { ReactElement, ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import TabsLayout from '../app/(tabs)/_layout';
import { useSessionState, useUnreadCount, type SessionState } from '../lib/account';

/**
 * The tab shell's accessible names — issue #150: every tab, and the header's bell with its count.
 *
 * <p>The tabs draw a glyph and no label (the owner's call), so the accessible name is the only
 * name a tab has, and it must come from the catalogue. The router is replaced by a `Tabs` that
 * renders each screen's options as the bar would expose them to a screen reader — a tab, named
 * by `tabBarAccessibilityLabel` — and the header's right-hand control once, as it appears on
 * every tab.
 *
 * <p>Here rather than beside `app/(tabs)/_layout.tsx` because every file under `src/app` is a
 * route to Expo Router, and a test file there would be offered as a screen.
 */

jest.mock('expo-router', () => {
  const { createElement } = require('react');
  const { View: MockView } = require('react-native');
  const Screen = ({ options }: { options: { tabBarAccessibilityLabel?: string } }) =>
    createElement(MockView, {
      accessible: true,
      accessibilityRole: 'tab',
      accessibilityLabel: options.tabBarAccessibilityLabel,
    });
  const Tabs = ({
    children,
    screenOptions,
  }: {
    children: ReactNode;
    screenOptions: { headerRight: () => ReactElement; tabBarShowLabel?: boolean };
  }) =>
    createElement(
      MockView,
      { testID: screenOptions.tabBarShowLabel === false ? 'icons-only' : 'labelled' },
      createElement(MockView, { testID: 'header-right' }, screenOptions.headerRight()),
      children,
    );
  return {
    Tabs: Object.assign(Tabs, { Screen }),
    Link: ({ children }: { children: ReactNode }) => children,
  };
});

jest.mock('../lib/account', () => ({
  ...jest.requireActual('../lib/account'),
  useSessionState: jest.fn(),
  useUnreadCount: jest.fn(),
}));

function given(state: SessionState, unread?: number): void {
  jest.mocked(useSessionState).mockReturnValue(state);
  jest.mocked(useUnreadCount).mockReturnValue(unread);
}

async function renderTabs() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <TabsLayout />
    </IntlProvider>,
  );
}

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel as string);

describe('the tab bar', () => {
  it('names the five tabs from the catalogue, in order', async () => {
    given('signed-out');
    await renderTabs();
    const words = en.mobile.tabs;
    expect(tabNames()).toEqual([words.home, words.search, words.saved, words.pledges, words.me]);
    // Icons only, by the owner's decision: the accessible name above is the tab's whole name.
    expect(screen.getByTestId('icons-only')).toBeTruthy();
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
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('header-right').children).toHaveLength(1);
  });
});
