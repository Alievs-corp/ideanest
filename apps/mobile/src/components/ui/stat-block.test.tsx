import type { ReactElement } from 'react';
import { render as renderBare, waitFor } from '@testing-library/react-native';
import {
  AccessibilityInfo,
  StyleSheet,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { formatMoney } from '@ideanest/money/format';
import { colors } from '../../theme';
import { StatBlock, StatRow } from './stat-block';
import { SurfaceProvider, TONES } from './surface';

/**
 * A headline figure and its change. The change says its direction three ways — an arrow, words and
 * the hue — so that colour is never the only one (CLAUDE.md §2), and the figure is tabular.
 */

function render(ui: ReactElement) {
  return renderBare(
    <IntlProvider locale="en" messages={en}>
      {ui}
    </IntlProvider>,
  );
}

function textStyle(element: { props: { style?: unknown } }): TextStyle {
  return StyleSheet.flatten(element.props.style as StyleProp<TextStyle>) ?? {};
}

describe('StatBlock', () => {
  it('draws the figure tabular, at 40 for lg and 30 for md', async () => {
    const lg = await render(<StatBlock value="1,204" label="Backers" />);
    const md = await render(<StatBlock value="86" label="Backers" size="md" />);

    const large = textStyle(lg.getByText('1,204'));
    expect(large.fontSize).toBe(40);
    expect(large.fontVariant).toEqual(['tabular-nums']);
    expect(large.letterSpacing).toBeCloseTo(40 * -0.04, 5);
    expect(textStyle(md.getByText('86')).fontSize).toBe(30);
    expect(textStyle(lg.getByText('Backers')).color).toBe(colors.textSecondary);
  });

  it.each([
    ['up', 'Up: +12%', colors.lime500, colors.textOnLime, 'ArrowUp'],
    ['down', 'Down: −3', colors.danger, colors.textOnDanger, 'ArrowDown'],
    ['neutral', 'Unchanged: 0', colors.surface4, colors.textSecondary, 'ArrowRight'],
  ] as const)(
    'pairs the %s colour with an Iconsax arrow and with words',
    async (tone, name, background, text, glyph) => {
      const badge = name.split(': ')[1] ?? '';
      const { getByLabelText, getByText, container } = await render(
        <StatBlock value="1,204" label="Backers" badge={badge} badgeTone={tone} />,
      );
      const chip = getByLabelText(name);
      expect(StyleSheet.flatten(chip.props.style as ViewStyle).backgroundColor).toBe(background);
      expect(textStyle(getByText(badge)).color).toBe(text);

      const arrows = container.queryAll((node) => (node.type as unknown) === 'RNSVGSvgView');
      expect(arrows).toHaveLength(1);
      expect(arrows[0]?.props.color).toBe(text);
      expect(arrows[0]?.props.testID).toBe(`icon-${glyph}`);
    },
  );

  it('never draws text in lime — up is a lime surface with on-lime text', async () => {
    const { getByText } = await render(
      <StatBlock value="1" label="Backers" badge="+1" badgeTone="up" />,
    );
    expect(textStyle(getByText('+1')).color).not.toBe(colors.lime500);
  });

  it('wraps the badge under a long figure and shrinks the figure, never truncating it', async () => {
    const { getByText } = await render(
      <StatBlock value="₼1,234,567,890.00" label="Pledged" badge="+12%" />,
    );
    const figure = getByText('₼1,234,567,890.00');
    expect(textStyle(figure).flexShrink).toBe(1);
    expect(figure.props.numberOfLines).toBeUndefined();
    const row = figure.parent;
    expect(
      row === null ? undefined : StyleSheet.flatten(row.props.style as ViewStyle).flexWrap,
    ).toBe('wrap');
  });

  it('takes its tones from the surface it sits on', async () => {
    const { getByText } = await render(
      <SurfaceProvider surface="white">
        <StatBlock value="€1,204" label="Pledged" />
      </SurfaceProvider>,
    );
    expect(textStyle(getByText('€1,204')).color).toBe(TONES.white.primary);
    expect(textStyle(getByText('Pledged')).color).toBe(TONES.white.secondary);
  });

  describe('a money figure', () => {
    const money = { amount: '1204.50', currency: 'AZN' };
    const formatted = formatMoney(money);

    afterEach(() => jest.restoreAllMocks());

    it('is a HeroFigure: formatted by @ideanest/money and named by it', async () => {
      const { getByLabelText, getByText } = await render(
        <StatBlock money={money} label="Pledged" testID="stat" />,
      );
      expect(getByLabelText(formatted)).toBeTruthy();
      expect(getByText('Pledged')).toBeTruthy();
    });

    it('counts up on first view where motion is allowed', async () => {
      const { queryByTestId } = await render(
        <StatBlock money={money} label="Pledged" motion="count" />,
      );
      expect(queryByTestId('animated-amount-count', { includeHiddenElements: true })).not.toBeNull();
    });

    it('draws the final figure at once under Reduce Motion — no count, nothing moving', async () => {
      jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
      const { queryByTestId, getByLabelText } = await render(
        <StatBlock money={money} label="Pledged" motion="count" />,
      );
      await waitFor(() =>
        expect(queryByTestId('animated-amount-count', { includeHiddenElements: true })).toBeNull(),
      );
      expect(getByLabelText(formatted)).toBeTruthy();
    });
  });

  it('wraps a row with the web’s gaps', async () => {
    const { getByTestId } = await render(
      <StatRow testID="row">
        <StatBlock value="1" label="Backers" />
      </StatRow>,
    );
    const row = StyleSheet.flatten(getByTestId('row').props.style as ViewStyle);
    expect(row.flexWrap).toBe('wrap');
    expect(row.columnGap).toBe(40);
    expect(row.rowGap).toBe(24);
  });
});

// Compile-time: a figure is a formatted value or money, never both and never neither.
function _typeChecks() {
  // @ts-expect-error — both a value and money.
  void (<StatBlock value="1" money={{ amount: '1', currency: 'AZN' }} label="x" />);
  // @ts-expect-error — neither.
  void (<StatBlock label="x" />);
}
void _typeChecks;
