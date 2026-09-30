import { createRef, type ReactElement, type ReactNode } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, type TextInput as RNTextInput } from 'react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import { colors, size } from '../../theme';
import { Field } from './field';
import { PasswordInput } from './password-input';
import { Radio, RadioGroup } from './radio';
import { TextInput } from './text-input';
import { Textarea, TEXTAREA_MIN_HEIGHT } from './textarea';

/**
 * The form's wiring, as a screen reader meets it: a label that is the control's name, "required"
 * said in words, a hint read as the hint, and an error that is drawn, announced and marks the
 * control invalid. Then the input skin's states and the two inputs built on it.
 *
 * <p>Every `render` is awaited — asynchronous from `@testing-library/react-native` v14.
 */

function English({ children }: { children: ReactNode }) {
  return (
    <IntlProvider locale="en" messages={en}>
      {children}
    </IntlProvider>
  );
}

const renderEn = (ui: ReactElement) => render(ui, { wrapper: English });

function flat(element: { props: { style?: unknown } }) {
  const { style } = element.props;
  return StyleSheet.flatten(typeof style === 'function' ? style({ pressed: false }) : style) ?? {};
}

/** The input skin's frame: the view the text input sits in. */
function frameOf(input: { parent: unknown }) {
  const frame = input.parent as { props: { style?: unknown } } | null;
  if (frame === null) throw new Error('the input has no frame');
  return flat(frame);
}

describe('Field', () => {
  beforeEach(() => jest.clearAllMocks());

  it('names its control with the label, and does not read the label a second time', async () => {
    const { getByLabelText, getByText } = await renderEn(
      <Field label="Email address">
        <TextInput />
      </Field>,
    );
    expect(getByLabelText('Email address')).toBeTruthy();
    // The visible label is hidden from the screen reader: the input already says it.
    expect(() => getByText('Email address')).toThrow();
    expect(getByText('Email address', { includeHiddenElements: true })).toBeTruthy();
  });

  it('says "required" in words, visibly and in the accessible name — never only an asterisk', async () => {
    const { getByLabelText, getByText, queryByText } = await renderEn(
      <Field label="Email address" required>
        <TextInput />
      </Field>,
    );
    expect(getByLabelText('Email address, required')).toBeTruthy();
    expect(getByText(en.mobile.kitForm.required, { includeHiddenElements: true })).toBeTruthy();
    expect(queryByText('*', { includeHiddenElements: true })).toBeNull();
  });

  it('says it in the reader’s language', async () => {
    const { getByLabelText } = await render(
      <IntlProvider locale="ru" messages={ru}>
        <Field label="Эл. почта" required>
          <TextInput />
        </Field>
      </IntlProvider>,
    );
    expect(getByLabelText('Эл. почта, обязательно')).toBeTruthy();
  });

  it('hands its hint to the control as the accessibility hint', async () => {
    const { getByLabelText } = await renderEn(
      <Field label="Password" hint="Long is stronger than complicated.">
        <PasswordInput />
      </Field>,
    );
    expect(getByLabelText('Password').props.accessibilityHint).toBe(
      'Long is stronger than complicated.',
    );
  });

  it('draws an error in danger with an icon, puts it in the control’s hint, and announces it once', async () => {
    const announced = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions');
    const tree = await renderEn(
      <Field label="Email address" error="Enter an email address.">
        <TextInput />
      </Field>,
    );

    const input = tree.getByLabelText('Email address');
    // Heard again whenever somebody comes back to the field, not only when it appeared.
    expect(input.props.accessibilityHint).toBe('Enter an email address.');
    expect(input.props).not.toHaveProperty('aria-invalid');
    expect(frameOf(input).borderColor).toBe(colors.danger);
    expect(flat(tree.getByText('Enter an email address.')).color).toBe(colors.danger);
    expect(tree.container.queryAll((node) => node.type === 'RNSVGSvgView')[0]?.props.stroke).toBe(
      colors.danger,
    );
    expect(announced).toHaveBeenCalledTimes(1);
    expect(announced).toHaveBeenCalledWith('Enter an email address.', { queue: false });

    // A re-render with the same error is not a new error.
    await tree.rerender(
      <Field label="Email address" error="Enter an email address.">
        <TextInput />
      </Field>,
    );
    expect(announced).toHaveBeenCalledTimes(1);
  });

  it('reads the error before the hint, as separate sentences', async () => {
    const { getByLabelText } = await renderEn(
      <Field label="Password" hint="Long is stronger than complicated" error="Enter a password">
        <PasswordInput />
      </Field>,
    );
    expect(getByLabelText('Password').props.accessibilityHint).toBe(
      'Enter a password. Long is stronger than complicated',
    );
  });

  it('has no error in the hint, and announces nothing, without an error', async () => {
    const announced = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions');
    const { getByLabelText } = await renderEn(
      <Field label="Email address">
        <TextInput />
      </Field>,
    );
    expect(getByLabelText('Email address').props.accessibilityHint).toBeUndefined();
    expect(frameOf(getByLabelText('Email address')).borderColor).toBe(colors.border);
    expect(announced).not.toHaveBeenCalled();
  });

  it('asks a grouped field’s question as one header, required word included', async () => {
    const { getAllByLabelText, getByRole, getByText } = await renderEn(
      <Field label="Delivery" grouped required hint="Post takes a week.">
        <RadioGroup value="post" onChange={() => {}}>
          <Radio value="post" label="Post" />
          <Radio value="pickup" label="Pick up" />
        </RadioGroup>
      </Field>,
    );
    /*
     * VoiceOver on the new architecture does not read the label of a container that is not itself
     * accessible, so the question is the visible label, made one header stop.
     */
    expect(getByRole('header', { name: 'Delivery, required' })).toBeTruthy();
    // The radios stay separately reachable, and the group still carries its name for TalkBack.
    expect(getByRole('radio', { name: 'Post' })).toBeTruthy();
    expect(
      getAllByLabelText('Delivery, required').map((node) => node.props.accessibilityRole),
    ).toEqual(['header', 'radiogroup']);
    // With no single control to hold it, the hint stays readable where it is drawn.
    expect(getByText('Post takes a week.')).toBeTruthy();
  });

  it('keeps an ordinary field’s label out of the screen reader — the control says it', async () => {
    const { queryByRole } = await renderEn(
      <Field label="Email address" required>
        <TextInput />
      </Field>,
    );
    expect(queryByRole('header')).toBeNull();
  });
});

describe('TextInput', () => {
  it('is 44pt by default and 48pt at lg — the touch target, and no smaller size exists', async () => {
    const heights = [];
    for (const inputSize of ['md', 'lg'] as const) {
      const { getByLabelText } = await renderEn(
        <TextInput accessibilityLabel="Title" size={inputSize} />,
      );
      // A minimum, not a fixed height: Dynamic Type may make the text taller than the box.
      heights.push(frameOf(getByLabelText('Title')).minHeight);
    }
    expect(heights).toEqual([44, 48]);
    expect(Math.min(...(heights as number[]))).toBeGreaterThanOrEqual(size.touchTarget);
  });

  it('wears the input skin: surface-3, a hairline border, radius 14, a tertiary placeholder', async () => {
    const { getByLabelText } = await renderEn(
      <TextInput accessibilityLabel="Title" placeholder="A short title" />,
    );
    const input = getByLabelText('Title');
    expect(frameOf(input)).toMatchObject({
      backgroundColor: colors.surface3,
      borderColor: colors.border,
      borderRadius: 14,
    });
    expect(input.props.placeholderTextColor).toBe(colors.textTertiary);
  });

  it('draws the strong border AND the lime ring when focused', async () => {
    const { getByLabelText } = await renderEn(<TextInput accessibilityLabel="Title" />);
    const input = getByLabelText('Title');
    await fireEvent(input, 'focus');
    expect(frameOf(getByLabelText('Title'))).toMatchObject({
      borderColor: colors.borderStrong,
      outlineColor: colors.lime500,
      outlineWidth: 2,
    });

    await fireEvent(getByLabelText('Title'), 'blur');
    expect(frameOf(getByLabelText('Title')).outlineWidth).toBeUndefined();
  });

  it('is not editable and dims to 40% when disabled, and says so', async () => {
    const { getByLabelText } = await renderEn(<TextInput accessibilityLabel="Title" disabled />);
    const input = getByLabelText('Title');
    expect(input.props.editable).toBe(false);
    expect(input.props.accessibilityState).toMatchObject({ disabled: true });
    expect(frameOf(input).opacity).toBe(0.4);
  });

  it('forwards its ref, so a form can move on with returnKeyType="next"', async () => {
    const ref = createRef<RNTextInput>();
    await renderEn(<TextInput ref={ref} accessibilityLabel="Title" returnKeyType="next" />);
    expect(ref.current).not.toBeNull();
  });
});

describe('PasswordInput', () => {
  it('hides the password, and offers to show it with the catalogue’s words', async () => {
    const { getByLabelText, getByRole } = await renderEn(
      <Field label="Password">
        <PasswordInput />
      </Field>,
    );
    expect(getByLabelText('Password').props.secureTextEntry).toBe(true);
    const toggle = getByRole('button', { name: en.auth.fields.showPassword });
    expect(toggle.props.accessibilityState).toMatchObject({ selected: false });
  });

  it('shows it on press, then names the toggle for what it will do next', async () => {
    const { getByLabelText, getByRole } = await renderEn(
      <Field label="Password">
        <PasswordInput />
      </Field>,
    );
    await fireEvent.press(getByRole('button', { name: en.auth.fields.showPassword }));

    expect(getByLabelText('Password').props.secureTextEntry).toBe(false);
    const toggle = getByRole('button', { name: en.auth.fields.hidePassword });
    expect(toggle.props.accessibilityState).toMatchObject({ selected: true });
  });

  it('cannot be revealed while disabled', async () => {
    const { getByLabelText, getByRole } = await renderEn(
      <PasswordInput accessibilityLabel="Password" disabled />,
    );
    await fireEvent.press(getByRole('button', { name: en.auth.fields.showPassword }));
    expect(getByLabelText('Password').props.secureTextEntry).toBe(true);
  });
});

describe('Textarea', () => {
  const grow = async (contentHeight: number, maxHeight?: number) => {
    const { getByLabelText } = await renderEn(
      <Textarea accessibilityLabel="Story" maxHeight={maxHeight} />,
    );
    await fireEvent(getByLabelText('Story'), 'contentSizeChange', {
      nativeEvent: { contentSize: { width: 300, height: contentHeight } },
    });
    const input = getByLabelText('Story');
    return { height: frameOf(input).height, scrolls: input.props.scrollEnabled };
  };

  it('is 96pt at rest, the web’s minimum', async () => {
    expect(await grow(20)).toEqual({ height: TEXTAREA_MIN_HEIGHT, scrolls: false });
  });

  it('grows with its content', async () => {
    // The content height already includes the input's padding, so it is the box's height.
    expect(await grow(150)).toEqual({ height: 150, scrolls: false });
  });

  it('stops at its maximum, and then scrolls', async () => {
    expect(await grow(900, 200)).toEqual({ height: 200, scrolls: true });
  });

  it('starts scrolling at the maximum, not a padding’s worth before it', async () => {
    expect(await grow(190, 200)).toEqual({ height: 190, scrolls: false });
    expect(await grow(200, 200)).toEqual({ height: 200, scrolls: true });
  });

  it('is multi-line and named', async () => {
    const { getByLabelText } = await renderEn(<Textarea accessibilityLabel="Story" />);
    expect(getByLabelText('Story').props.multiline).toBe(true);
  });
});

// Compile-time checks: the web's `sm` input cannot meet the touch target and does not exist here.
function _typeChecks() {
  // @ts-expect-error — no `sm` on native: 36pt is under the 44pt target.
  void (<TextInput accessibilityLabel="Title" size="sm" />);
  // @ts-expect-error — a password input's reveal button is its own; it takes no other trailing slot.
  void (<PasswordInput accessibilityLabel="Password" trailing={null} />);
}
void _typeChecks;
