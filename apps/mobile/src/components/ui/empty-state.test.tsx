import type { ReactElement } from 'react';
import { fireEvent, render as renderBare } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { colors, tint } from '../../theme';
import { EmptyState, ErrorState } from './empty-state';
import { Pill } from './pill';
import { SurfaceProvider, TONES } from './surface';

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

function glyphOf(tree: Awaited<ReturnType<typeof render>>) {
  return tree.container.queryAll((node) => (node.type as unknown) === 'RNSVGSvgView')[0];
}

function fillOf(element: { props: { style?: unknown } } | null | undefined) {
  return StyleSheet.flatten(element?.props.style as ViewStyle)?.backgroundColor;
}

describe('EmptyState', () => {
  it('announces its title as a header, and its icon not at all', async () => {
    const { getByRole, container } = await render(
      <EmptyState title="Nothing saved yet" description="Save a campaign to find it here." />,
    );
    expect(getByRole('header', { name: 'Nothing saved yet' })).toBeTruthy();
    const glyph = container.queryAll((node) => (node.type as unknown) === 'RNSVGSvgView')[0];
    expect(glyph?.props.accessibilityElementsHidden).toBe(true);
    expect(glyph?.props.color).toBe(TONES.dark.secondary);
  });

  it('draws a large Bulk glyph in a soft circular badge, on a raised block without a border', async () => {
    const tree = await render(<EmptyState testID="empty" title="Nothing saved yet" />);
    const glyph = glyphOf(tree);
    // Bulk's second layer is the same colour at reduced opacity (mobile-design skill §5).
    expect(glyph?.queryAll((node) => node.props.opacity === 0.4).length).toBeGreaterThan(0);
    expect(Number(glyph?.props.width)).toBeGreaterThanOrEqual(32);
    const badge = StyleSheet.flatten(glyph?.parent?.props.style as ViewStyle);
    expect(badge.backgroundColor).toBe(colors.surface3);
    expect(badge.borderRadius).toBe(9999);
    const block = StyleSheet.flatten(tree.getByTestId('empty').props.style as ViewStyle);
    expect(block.backgroundColor).toBe(colors.surface2);
    expect(block.borderWidth).toBeUndefined();
  });

  it('sits on a white sheet as the sheet’s muted block, in on-white tones', async () => {
    const tree = await render(
      <SurfaceProvider surface="white">
        <EmptyState
          testID="empty"
          title="Nothing saved yet"
          description="Save a campaign"
          action={<Pill label="Discover" onPress={noop} />}
        />
      </SurfaceProvider>,
    );
    expect(fillOf(tree.getByTestId('empty'))).toBe(colors.whiteMuted);
    expect(fillOf(glyphOf(tree)?.parent)).toBe(colors.whiteSurface);
    const title = StyleSheet.flatten(tree.getByText('Nothing saved yet').props.style as TextStyle);
    expect(title.color).toBe(TONES.white.primary);
    // The primary pill inverts on white by itself.
    const pill = tree.getByRole('button', { name: 'Discover' });
    const pillStyle = StyleSheet.flatten(
      (typeof pill.props.style === 'function'
        ? pill.props.style({ pressed: false })
        : pill.props.style) as ViewStyle,
    );
    expect(pillStyle.backgroundColor).toBe(colors.surface1);
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
    expect(glyph?.props.color).toBe(colors.danger);
    expect(fillOf(glyph?.parent)).toBe(tint(colors.danger, 0.12));

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

  it('appears at once — it is not wrapped in an entry animation', async () => {
    const tree = await render(<ErrorState testID="error" title="Failed" onRetry={noop} />);
    const view = tree.getByTestId('error');
    expect(view.props.entering).toBeUndefined();
    expect(StyleSheet.flatten(view.props.style as ViewStyle).opacity).toBeUndefined();
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
