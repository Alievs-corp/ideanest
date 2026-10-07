import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { MoneyField, normaliseAmountInput, readAmount } from './money-field';

// A point-separator phone: the comma rule must not depend on it (owner decision, 2026-10-07).
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en', languageTag: 'en-GB', decimalSeparator: '.' }],
}));

describe('normaliseAmountInput — the comma rule', () => {
  it.each([
    ['12,5', '12.5'],
    ['25,5', '25.5'],
    ['12,50', '12.50'],
    ['0,5', '0.5'],
    [',5', '.5'],
    ['5000', '5000'],
    ['5000.25', '5000.25'],
  ])('turns %s into %s, on any device', (typed, shown) => {
    expect(normaliseAmountInput(typed)).toBe(shown);
  });

  it('leaves text alone when it has a point already, or more than one comma', () => {
    expect(normaliseAmountInput('1.000,5')).toBe('1.000,5');
    expect(normaliseAmountInput('1,000,5')).toBe('1,000,5');
    expect(normaliseAmountInput('1,5,0')).toBe('1,5,0');
    expect(readAmount(normaliseAmountInput('1,5,0'))).toEqual({ ok: false, reason: 'comma' });
  });

  it('turns a pasted 1,500 into 1.500, which the parser refuses as too many decimals', () => {
    const shown = normaliseAmountInput('1,500');
    expect(shown).toBe('1.500');
    expect(readAmount(shown)).toEqual({ ok: false, reason: 'too-many-decimals' });
  });

  it('reads 0,5 as half, on the wire as 0.50', () => {
    expect(readAmount(normaliseAmountInput('0,5'))).toEqual({ ok: true, wire: '0.50' });
  });
});

describe('readAmount', () => {
  it('always puts two decimals on the wire, from the decimal and never from a number', () => {
    expect(readAmount('12.5')).toEqual({ ok: true, wire: '12.50' });
    expect(readAmount('5000')).toEqual({ ok: true, wire: '5000.00' });
    expect(readAmount('0.1')).toEqual({ ok: true, wire: '0.10' });
    expect(readAmount('99999999999.99')).toEqual({ ok: true, wire: '99999999999.99' });
  });

  it.each([
    ['', 'empty'],
    ['abc', 'not-a-number'],
    ['12,5', 'comma'],
    ['1.234', 'too-many-decimals'],
    ['1000000000000', 'too-large'],
    ['0', 'not-positive'],
  ])('refuses %j as %s', (typed, reason) => {
    expect(readAmount(typed)).toEqual({ ok: false, reason });
  });

  it('accepts zero where zero is an offer (a shipping rate)', () => {
    expect(readAmount('0', { allowZero: true })).toEqual({ ok: true, wire: '0.00' });
  });
});

function Harness() {
  const [value, setValue] = useState('');
  return (
    <IntlProvider locale="en" messages={en}>
      <MoneyField value={value} onChangeText={setValue} currency="AZN" testID="money" />
    </IntlProvider>
  );
}

describe('MoneyField', () => {
  it('opens the decimal pad and shows the currency after the amount', async () => {
    await render(<Harness />);
    expect(screen.getByTestId('money').props.keyboardType).toBe('decimal-pad');
    // Decorative: the field's label and hint say what it is.
    expect(screen.getByText('AZN', { includeHiddenElements: true })).toBeTruthy();
  });

  it('shows 25,5 typed on a point-separator phone as 25.5 — Gboard offers both keys', async () => {
    await render(<Harness />);
    await fireEvent.changeText(screen.getByTestId('money'), '25,5');
    expect(screen.getByTestId('money').props.value).toBe('25.5');
  });

  it('leaves 1,5,0 as typed, for the parser to refuse', async () => {
    await render(<Harness />);
    await fireEvent.changeText(screen.getByTestId('money'), '1,5,0');
    expect(screen.getByTestId('money').props.value).toBe('1,5,0');
  });
});
