import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { MoneyField, deviceDecimalSeparator, normaliseAmountInput, readAmount } from './money-field';

let mockSeparator: string | null = ',';
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'az', languageTag: 'az-AZ', decimalSeparator: mockSeparator }],
}));

describe('normaliseAmountInput — #162’s comma rule', () => {
  it.each([
    ['12,5', '12.5'],
    ['12,50', '12.50'],
    [',5', '.5'],
    ['5000', '5000'],
    ['5000.25', '5000.25'],
  ])('on a comma-locale device turns %s into %s', (typed, shown) => {
    expect(normaliseAmountInput(typed, ',')).toBe(shown);
  });

  it('leaves text alone when it has a point already, or more than one comma', () => {
    expect(normaliseAmountInput('1.000,5', ',')).toBe('1.000,5');
    expect(normaliseAmountInput('1,000,5', ',')).toBe('1,000,5');
  });

  it('does nothing on a point-locale device, or when the platform does not say', () => {
    expect(normaliseAmountInput('12,5', '.')).toBe('12,5');
    expect(normaliseAmountInput('12,5', null)).toBe('12,5');
  });

  it('turns a pasted 1,500 into 1.500, which the parser refuses as too many decimals', () => {
    const shown = normaliseAmountInput('1,500', ',');
    expect(shown).toBe('1.500');
    expect(readAmount(shown)).toEqual({ ok: false, reason: 'too-many-decimals' });
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

function Harness({ separator }: { readonly separator?: string | null }) {
  const [value, setValue] = useState('');
  return (
    <IntlProvider locale="en" messages={en}>
      <MoneyField
        value={value}
        onChangeText={setValue}
        currency="AZN"
        testID="money"
        {...(separator === undefined ? {} : { decimalSeparator: separator })}
      />
    </IntlProvider>
  );
}

describe('MoneyField', () => {
  beforeEach(() => {
    mockSeparator = ',';
  });

  it('reads the device separator from expo-localization', () => {
    expect(deviceDecimalSeparator()).toBe(',');
    mockSeparator = '.';
    expect(deviceDecimalSeparator()).toBe('.');
  });

  it('opens the decimal pad and shows the currency after the amount', async () => {
    await render(<Harness />);
    expect(screen.getByTestId('money').props.keyboardType).toBe('decimal-pad');
    // Decorative: the field's label and hint say what it is.
    expect(screen.getByText('AZN', { includeHiddenElements: true })).toBeTruthy();
  });

  it('shows 12,5 typed on a comma-locale phone as 12.5', async () => {
    await render(<Harness />);
    await fireEvent.changeText(screen.getByTestId('money'), '12,5');
    expect(screen.getByTestId('money').props.value).toBe('12.5');
  });

  it('changes nothing on a point-locale phone', async () => {
    mockSeparator = '.';
    await render(<Harness />);
    await fireEvent.changeText(screen.getByTestId('money'), '12,5');
    expect(screen.getByTestId('money').props.value).toBe('12,5');
  });
});
