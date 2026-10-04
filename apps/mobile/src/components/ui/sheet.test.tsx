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
import { getAnimatedStyle } from 'react-native-reanimated';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { Body } from '../text';
import { colors, radius, size, tint } from '../../theme';
import { Field } from './field';
import { MotionBudgetProvider } from './motion-budget';
import { Select, type SelectOption } from './select';
import { SHEET_PAGE_SCALE, Sheet, SheetHost, dragDismisses, pageScale, sheetRise } from './sheet';
import { TONES } from './surface';

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

  it('is a white sheet with a 28pt top radius, at most 85% tall, over a black/64 scrim', async () => {
    const { getByTestId, getByRole, container } = await renderEn(sheet(true));
    expect(flat(getByTestId('sheet'))).toMatchObject({
      backgroundColor: colors.whiteSurface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      maxHeight: '85%',
    });
    // Its own words in the white surface's tones: dark text tokens are never used on white.
    expect(flat(getByRole('header', { name: 'Currency' })).color).toBe(TONES.white.primary);
    expect(
      container.queryAll(
        (node) => node.type === 'View' && flat(node).backgroundColor === tint(colors.black, 0.64),
      ),
    ).toHaveLength(1);
  });

  it('puts what it holds on the white surface, so kit text reads on it', async () => {
    const { getByText } = await renderEn(
      <Sheet visible onClose={jest.fn()} title="Currency">
        <Body>Azerbaijani manat</Body>
      </Sheet>,
    );
    expect(flat(getByText('Azerbaijani manat')).color).toBe(TONES.white.secondary);
  });

  it('keeps the earlier dark panel for overlays #282 has not moved', async () => {
    const { getByTestId, getByRole } = await renderEn(
      <Sheet visible onClose={jest.fn()} title="Currency" surface="dark" testID="sheet">
        <Text>Azerbaijani manat</Text>
      </Sheet>,
    );
    expect(flat(getByTestId('sheet')).backgroundColor).toBe(colors.surface2);
    expect(flat(getByRole('header', { name: 'Currency' })).color).toBe(TONES.dark.primary);
  });

  it('stays mounted while it falls, out of reach and unheard, then goes and reports it', async () => {
    const onDismiss = jest.fn();
    const ui = (visible: boolean) => (
      <Sheet visible={visible} onClose={jest.fn()} onDismiss={onDismiss} title="Currency" testID="sheet">
        <Text>Azerbaijani manat</Text>
      </Sheet>
    );
    const view = await renderEn(ui(true));
    await view.rerender(ui(false));

    // How far the fall has got by now depends on the runner's speed; whatever is still drawn
    // takes no touch and says nothing, and nothing in it can be reached.
    const panel = view.queryByTestId('sheet', { includeHiddenElements: true });
    if (panel !== null) {
      expect(panel.props.pointerEvents).toBe('none');
      expect(panel.props.accessibilityElementsHidden).toBe(true);
    }
    expect(view.queryByRole('header', { name: 'Currency' })).toBeNull();

    await waitFor(
      () => expect(view.queryByText('Azerbaijani manat', { includeHiddenElements: true })).toBeNull(),
      { timeout: 3000 },
    );
  });

  it('with motion off, goes at once', async () => {
    const ui = (visible: boolean) => (
      <MotionBudgetProvider level="none">
        <Sheet visible={visible} onClose={jest.fn()} title="Currency">
          <Text>Azerbaijani manat</Text>
        </Sheet>
      </MotionBudgetProvider>
    );
    const view = await renderEn(ui(true));
    await view.rerender(ui(false));
    expect(view.queryByText('Azerbaijani manat', { includeHiddenElements: true })).toBeNull();
  });

  it('closes on a long pull or a flick, and springs back from a short slow one', () => {
    expect(dragDismisses(120, 0.2)).toBe(true);
    expect(dragDismisses(40, 1.4)).toBe(true);
    expect(dragDismisses(40, 0.3)).toBe(false);
  });

  it('scales the page behind to 0.96 in step with its rise, and leaves it whole at rest', async () => {
    expect(sheetRise(0, 400)).toBe(1);
    expect(sheetRise(200, 400)).toBe(0.5);
    expect(sheetRise(400, 400)).toBe(0);
    expect(sheetRise(-20, 400)).toBe(1);
    expect(pageScale(0)).toBe(1);
    expect(pageScale(1)).toBeCloseTo(SHEET_PAGE_SCALE, 5);

    const view = await renderEn(
      <SheetHost>
        <View testID="page" />
      </SheetHost>,
    );
    const host = view.getByTestId('page').parent as never;
    expect(flat(host).transform).toEqual([{ scale: 1 }]);
  });

  it('keeps the page scaled while it is up, though a closed sheet mounts or goes beside it', async () => {
    const page = (extra: boolean) => (
      <SheetHost>
        <View testID="page" />
        <Sheet visible onClose={jest.fn()} title="Currency">
          <Text>Azerbaijani manat</Text>
        </Sheet>
        {extra ? (
          <Sheet visible={false} onClose={jest.fn()} title="Other">
            <Text>Other</Text>
          </Sheet>
        ) : null}
      </SheetHost>
    );
    const view = await renderEn(page(false));
    const scale = () =>
      (getAnimatedStyle(view.getByTestId('page').parent as never) as { transform?: { scale: number }[] })
        .transform?.[0]?.scale;
    await waitFor(() => expect(scale()).toBeCloseTo(SHEET_PAGE_SCALE, 2), { timeout: 3000 });
    await view.rerender(page(true));
    await view.rerender(page(false));
    expect(scale()).toBeCloseTo(SHEET_PAGE_SCALE, 2);
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
