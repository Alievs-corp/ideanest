import type { ReactElement } from 'react';
import { fireEvent, render as renderBare } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { colors } from '../../theme';
import { EmptyState, ErrorState } from './empty-state';
import { Pill } from './pill';

/**
 * The two things a list says when it has nothing to show. The title is the message and a header;
 * the icon is decoration; an error always has a way to retry.
 */

function render(ui: ReactElement) {
  return renderBare(
    <IntlProvider locale="en" messages={en}>
      {ui}
    </IntlProvider>,
  );
}

const noop = () => {};

describe('EmptyState', () => {
  it('announces its title as a header, and its icon not at all', async () => {
    const { getByRole, container } = await render(
      <EmptyState title="Nothing saved yet" description="Save a campaign to find it here." />,
    );
    expect(getByRole('header', { name: 'Nothing saved yet' })).toBeTruthy();
    const glyph = container.queryAll((node) => (node.type as unknown) === 'RNSVGSvgView')[0];
    expect(glyph?.props.accessibilityElementsHidden).toBe(true);
    expect(glyph?.props.stroke).toBe(colors.textTertiary);
  });

  it('draws a different icon when a filter emptied the list', async () => {
    const empty = await render(<EmptyState title="Nothing" />);
    const filtered = await render(<EmptyState title="Nothing" variant="filtered" />);
    expect(JSON.stringify(empty.toJSON())).not.toBe(JSON.stringify(filtered.toJSON()));
  });

  it('carries the one thing to do about it, when there is one', async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(
      <EmptyState title="Signed out" action={<Pill label="Sign in" onPress={onPress} />} />,
    );
    await fireEvent.press(getByRole('button', { name: 'Sign in' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorState', () => {
  beforeEach(() => jest.clearAllMocks());

  it('pairs a danger icon with words and a "Try again" pill from the catalogue', async () => {
    const onRetry = jest.fn();
    const { getByRole, container } = await render(
      <ErrorState title="Your pledges did not load" onRetry={onRetry} />,
    );
    expect(getByRole('header', { name: 'Your pledges did not load' })).toBeTruthy();
    const glyph = container.queryAll((node) => (node.type as unknown) === 'RNSVGSvgView')[0];
    expect(glyph?.props.stroke).toBe(colors.danger);

    await fireEvent.press(getByRole('button', { name: en.common.tryAgain }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('refuses a second retry while one is running', async () => {
    const onRetry = jest.fn();
    const { getByRole } = await render(<ErrorState title="Failed" onRetry={onRetry} retrying />);
    const retry = getByRole('button', { name: en.common.tryAgain });
    await fireEvent.press(retry);
    expect(onRetry).not.toHaveBeenCalled();
    expect(retry.props.accessibilityState).toMatchObject({ busy: true });
  });

  it('prints the trace id as a reference to quote', async () => {
    const { getByText } = await render(
      <ErrorState title="Failed" onRetry={noop} traceId="4bf92f3577b34da6" />,
    );
    expect(getByText('4bf92f3577b34da6')).toBeTruthy();
    expect(getByText(new RegExp(`^${en.shell.failure.pages.error.referenceLabel}`))).toBeTruthy();
  });

  it('prints no reference line without a trace id', async () => {
    const { queryByText } = await render(<ErrorState title="Failed" onRetry={noop} />);
    expect(queryByText(new RegExp(en.shell.failure.pages.error.referenceLabel))).toBeNull();
  });

  it('announces its title assertively when it appears', async () => {
    const spy = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
      .mockImplementation(() => {});
    await render(<ErrorState title="Failed" onRetry={noop} />);
    expect(spy).toHaveBeenCalledWith('Failed', { queue: false });
  });
});

// Compile-time: an error with no way to retry is a dead end.
function _typeChecks() {
  // @ts-expect-error — `onRetry` is required.
  void (<ErrorState title="Failed" />);
  // @ts-expect-error — an empty state says why the list is empty.
  void (<EmptyState />);
}
void _typeChecks;
