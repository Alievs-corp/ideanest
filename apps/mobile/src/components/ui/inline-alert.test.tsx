import type { ReactElement } from 'react';
import { fireEvent, render as renderBare } from '@testing-library/react-native';
import { AccessibilityInfo, Platform, StyleSheet, type ViewStyle } from 'react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { colors, size } from '../../theme';
import { InlineAlert } from './inline-alert';

/**
 * The web's one way of saying things outside admin. Every variant pairs its hue with its own icon
 * and with words; only warning and danger interrupt a screen reader, once, when they appear.
 */

function render(ui: ReactElement) {
  return renderBare(
    <IntlProvider locale="en" messages={en}>
      {ui}
    </IntlProvider>,
  );
}

function glyphsIn(tree: Awaited<ReturnType<typeof render>>) {
  return tree.container.queryAll((node) => (node.type as unknown) === 'RNSVGSvgView');
}

describe('InlineAlert', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['info', colors.info],
    ['success', colors.success],
    ['warning', colors.warning],
    ['danger', colors.danger],
  ] as const)('pairs the %s colour with an icon and with words', async (variant, colour) => {
    const tree = await render(
      <InlineAlert testID="alert" variant={variant} title="Heads up" description="Detail" />,
    );
    const alert = StyleSheet.flatten(tree.getByTestId('alert').props.style as ViewStyle);
    expect(alert.borderLeftColor).toBe(colour);
    expect(alert.borderLeftWidth).toBe(2);
    expect(tree.getByText('Heads up')).toBeTruthy();
    expect(tree.getByText('Detail')).toBeTruthy();

    const glyphs = glyphsIn(tree);
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]?.props.stroke).toBe(colour);
  });

  it('draws a different icon for each variant, so the shape tells them apart too', async () => {
    const shapes = new Set<string>();
    for (const variant of ['info', 'success', 'warning', 'danger'] as const) {
      const tree = await render(<InlineAlert variant={variant} description="Detail" />);
      shapes.add(JSON.stringify(tree.toJSON()));
    }
    expect(shapes.size).toBe(4);
  });

  it.each(['warning', 'danger'] as const)(
    'announces a %s assertively, once, when it appears, on iOS',
    async (variant) => {
      const spy = jest
        .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
        .mockImplementation(() => {});
      const tree = await render(
        <InlineAlert variant={variant} title="Payment failed" description="Try another card." />,
      );
      await tree.rerender(
        <IntlProvider locale="en" messages={en}>
          <InlineAlert variant={variant} title="Payment failed" description="Try another card." />
        </IntlProvider>,
      );
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('Payment failed. Try another card.', { queue: false });
    },
  );

  it.each(['info', 'success'] as const)('does not interrupt for %s', async (variant) => {
    const spy = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
      .mockImplementation(() => {});
    await render(<InlineAlert variant={variant} title="Saved" />);
    expect(spy).not.toHaveBeenCalled();
  });

  describe('on Android', () => {
    beforeEach(() => {
      jest.replaceProperty(Platform, 'OS', 'android');
    });
    afterEach(() => jest.restoreAllMocks());

    it('leaves the arrival to the live region and announces nothing by hand — said once, not twice', async () => {
      const spy = jest
        .spyOn(AccessibilityInfo, 'announceForAccessibility')
        .mockImplementation(() => {});
      const tree = await render(
        <InlineAlert testID="alert" variant="danger" title="Payment failed" />,
      );
      expect(tree.getByTestId('alert').props.accessibilityLiveRegion).toBe('assertive');
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it('can look like a warning without interrupting, when told to be polite', async () => {
    const spy = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
      .mockImplementation(() => {});
    const tree = await render(
      <InlineAlert testID="alert" variant="warning" politeness="polite" description="Old data" />,
    );
    expect(spy).not.toHaveBeenCalled();
    expect(tree.getByTestId('alert').props.accessibilityLiveRegion).toBe('polite');
    expect(
      StyleSheet.flatten(tree.getByTestId('alert').props.style as ViewStyle).borderLeftColor,
    ).toBe(colors.warning);
  });

  it('is an assertive live region for warning and danger, polite otherwise', async () => {
    const danger = await render(<InlineAlert testID="alert" variant="danger" title="Failed" />);
    const info = await render(<InlineAlert testID="alert" variant="info" title="Note" />);
    expect(danger.getByTestId('alert').props.accessibilityLiveRegion).toBe('assertive');
    expect(info.getByTestId('alert').props.accessibilityLiveRegion).toBe('polite');
  });

  it('has no dismiss button unless it can be dismissed', async () => {
    const { queryByRole } = await render(<InlineAlert title="Note" />);
    expect(queryByRole('button')).toBeNull();
  });

  it('dismisses through a named 44pt button, named from the catalogue by default', async () => {
    const onDismiss = jest.fn();
    const { getByRole } = await render(<InlineAlert title="Note" onDismiss={onDismiss} />);
    const button = getByRole('button', { name: en.mobile.kitDisplay.dismiss });
    const style = StyleSheet.flatten(
      (typeof button.props.style === 'function'
        ? button.props.style({ pressed: false })
        : button.props.style) as ViewStyle,
    );
    const slop = Number(button.props.hitSlop);
    expect(Number(style.height) + 2 * slop).toBeGreaterThanOrEqual(size.touchTarget);

    await fireEvent.press(button);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('takes the caller’s dismiss label when it has a better one', async () => {
    const { getByRole } = await render(
      <InlineAlert title="Note" onDismiss={() => {}} dismissLabel="Dismiss the notice" />,
    );
    expect(getByRole('button', { name: 'Dismiss the notice' })).toBeTruthy();
  });
});
