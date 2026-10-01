import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { colors, size } from '../../theme';
import { Checkbox } from './checkbox';
import { MotionBudgetProvider } from './motion-budget';
import { Radio, RadioGroup } from './radio';
import { SurfaceProvider } from './surface';
import { KNOB_TRAVEL, Switch, SWITCH_KNOB } from './switch';

/**
 * The three toggles share one shape — the whole row is the control — so they share the checks
 * that shape exists for: one accessible element with the right role and state, a row a thumb
 * can hit, and a press that does nothing while disabled. Then each one's own visual rule, and
 * the switch's motion, which has to stop for Reduce Motion and for a `none` budget.
 */

const noop = () => {};

function flat(element: { props: { style?: unknown } }) {
  const { style } = element.props;
  return StyleSheet.flatten(typeof style === 'function' ? style({ pressed: false }) : style) ?? {};
}

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
    const { container } = await render(<Checkbox label="Agree" checked onChange={noop} />);
    const [mark] = container.queryAll((node) => node.type === 'RNSVGSvgView');
    expect(mark?.props.stroke).toBe(colors.textOnLime);
    const limeBoxes = container.queryAll(
      (node) => node.type === 'View' && flat(node).backgroundColor === colors.lime500,
    );
    expect(limeBoxes).toHaveLength(1);
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

  it('selects on press', async () => {
    const onChange = jest.fn();
    const { getByRole } = await render(group(onChange));
    await fireEvent.press(getByRole('radio', { name: 'Pick up' }));
    expect(onChange).toHaveBeenCalledWith('pickup');
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

  it('draws the selected option lime with a near-black 8pt dot', async () => {
    const { getByRole } = await render(group());
    const circle = getByRole('radio', { name: 'Post' }).children[0];
    if (typeof circle === 'string' || circle === undefined) throw new Error('no circle');
    expect(flat(circle).backgroundColor).toBe(colors.lime500);
    const dot = circle.children[0];
    if (typeof dot === 'string' || dot === undefined) throw new Error('no dot');
    expect(flat(dot)).toMatchObject({ width: 8, height: 8, backgroundColor: colors.textOnLime });
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

  const knobOffset = (tree: Awaited<ReturnType<typeof render>>) => {
    const transform = flat(tree.getByTestId(SWITCH_KNOB)).transform as
      { translateX?: number }[] | undefined;
    return transform?.[0]?.translateX;
  };

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

  it('is surface-4 with a white knob off, and lime with a near-black knob on', async () => {
    const off = await render(<Switch label="Alerts" value={false} onValueChange={noop} />);
    const offKnob = off.getByTestId(SWITCH_KNOB);
    expect(flat(offKnob).backgroundColor).toBe(colors.whiteSurface);
    const offTrack = offKnob.parent;
    expect(offTrack === null ? undefined : flat(offTrack).backgroundColor).toBe(colors.surface4);

    const on = await render(<Switch label="Alerts" value onValueChange={noop} />);
    const onKnob = on.getByTestId(SWITCH_KNOB);
    expect(flat(onKnob).backgroundColor).toBe(colors.textOnLime);
    const onTrack = onKnob.parent;
    expect(onTrack === null ? undefined : flat(onTrack).backgroundColor).toBe(colors.lime500);
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

  it('moves the knob 20pt on translateX where motion is allowed', async () => {
    const tree = await render(
      <MotionBudgetProvider level="full">
        <Switch label="Alerts" value={false} onValueChange={noop} />
      </MotionBudgetProvider>,
    );
    await tree.rerender(
      <MotionBudgetProvider level="full">
        <Switch label="Alerts" value onValueChange={noop} />
      </MotionBudgetProvider>,
    );
    expect(KNOB_TRAVEL).toBe(20);
    /*
     * Travelling, not teleported: on the frame of the change it has not arrived, which is the
     * difference from the two cases above. Reanimated's frame loop does not run under Jest, so
     * the arrival itself is not observable here — what is, is that this path animates and the
     * other two do not.
     */
    expect(knobOffset(tree)).toBe(0);
  });
});
