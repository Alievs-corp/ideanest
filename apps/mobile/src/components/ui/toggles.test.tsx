import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, type ViewStyle } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors, radius, size } from '../../theme';
import { CHECKBOX_FILL, CHECKBOX_MARK, Checkbox, MARK_ENTRY_SCALE } from './checkbox';
import { MotionBudgetProvider } from './motion-budget';
import { RADIO_DOT, RADIO_FILL, Radio, RadioGroup } from './radio';
import { SurfaceProvider, TONES } from './surface';
import { KNOB_TRAVEL, SWITCH_KNOB, SWITCH_ON_LAYER, Switch } from './switch';

/**
 * The three toggles share one shape — the whole row is the control — so they share the checks
 * that shape exists for: one accessible element with the right role and state, a row a thumb
 * can hit, and a press that does nothing while disabled. Then each one's own visual rule on the
 * dark canvas and on a white sheet, and their motion (#282): a press scale on the control, a
 * selection that springs in on transform and opacity, and none of it under Reduce Motion or a
 * `none` budget.
 */

const noop = () => {};

function flat(element: { props: { style?: unknown } }) {
  const { style } = element.props;
  return StyleSheet.flatten(typeof style === 'function' ? style({ pressed: false }) : style) ?? {};
}

type Tree = Awaited<ReturnType<typeof render>>;

/** A part of a control, by test identifier, as Reanimated currently draws it. */
function drawn(tree: Tree, id: string) {
  return getAnimatedStyle(tree.getByTestId(id, { includeHiddenElements: true }) as never) as ViewStyle & {
    transform?: Record<string, number>[];
  };
}

/** The press-scale transform on a control's indicator (the parent of its fill layer). */
function pressScaleOf(tree: Tree, fill: string) {
  const indicator = tree.getAllByTestId(fill, { includeHiddenElements: true })[0]?.parent ?? null;
  return indicator === null ? undefined : flat(indicator).transform;
}

const reduceMotionOnce = () =>
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(true);

describe('Checkbox', () => {
  it('is one checkbox named by its label, with its description as the hint', async () => {
    const { getByRole } = await render(
      <Checkbox
        label="Email me updates"
        description="About this campaign only"
        checked={false}
        onChange={noop}
      />,
    );
    const box = getByRole('checkbox', { name: 'Email me updates' });
    expect(box.props.accessibilityHint).toBe('About this campaign only');
    expect(box.props.accessibilityState).toMatchObject({ checked: false, disabled: false });
  });

  it('is a row at least 44pt tall', async () => {
    const { getByRole } = await render(<Checkbox label="Agree" checked={false} onChange={noop} />);
    expect(flat(getByRole('checkbox')).minHeight).toBeGreaterThanOrEqual(size.touchTarget);
  });

  it('draws a count on the right and reads it as the value (#153)', async () => {
    const { getByRole, getByText } = await render(
      <Checkbox label="Live" checked={false} onChange={noop} count="12" />,
    );
    expect(getByText('12')).toBeTruthy();
    expect(getByRole('checkbox', { name: 'Live' })).toHaveAccessibilityValue({ text: '12' });
  });

  it('has no value when there is no count', async () => {
    const { getByRole } = await render(<Checkbox label="Live" checked={false} onChange={noop} count="" />);
    expect(getByRole('checkbox').props.accessibilityValue?.text).toBeUndefined();
  });

  it('toggles on press', async () => {
    const onChange = jest.fn();
    const { getByRole } = await render(
      <Checkbox label="Agree" checked={false} onChange={onChange} />,
    );
    await fireEvent.press(getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('is lime with a near-black mark when checked — a glyph, not only a colour', async () => {
    const tree = await render(<Checkbox label="Agree" checked onChange={noop} />);
    const [mark] = tree.container.queryAll((node) => node.type === 'RNSVGSvgView');
    expect(mark?.props.color).toBe(colors.textOnLime);
    expect(drawn(tree, CHECKBOX_FILL)).toMatchObject({ backgroundColor: colors.lime500, opacity: 1 });
    expect(drawn(tree, CHECKBOX_MARK).opacity).toBe(1);
  });

  it('is a rounded square, not a circle', async () => {
    const tree = await render(<Checkbox label="Agree" checked onChange={noop} />);
    const radiusOf = Number(flat(tree.getByTestId(CHECKBOX_FILL)).borderRadius);
    expect(radiusOf).toBeGreaterThan(0);
    expect(radiusOf).toBeLessThan(radius.sm);
  });

  it('inverts on a white sheet: near-black box and white mark, where lime would have no edge', async () => {
    const tree = await render(
      <SurfaceProvider surface="white">
        <Checkbox label="Agree" checked onChange={noop} />
      </SurfaceProvider>,
    );
    const [mark] = tree.container.queryAll((node) => node.type === 'RNSVGSvgView');
    expect(mark?.props.color).toBe(colors.whiteSurface);
    expect(drawn(tree, CHECKBOX_FILL).backgroundColor).toBe(colors.surface1);
    expect(flat(tree.getByText('Agree')).color).toBe(TONES.white.primary);
  });

  it('springs the fill and the mark in, and gives the box the press scale', async () => {
    const ui = (checked: boolean) => <Checkbox label="Agree" checked={checked} onChange={noop} />;
    const tree = await render(ui(false));
    expect(pressScaleOf(tree, CHECKBOX_FILL)).toEqual([{ scale: 1 }]);
    expect(drawn(tree, CHECKBOX_MARK)).toMatchObject({
      opacity: 0,
      transform: [{ scale: MARK_ENTRY_SCALE }],
    });
    await tree.rerender(ui(true));
    expect(drawn(tree, CHECKBOX_FILL).opacity).toBeLessThan(1);
    await waitFor(
      () => {
        expect(drawn(tree, CHECKBOX_FILL).opacity).toBeCloseTo(1, 2);
        expect(drawn(tree, CHECKBOX_MARK).transform?.[0]?.scale).toBeCloseTo(1, 2);
      },
      { timeout: 3000 },
    );
  });

  it('is checked at once and does not scale under a budget of none', async () => {
    const ui = (checked: boolean) => (
      <MotionBudgetProvider level="none">
        <Checkbox label="Agree" checked={checked} onChange={noop} />
      </MotionBudgetProvider>
    );
    const tree = await render(ui(false));
    expect(pressScaleOf(tree, CHECKBOX_FILL)).toBeUndefined();
    await tree.rerender(ui(true));
    expect(drawn(tree, CHECKBOX_FILL).opacity).toBe(1);
    expect(drawn(tree, CHECKBOX_MARK)).toMatchObject({ opacity: 1, transform: [{ scale: 1 }] });
  });

  it('is checked at once under Reduce Motion', async () => {
    reduceMotionOnce();
    const ui = (checked: boolean) => <Checkbox label="Agree" checked={checked} onChange={noop} />;
    const tree = await render(ui(false));
    await waitFor(() => expect(pressScaleOf(tree, CHECKBOX_FILL)).toBeUndefined());
    await tree.rerender(ui(true));
    expect(drawn(tree, CHECKBOX_FILL).opacity).toBe(1);
  });

  it('announces an indeterminate box as mixed, and selects everything from there', async () => {
    const onChange = jest.fn();
    const { getByRole } = await render(
      <Checkbox label="Select all" checked={false} indeterminate onChange={onChange} />,
    );
    expect(getByRole('checkbox').props.accessibilityState).toMatchObject({ checked: 'mixed' });
    await fireEvent.press(getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('refuses a press while disabled', async () => {
    const onChange = jest.fn();
    const { getByRole } = await render(
      <Checkbox label="Agree" checked={false} disabled onChange={onChange} />,
    );
    await fireEvent.press(getByRole('checkbox'));
    expect(onChange).not.toHaveBeenCalled();
    expect(getByRole('checkbox').props.accessibilityState).toMatchObject({ disabled: true });
    expect(flat(getByRole('checkbox')).opacity).toBe(0.4);
  });

  it('draws its focus ring near-black on a lime surface, where lime would vanish', async () => {
    const { getByRole } = await render(
      <SurfaceProvider surface="lime">
        <Checkbox label="Agree" checked={false} onChange={noop} />
      </SurfaceProvider>,
    );
    await fireEvent(getByRole('checkbox'), 'focus');
    expect(flat(getByRole('checkbox')).outlineColor).toBe(colors.textOnLime);
  });
});

describe('RadioGroup and Radio', () => {
  const group = (onChange = jest.fn(), disabled = false) => (
    <RadioGroup label="Delivery" value="post" onChange={onChange} disabled={disabled}>
      <Radio value="post" label="Post" />
      <Radio value="pickup" label="Pick up" description="From the studio" />
      <Radio value="courier" label="Courier" disabled />
    </RadioGroup>
  );

  it('is a named radio group of radios, each with its checked state', async () => {
    const { getByLabelText, getByRole } = await render(group());
    expect(getByLabelText('Delivery').props.accessibilityRole).toBe('radiogroup');
    expect(getByRole('radio', { name: 'Post' }).props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(getByRole('radio', { name: 'Pick up' }).props.accessibilityState).toMatchObject({
      checked: false,
    });
  });

  it('makes each row at least 44pt tall', async () => {
    const { getAllByRole } = await render(group());
    for (const radio of getAllByRole('radio')) {
      expect(flat(radio).minHeight).toBeGreaterThanOrEqual(size.touchTarget);
    }
  });

  it('selects on press, with the selection haptic for a new choice only', async () => {
    jest.mocked(Haptics.selectionAsync).mockClear();
    const onChange = jest.fn();
    const { getByRole } = await render(group(onChange));
    await fireEvent.press(getByRole('radio', { name: 'Pick up' }));
    expect(onChange).toHaveBeenCalledWith('pickup');
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    await fireEvent.press(getByRole('radio', { name: 'Post' }));
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('refuses a disabled option, and every option in a disabled group', async () => {
    const onChange = jest.fn();
    const first = await render(group(onChange));
    await fireEvent.press(first.getByRole('radio', { name: 'Courier' }));
    expect(onChange).not.toHaveBeenCalled();

    const second = await render(group(onChange, true));
    await fireEvent.press(second.getByRole('radio', { name: 'Pick up' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(second.getByRole('radio', { name: 'Pick up' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  /** A radio's fill and dot, as drawn now. */
  const parts = (tree: Tree, name: string) => {
    const radio = within(tree.getByRole('radio', { name }));
    const read = (id: string) =>
      getAnimatedStyle(radio.getByTestId(id, { includeHiddenElements: true }) as never) as ViewStyle & {
        transform?: Record<string, number>[];
      };
    return { fill: read(RADIO_FILL), dot: read(RADIO_DOT) };
  };

  it('draws the selected option lime with a near-black 8pt dot', async () => {
    const tree = await render(group());
    const post = parts(tree, 'Post');
    expect(post.fill).toMatchObject({ backgroundColor: colors.lime500, opacity: 1 });
    expect(post.dot).toMatchObject({
      width: 8,
      height: 8,
      backgroundColor: colors.textOnLime,
      opacity: 1,
    });
    expect(parts(tree, 'Pick up').dot.opacity).toBe(0);
  });

  it('inverts on a white sheet: a near-black circle with a white dot', async () => {
    const tree = await render(<SurfaceProvider surface="white">{group()}</SurfaceProvider>);
    const post = parts(tree, 'Post');
    expect(post.fill.backgroundColor).toBe(colors.surface1);
    expect(post.dot.backgroundColor).toBe(colors.whiteSurface);
  });

  const controlled = (value: string, level?: 'none') => {
    const ui = (
      <RadioGroup label="Delivery" value={value} onChange={noop}>
        <Radio value="post" label="Post" />
        <Radio value="pickup" label="Pick up" />
      </RadioGroup>
    );
    return level === undefined ? ui : <MotionBudgetProvider level={level}>{ui}</MotionBudgetProvider>;
  };

  it('grows the dot in on a spring, and gives the circle the press scale', async () => {
    const tree = await render(controlled('post'));
    expect(pressScaleOf(tree, RADIO_FILL)).toEqual([{ scale: 1 }]);
    await tree.rerender(controlled('pickup'));
    expect(parts(tree, 'Pick up').dot.opacity).toBeLessThan(1);
    await waitFor(
      () => {
        const pickup = parts(tree, 'Pick up');
        expect(pickup.dot.opacity).toBeCloseTo(1, 2);
        expect(pickup.dot.transform?.[0]?.scale).toBeCloseTo(1, 2);
        expect(parts(tree, 'Post').fill.opacity).toBeCloseTo(0, 2);
      },
      { timeout: 3000 },
    );
  });

  it('moves the choice at once and does not scale under a budget of none', async () => {
    const tree = await render(controlled('post', 'none'));
    expect(pressScaleOf(tree, RADIO_FILL)).toBeUndefined();
    await tree.rerender(controlled('pickup', 'none'));
    expect(parts(tree, 'Pick up').dot.opacity).toBe(1);
    expect(parts(tree, 'Post').dot.opacity).toBe(0);
  });

  it('moves the choice at once under Reduce Motion', async () => {
    reduceMotionOnce();
    const tree = await render(controlled('post'));
    await waitFor(() => expect(pressScaleOf(tree, RADIO_FILL)).toBeUndefined());
    await tree.rerender(controlled('pickup'));
    expect(parts(tree, 'Pick up').dot.opacity).toBe(1);
  });

  it('passes an option’s language on, so VoiceOver pronounces it in that language', async () => {
    const { getByRole } = await render(
      <RadioGroup label="Language" value="en" onChange={noop}>
        <Radio value="ru" label="Русский" accessibilityLanguage="ru" />
      </RadioGroup>,
    );
    expect(getByRole('radio', { name: 'Русский' }).props.accessibilityLanguage).toBe('ru');
  });
});

describe('Switch', () => {
  beforeEach(() => jest.clearAllMocks());

  const knobOffset = (tree: Tree) => drawn(tree, SWITCH_KNOB).transform?.[0]?.translateX;

  it('is one switch named by its label, with its state', async () => {
    const { getByRole } = await render(
      <Switch label="Unlock with Face ID" value onValueChange={noop} />,
    );
    expect(
      getByRole('switch', { name: 'Unlock with Face ID' }).props.accessibilityState,
    ).toMatchObject({
      checked: true,
    });
  });

  it('is a row at least 44pt tall', async () => {
    const { getByRole } = await render(
      <Switch label="Alerts" value={false} onValueChange={noop} />,
    );
    expect(flat(getByRole('switch')).minHeight).toBeGreaterThanOrEqual(size.touchTarget);
  });

  it('flips on press', async () => {
    const onValueChange = jest.fn();
    const { getByRole } = await render(
      <Switch label="Alerts" value={false} onValueChange={onValueChange} />,
    );
    await fireEvent.press(getByRole('switch'));
    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  it('refuses a press while disabled', async () => {
    const onValueChange = jest.fn();
    const { getByRole } = await render(
      <Switch label="Alerts" value={false} disabled onValueChange={onValueChange} />,
    );
    await fireEvent.press(getByRole('switch'));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(getByRole('switch').props.accessibilityState).toMatchObject({ disabled: true });
  });

  /** The colours of a layer pair (off below, on above) and how much of the "on" one shows. */
  const layers = (tree: Tree) => {
    const knob = tree.getByTestId(SWITCH_KNOB, { includeHiddenElements: true });
    const track = knob.parent;
    if (track === null) throw new Error('no track');
    const offTrack = (track.children as { props: { style?: unknown } }[])[0];
    const [offKnob, onKnob] = knob.children as { props: { style?: unknown } }[];
    if (offTrack === undefined || offKnob === undefined || onKnob === undefined) {
      throw new Error('missing layers');
    }
    return {
      offTrack: flat(offTrack).backgroundColor,
      onTrack: drawn(tree, SWITCH_ON_LAYER).backgroundColor,
      offKnob: flat(offKnob).backgroundColor,
      onKnob: flat(onKnob).backgroundColor,
      on: drawn(tree, SWITCH_ON_LAYER).opacity,
    };
  };

  it('is a pill: surface-4 with a white knob off, and lime with a near-black knob on', async () => {
    const off = await render(<Switch label="Alerts" value={false} onValueChange={noop} />);
    expect(layers(off)).toMatchObject({
      offTrack: colors.surface4,
      offKnob: colors.whiteSurface,
      onTrack: colors.lime500,
      onKnob: colors.textOnLime,
      on: 0,
    });
    const track = off.getByTestId(SWITCH_KNOB).parent;
    expect(track === null ? undefined : flat(track).borderRadius).toBe(radius.full);

    const on = await render(<Switch label="Alerts" value onValueChange={noop} />);
    expect(layers(on).on).toBe(1);
    expect(knobOffset(on)).toBe(KNOB_TRAVEL);
  });

  it('inverts on a white sheet: near-black on, grey off, a white knob — and on-white words', async () => {
    const tree = await render(
      <SurfaceProvider surface="white">
        <Switch label="Alerts" value onValueChange={noop} />
      </SurfaceProvider>,
    );
    expect(layers(tree)).toMatchObject({
      offTrack: TONES.white.tertiary,
      onTrack: colors.surface1,
      offKnob: colors.whiteSurface,
      onKnob: colors.whiteSurface,
    });
    expect(flat(tree.getByText('Alerts')).color).toBe(TONES.white.primary);
  });

  it('sits the knob at its place with no animation under a budget of none', async () => {
    const tree = await render(
      <MotionBudgetProvider level="none">
        <Switch label="Alerts" value={false} onValueChange={noop} />
      </MotionBudgetProvider>,
    );
    expect(knobOffset(tree)).toBe(0);

    await tree.rerender(
      <MotionBudgetProvider level="none">
        <Switch label="Alerts" value onValueChange={noop} />
      </MotionBudgetProvider>,
    );
    // At its destination on the same frame: a state change, not a fast animation.
    expect(knobOffset(tree)).toBe(KNOB_TRAVEL);
  });

  it('slides the knob 20pt on translateX on a spring, and crossfades the track', async () => {
    const tree = await render(
      <MotionBudgetProvider level="full">
        <Switch label="Alerts" value={false} onValueChange={noop} />
      </MotionBudgetProvider>,
    );
    expect(pressScaleOf(tree, SWITCH_ON_LAYER)).toEqual([{ scale: 1 }]);
    await tree.rerender(
      <MotionBudgetProvider level="full">
        <Switch label="Alerts" value onValueChange={noop} />
      </MotionBudgetProvider>,
    );
    expect(KNOB_TRAVEL).toBe(20);
    // Travelling, not teleported: on the frame of the change it has not arrived.
    expect(knobOffset(tree)).toBeLessThan(KNOB_TRAVEL);
    await waitFor(
      () => {
        expect(knobOffset(tree)).toBeCloseTo(KNOB_TRAVEL, 1);
        expect(layers(tree).on).toBeCloseTo(1, 2);
      },
      { timeout: 3000 },
    );
  });

  it('gives the track no press scale under a budget of none', async () => {
    const tree = await render(
      <MotionBudgetProvider level="none">
        <Switch label="Alerts" value={false} onValueChange={noop} />
      </MotionBudgetProvider>,
    );
    expect(pressScaleOf(tree, SWITCH_ON_LAYER)).toBeUndefined();
  });

  it('sits the knob at its place with no animation when Reduce Motion is on, whatever the budget', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(true);
    const tree = await render(
      <MotionBudgetProvider level="full">
        <Switch label="Alerts" value={false} onValueChange={noop} />
      </MotionBudgetProvider>,
    );
    // Let the platform's answer arrive.
    await act(async () => {});

    await tree.rerender(
      <MotionBudgetProvider level="full">
        <Switch label="Alerts" value onValueChange={noop} />
      </MotionBudgetProvider>,
    );
    expect(knobOffset(tree)).toBe(KNOB_TRAVEL);
  });
});
