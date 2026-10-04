import { createRef, useState, type ReactElement, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { AccessibilityInfo } from 'react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { AmountKeypad, type AmountKeypadHandle, type KeypadSettle } from './amount-keypad';
import { Field } from './field';
import { MotionBudgetProvider } from './motion-budget';

/**
 * `AmountKeypad` (#280): the amount changes on the press itself, arithmetic is exact and rounded
 * at the result, refusals are drawn at once, and the field gets a clean amount string.
 */

const K = en.mobile.kitMoney;

function English({ children }: { children: ReactNode }) {
  return (
    <IntlProvider locale="en" messages={en}>
      {children}
    </IntlProvider>
  );
}

const renderEn = (ui: ReactElement) => render(ui, { wrapper: English });

/** A screen holding the amount the way `useCheckout` does: a string, set from outside too. */
function Holder({
  initial = '',
  max,
  onValue,
  external,
}: {
  readonly initial?: string;
  readonly max?: string;
  readonly onValue?: (value: string) => void;
  readonly external?: string;
}) {
  const [value, setValue] = useState(initial);
  const [seen, setSeen] = useState(external);
  if (external !== seen) {
    setSeen(external);
    if (external !== undefined) setValue(external);
  }
  return (
    <Field label="Your contribution" grouped>
      <AmountKeypad
        value={value}
        onChange={(next) => {
          setValue(next);
          onValue?.(next);
        }}
        currency="AZN"
        max={max}
        overLimitMessage={en.checkout.errors.amountTooLarge}
      />
    </Field>
  );
}

async function press(...keys: string[]) {
  for (const key of keys) {
    const id = key === '.' ? 'point' : key === '<' ? 'backspace' : key;
    await fireEvent.press(screen.getByTestId(`amount-keypad-key-${id}`));
  }
}

const amount = () => screen.getByTestId('amount-keypad-amount');

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe('AmountKeypad', () => {
  it('shows the digit in the amount on the press itself, with no wait for the animation', async () => {
    const values: string[] = [];
    await renderEn(<Holder onValue={(value) => values.push(value)} />);
    expect(amount()).toHaveAccessibleName('Your contribution, 0 AZN');

    await fireEvent.press(screen.getByTestId('amount-keypad-key-7'));
    // No waitFor: the value is the press's own result, the rise is decoration.
    expect(amount()).toHaveAccessibleName('Your contribution, 7 AZN');
    expect(within(amount()).getByText('7', { includeHiddenElements: true })).toBeTruthy();
    expect(values).toEqual(['7']);
  });

  it('fires a selection haptic per key', async () => {
    await renderEn(<Holder />);
    await press('1', '2', '.');
    expect(jest.mocked(Haptics.selectionAsync)).toHaveBeenCalledTimes(3);
  });

  it('replaces leading zeros and stops at the minor units', async () => {
    const values: string[] = [];
    await renderEn(<Holder onValue={(value) => values.push(value)} />);
    await press('0', '0', '5', '.', '2', '5', '9');
    expect(amount()).toHaveAccessibleName('Your contribution, 5.25 AZN');
    // The point alone is not handed on as an amount; the refused third decimal changes nothing.
    expect(values).toEqual(['0', '5', '5.2', '5.25']);
  });

  it('groups the amount as it grows', async () => {
    await renderEn(<Holder />);
    await press('1', '2', '3', '4', '5');
    expect(amount()).toHaveAccessibleName('Your contribution, 12,345 AZN');
  });

  it('backspaces a digit, and names its keys for a screen reader', async () => {
    await renderEn(<Holder initial="45.5" />);
    expect(screen.getByRole('keyboardkey', { name: K.backspace })).toBeTruthy();
    expect(screen.getByRole('keyboardkey', { name: K.point })).toBeTruthy();
    expect(screen.getByRole('keyboardkey', { name: '7' })).toBeTruthy();
    await press('<');
    expect(amount()).toHaveAccessibleName('Your contribution, 45. AZN');
    await press('<');
    expect(amount()).toHaveAccessibleName('Your contribution, 45 AZN');
  });

  it('shows the operation muted, a result chip, and commits it with a roll to the exact value', async () => {
    const values: string[] = [];
    await renderEn(<Holder onValue={(value) => values.push(value)} />);
    await press('1', '4', '3');
    await fireEvent.press(screen.getByRole('button', { name: K.multiply }));
    expect(screen.getByRole('button', { name: K.multiply })).toBeSelected();
    await press('2');
    expect(screen.getByTestId('amount-keypad-operation', { includeHiddenElements: true })).toHaveTextContent('× 2');
    expect(amount()).toHaveAccessibleName('Your contribution, 143 AZN Times 2');

    const chip = screen.getByRole('button', { name: 'Use the result: 286 AZN' });
    expect(screen.getByText('= 286', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(chip);
    expect(amount()).toHaveAccessibleName('Your contribution, 286 AZN');
    expect(screen.queryByTestId('amount-keypad-result')).toBeNull();
    expect(values[values.length - 1]).toBe('286');
  });

  it('computes 0.1 + 0.2 as 0.3, and rounds a quotient half-even', async () => {
    await renderEn(<Holder />);
    await press('0', '.', '1');
    await fireEvent.press(screen.getByRole('button', { name: K.add }));
    await press('0', '.', '2');
    expect(screen.getByRole('button', { name: 'Use the result: 0.3 AZN' })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('amount-keypad-result'));
    expect(amount()).toHaveAccessibleName('Your contribution, 0.3 AZN');

    await press('<', '<', '<', '1');
    await fireEvent.press(screen.getByRole('button', { name: K.divide }));
    await press('8');
    // 1 ÷ 8 = 0.125, half-even to 0.12.
    expect(screen.getByRole('button', { name: 'Use the result: 0.12 AZN' })).toBeTruthy();
  });

  it('says nothing while a divisor is still being typed: 100 ÷ 0.5 passes through 0 and 0.', async () => {
    await renderEn(<Holder />);
    await press('1', '0', '0');
    await fireEvent.press(screen.getByRole('button', { name: K.divide }));
    await press('0');
    expect(screen.queryByTestId('amount-keypad-message')).toBeNull();
    await press('.');
    expect(screen.queryByTestId('amount-keypad-message')).toBeNull();
    await press('5');
    expect(screen.getByRole('button', { name: 'Use the result: 200 AZN' })).toBeTruthy();
    const said = [
      ...jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls,
      ...jest.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mock.calls,
    ].map(([message]) => message);
    expect(said).not.toContain(K.divideByZero);
  });

  it('refuses division by zero at once, with no chip to commit', async () => {
    await renderEn(<Holder />);
    await press('5');
    await fireEvent.press(screen.getByRole('button', { name: K.divide }));
    await press('0', '.', '0', '0');
    expect(screen.getByTestId('amount-keypad-message')).toHaveAccessibleName(K.divideByZero);
    expect(screen.queryByTestId('amount-keypad-result')).toBeNull();
    const said = [
      ...jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls,
      ...jest.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mock.calls,
    ].map(([message]) => message);
    expect(said).toContain(K.divideByZero);
  });

  it('says an over-limit result at once and will not commit it', async () => {
    const values: string[] = [];
    await renderEn(<Holder max="100" onValue={(value) => values.push(value)} />);
    await press('6', '0');
    await fireEvent.press(screen.getByRole('button', { name: K.multiply }));
    await press('2');
    expect(screen.getByTestId('amount-keypad-message')).toHaveAccessibleName(en.checkout.errors.amountTooLarge);
    const chip = screen.getByTestId('amount-keypad-result');
    expect(chip).toBeDisabled();
    await fireEvent.press(chip);
    expect(amount()).toHaveAccessibleName('Your contribution, 60 AZN Times 2');
    expect(values).toEqual(['6', '60']);
  });

  it('says a typed amount over the limit at once', async () => {
    await renderEn(<Holder max="100" />);
    await press('1', '0', '1');
    expect(screen.getByTestId('amount-keypad-message')).toHaveAccessibleName(en.checkout.errors.amountTooLarge);
  });

  it('takes a value from outside, clearing a pending operation', async () => {
    const view = await renderEn(<Holder />);
    await press('5');
    await fireEvent.press(screen.getByRole('button', { name: K.add }));
    await press('1');
    await view.rerender(<Holder external="45.00" />);
    expect(amount()).toHaveAccessibleName('Your contribution, 45 AZN');
    expect(screen.queryByTestId('amount-keypad-operation', { includeHiddenElements: true })).toBeNull();
  });

  it('types on after a price from outside: 45.00 then 6 is 456, not refused', async () => {
    const values: string[] = [];
    await renderEn(<Holder initial="45.00" onValue={(value) => values.push(value)} />);
    expect(amount()).toHaveAccessibleName('Your contribution, 45 AZN');
    await press('6');
    expect(amount()).toHaveAccessibleName('Your contribution, 456 AZN');
    await press('.', '5');
    expect(values).toEqual(['456', '456.5']);
  });

  it('keeps itself to the numeric(14,2) ceiling with its own message when the caller names none', async () => {
    await renderEn(<AmountKeypad value="999999999999" onChange={() => undefined} currency="AZN" />);
    await fireEvent.press(screen.getByRole('button', { name: K.multiply }));
    await press('2');
    expect(screen.getByTestId('amount-keypad-message')).toHaveAccessibleName(K.overLimit);
    expect(screen.getByTestId('amount-keypad-result')).toBeDisabled();
  });

  it('with motion off, still changes on the press, as plain text', async () => {
    await renderEn(
      <MotionBudgetProvider level="none">
        <Holder />
      </MotionBudgetProvider>,
    );
    await press('4', '2');
    expect(amount()).toHaveAccessibleName('Your contribution, 42 AZN');
    expect(screen.getByText('42', { includeHiddenElements: true })).toBeTruthy();
  });

  it('with Reduce Motion on, commits a result at once', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await renderEn(<Holder />);
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
    await press('2');
    await fireEvent.press(screen.getByRole('button', { name: K.multiply }));
    await press('3');
    await fireEvent.press(screen.getByTestId('amount-keypad-result'));
    await waitFor(() => expect(within(amount()).getByText('6', { includeHiddenElements: true })).toBeTruthy());
    expect(amount()).toHaveAccessibleName('Your contribution, 6 AZN');
  });

  describe('settle(), before the amount is used', () => {
    async function settle(ref: React.RefObject<AmountKeypadHandle | null>): Promise<KeypadSettle> {
      let outcome: KeypadSettle = 'unchanged';
      await act(async () => {
        outcome = ref.current?.settle() ?? 'unchanged';
      });
      return outcome;
    }

    function Settled({ handle, onValue }: { readonly handle: React.Ref<AmountKeypadHandle>; readonly onValue: (v: string) => void }) {
      const [value, setValue] = useState('');
      return (
        <AmountKeypad
          ref={handle}
          value={value}
          onChange={(next) => {
            setValue(next);
            onValue(next);
          }}
          currency="AZN"
        />
      );
    }

    it('is unchanged with no operation pending', async () => {
      const ref = createRef<AmountKeypadHandle>();
      await renderEn(<Settled handle={ref} onValue={() => undefined} />);
      await press('5');
      expect(await settle(ref)).toBe('unchanged');
    });

    it('commits a valid result as the amount', async () => {
      const ref = createRef<AmountKeypadHandle>();
      const values: string[] = [];
      await renderEn(<Settled handle={ref} onValue={(value) => values.push(value)} />);
      await press('1', '0', '0');
      await fireEvent.press(screen.getByRole('button', { name: K.divide }));
      await press('4');
      expect(await settle(ref)).toBe('committed');
      expect(values[values.length - 1]).toBe('25');
      expect(amount()).toHaveAccessibleName('25 AZN');
    });

    it('refuses an unfinished operation and says so', async () => {
      const ref = createRef<AmountKeypadHandle>();
      const values: string[] = [];
      await renderEn(<Settled handle={ref} onValue={(value) => values.push(value)} />);
      await press('1', '0', '0');
      await fireEvent.press(screen.getByRole('button', { name: K.multiply }));
      expect(await settle(ref)).toBe('refused');
      expect(screen.getByTestId('amount-keypad-message')).toHaveAccessibleName(K.unfinished);
      expect(values).toEqual(['1', '10', '100']);
      // Typing on clears the nudge.
      await press('2');
      expect(screen.queryByTestId('amount-keypad-message')).toBeNull();
    });

    it('refuses a division by zero, keeping its message', async () => {
      const ref = createRef<AmountKeypadHandle>();
      await renderEn(<Settled handle={ref} onValue={() => undefined} />);
      await press('5');
      await fireEvent.press(screen.getByRole('button', { name: K.divide }));
      await press('0', '.', '0', '0');
      expect(await settle(ref)).toBe('refused');
      expect(screen.getByTestId('amount-keypad-message')).toHaveAccessibleName(K.divideByZero);
      expect(amount()).toHaveAccessibleName('5 AZN Divided by 0.00');
    });
  });

  it('disables every key when disabled', async () => {
    await renderEn(<AmountKeypad value="" onChange={() => undefined} currency="AZN" disabled />);
    expect(screen.getByTestId('amount-keypad-key-1')).toBeDisabled();
    expect(screen.getByTestId('amount-keypad-op-add')).toBeDisabled();
  });
});
