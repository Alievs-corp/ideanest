import { createRef, useState, type ReactElement, type ReactNode } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Keyboard,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { colors, radius, size, tint } from '../../theme';
import { Field } from './field';
import { MotionBudgetProvider } from './motion-budget';
import { Select, type SelectOption } from './select';
import { Sheet } from './sheet';

/**
 * The sheet, and the select that is its main consumer. The sheet's contract is every way out
 * (the X, the handle as a button, Android back, the iOS escape gesture) and the dialog's focus
 * move; the select's is the round trip — open the sheet, pick, the sheet closes, and focus is
 * back on the field.
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

function sheet(visible: boolean, onClose = jest.fn(), opener = createRef<View>()) {
  return (
    <>
      <View ref={opener} />
      <Sheet
        visible={visible}
        onClose={onClose}
        title="Currency"
        returnFocusTo={opener}
        testID="sheet"
      >
        <Text>Azerbaijani manat</Text>
      </Sheet>
    </>
  );
}

type FocusCall = [unknown, string];
const focusTargets = () =>
  (jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls as FocusCall[])
    .filter(([, type]) => type === 'focus')
    .map(([node]) => node);

describe('Sheet', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders nothing while hidden, and its title and body while visible', async () => {
    const hidden = await renderEn(sheet(false));
    expect(hidden.queryByText('Currency')).toBeNull();

    const shown = await renderEn(sheet(true));
    expect(shown.getByRole('header', { name: 'Currency' })).toBeTruthy();
    expect(shown.getByText('Azerbaijani manat')).toBeTruthy();
  });

  it('is a dark surface-2 panel with a 28pt top radius, at most 85% tall, over a black/64 scrim', async () => {
    const { getByTestId, container } = await renderEn(sheet(true));
    expect(flat(getByTestId('sheet'))).toMatchObject({
      backgroundColor: colors.surface2,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      maxHeight: '85%',
    });
    expect(
      container.queryAll(
        (node) => node.type === 'View' && flat(node).backgroundColor === tint(colors.black, 0.64),
      ),
    ).toHaveLength(1);
  });

  it('closes from its X, from the handle as a named button, and from Android back', async () => {
    const onClose = jest.fn();
    const { getByRole, container } = await renderEn(sheet(true, onClose));

    await fireEvent.press(getByRole('button', { name: en.mobile.kitForm.close }));
    const handle = getByRole('button', { name: en.mobile.kitForm.grabber });
    expect(handle.props.accessibilityHint).toBe(en.mobile.kitForm.grabberHint);
    await fireEvent.press(handle);
    container.queryAll((node) => node.type === 'Modal')[0]?.props.onRequestClose();

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('gives the handle a 44pt target though it draws a 4pt bar', async () => {
    const { getByRole } = await renderEn(sheet(true));
    const handle = getByRole('button', { name: en.mobile.kitForm.grabber });
    const slop = handle.props.hitSlop as { top: number; bottom: number };
    expect(Number(flat(handle).height) + slop.top + slop.bottom).toBeGreaterThanOrEqual(
      size.touchTarget,
    );
  });

  it('is modal to VoiceOver and closes on the escape gesture', async () => {
    const onClose = jest.fn();
    const { getByTestId } = await renderEn(sheet(true, onClose));
    expect(getByTestId('sheet').props.accessibilityViewIsModal).toBe(true);
    await fireEvent(getByTestId('sheet'), 'accessibilityEscape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus to its title on open and back to the opener on close', async () => {
    const opener = createRef<View>();
    const onClose = jest.fn();
    const tree = await renderEn(sheet(true, onClose, opener));
    await waitFor(() =>
      expect(
        focusTargets().some(
          (node) => (node as { props?: { children?: unknown } }).props?.children === 'Currency',
        ),
      ).toBe(true),
    );

    await tree.rerender(sheet(false, onClose, opener));
    await waitFor(() => expect(focusTargets().at(-1) === opener.current).toBe(true));
  });

  it('avoids the keyboard on iOS, and lets a tap reach a button under an open keyboard', async () => {
    // A class component with no host of its own that keeps the prop, so its render is watched.
    const avoiding = jest.spyOn(KeyboardAvoidingView.prototype, 'render');
    const { getByText } = await renderEn(sheet(true));
    const [instance] = avoiding.mock.contexts as { props: { behavior?: string } }[];
    expect(instance?.props.behavior).toBe('padding');
    avoiding.mockRestore();
    let node = getByText('Azerbaijani manat').parent;
    while (node !== null && node.props.keyboardShouldPersistTaps === undefined) node = node.parent;
    expect(node?.props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('hands the Modal its onDismiss, for what must open only after it has gone', async () => {
    const onDismiss = jest.fn();
    const { container } = await renderEn(
      <Sheet visible onClose={() => {}} title="Currency" onDismiss={onDismiss}>
        <Text>Azerbaijani manat</Text>
      </Sheet>,
    );
    container.queryAll((node) => node.type === 'Modal')[0]?.props.onDismiss();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('enters without an animated style under a budget of none', async () => {
    const { getByText } = await renderEn(
      <MotionBudgetProvider level="none">{sheet(true)}</MotionBudgetProvider>,
    );
    // The body's container, inside the drag layer: no entry opacity on it.
    let node = getByText('Azerbaijani manat').parent;
    while (node !== null && flat(node).opacity === undefined && node.props.testID !== 'sheet') {
      node = node.parent;
    }
    expect(node?.props.testID).toBe('sheet');
  });
});

const CURRENCIES: readonly SelectOption[] = [
  { value: 'AZN', label: 'Azerbaijani manat' },
  { value: 'EUR', label: 'Euro' },
  { value: 'TRY', label: 'Türk lirası', accessibilityLanguage: 'tr' },
];

function CurrencyField({ onChange = jest.fn() }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <Field label="Currency" required hint="Amounts are shown in this currency.">
      <Select
        options={CURRENCIES}
        value={value}
        placeholder="Choose a currency"
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    </Field>
  );
}

describe('Select', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is a combobox named by its field, announcing the placeholder as its value', async () => {
    const { getByRole } = await renderEn(<CurrencyField />);
    const combobox = getByRole('combobox', { name: 'Currency, required' });
    expect(combobox.props.accessibilityValue).toEqual({ text: 'Choose a currency' });
    expect(combobox.props.accessibilityHint).toBe('Amounts are shown in this currency.');
    expect(combobox.props.accessibilityState).toMatchObject({ expanded: false });
    expect(flat(combobox).minHeight).toBeGreaterThanOrEqual(size.touchTarget);
  });

  it('opens the sheet, picks, closes, and returns focus to the field', async () => {
    const onChange = jest.fn();
    const { getByRole, queryByRole } = await renderEn(<CurrencyField onChange={onChange} />);

    const dismissed = jest.spyOn(Keyboard, 'dismiss');
    await fireEvent.press(getByRole('combobox', { name: 'Currency, required' }));
    // The keyboard goes first, or it covers the options.
    expect(dismissed).toHaveBeenCalled();
    // The title is the plain question: the required word belongs to the field's name, not here.
    expect(getByRole('header', { name: 'Currency' })).toBeTruthy();
    expect(queryByRole('header', { name: 'Currency, required' })).toBeNull();
    expect(getByRole('radio', { name: 'Türk lirası' }).props.accessibilityLanguage).toBe('tr');

    await fireEvent.press(getByRole('radio', { name: 'Euro' }));
    expect(onChange).toHaveBeenCalledWith('EUR');
    expect(queryByRole('radio', { name: 'Euro' })).toBeNull();

    const combobox = getByRole('combobox', { name: 'Currency, required' });
    expect(combobox.props.accessibilityValue).toEqual({ text: 'Euro' });
    await waitFor(() =>
      expect(
        focusTargets().some(
          (node) =>
            (node as { props?: { accessibilityRole?: unknown } }).props?.accessibilityRole ===
            'combobox',
        ),
      ).toBe(true),
    );
  });

  it('does not open while disabled', async () => {
    const { getByRole, queryByRole } = await renderEn(
      <Select label="Currency" options={CURRENCIES} value="AZN" disabled onChange={() => {}} />,
    );
    await fireEvent.press(getByRole('combobox'));
    expect(queryByRole('radio')).toBeNull();
    expect(getByRole('combobox').props.accessibilityState).toMatchObject({ disabled: true });
  });
});
