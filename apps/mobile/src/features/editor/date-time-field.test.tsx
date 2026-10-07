import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { IntlProvider } from 'use-intl';
import { fromDateTimeLocal } from '@ideanest/campaign-editor/basics';
import en from '@ideanest/messages/en.json';
import { Field } from '../../components/ui';
import { DateTimeField, dayOf, instantOf, notBefore } from './date-time-field';

jest.mock('@react-native-community/datetimepicker', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  function Picker(props: Record<string, unknown>) {
    return createElement(View, { testID: props.testID, onValueChange: props.onValueChange });
  }
  return { __esModule: true, default: Picker, DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn() } };
});

async function show(
  value: string | null,
  onChange = jest.fn(),
  mode: 'datetime' | 'date' = 'datetime',
  minimumDate?: Date,
) {
  await render(
    <IntlProvider locale="en" messages={en}>
      <Field label="Scheduled launch">
        <DateTimeField
          value={value}
          onChange={onChange}
          label="Scheduled launch"
          mode={mode}
          testID="when"
          {...(minimumDate === undefined ? {} : { minimumDate })}
        />
      </Field>
    </IntlProvider>,
  );
  return onChange;
}

describe('instantOf and dayOf', () => {
  it('sends exactly what the web’s fromDateTimeLocal sends for the same wall-clock minute', () => {
    const picked = new Date(2026, 9, 12, 14, 30, 47, 512);
    expect(instantOf(picked)).toBe(fromDateTimeLocal('2026-10-12T14:30'));
    expect(instantOf(picked)?.endsWith(':00.000Z')).toBe(true);
  });

  it('writes a calendar day in the phone’s calendar', () => {
    expect(dayOf(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('moves a moment before the minimum to the first whole minute after it', () => {
    const minimum = new Date(2026, 9, 7, 10, 0, 30);
    expect(notBefore(new Date(2026, 9, 7, 8, 0), minimum)).toEqual(new Date(2026, 9, 7, 10, 1));
    expect(notBefore(new Date(2026, 9, 7, 12, 0), minimum)).toEqual(new Date(2026, 9, 7, 12, 0));
    expect(notBefore(new Date(2026, 9, 7, 8, 0), undefined)).toEqual(new Date(2026, 9, 7, 8, 0));
  });
});

describe('DateTimeField', () => {
  const original = Platform.OS;
  afterEach(() => {
    Platform.OS = original;
    jest.clearAllMocks();
  });

  it('is named by its field and says what is chosen, or that nothing is', async () => {
    await show(null);
    const trigger = screen.getByTestId('when');
    expect(trigger.props.accessibilityLabel).toBe('Scheduled launch');
    expect(trigger.props.accessibilityValue).toEqual({ text: en.mobile.editor.dateTime.choose });
    expect(screen.queryByLabelText('Clear Scheduled launch')).toBeNull();
  });

  it('on iOS commits the time shown with "Use this time", as an ISO instant', async () => {
    Platform.OS = 'ios';
    const onChange = await show(null);
    await fireEvent.press(screen.getByTestId('when'));
    const picked = new Date(2026, 10, 2, 9, 15);
    await fireEvent(screen.getByTestId('when-picker'), 'valueChange', {}, picked);
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('when-confirm'));
    expect(onChange).toHaveBeenCalledWith(fromDateTimeLocal('2026-11-02T09:15'));
  });

  it('on Android asks for the date, then the time', async () => {
    Platform.OS = 'android';
    const onChange = await show(null);
    await fireEvent.press(screen.getByTestId('when'));
    const open = jest.mocked(DateTimePickerAndroid.open);
    expect(open.mock.calls[0]?.[0].mode).toBe('date');
    open.mock.calls[0]?.[0].onValueChange?.({} as never, new Date(2026, 10, 2));
    expect(open.mock.calls[1]?.[0].mode).toBe('time');
    open.mock.calls[1]?.[0].onValueChange?.({} as never, new Date(2026, 10, 2, 18, 5));
    expect(onChange).toHaveBeenCalledWith(fromDateTimeLocal('2026-11-02T18:05'));
  });

  it('clears to null with its own named button', async () => {
    const onChange = await show('2099-01-01T09:00:00.000Z');
    await fireEvent.press(screen.getByLabelText('Clear Scheduled launch'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('in date mode, answers a calendar day', async () => {
    Platform.OS = 'android';
    const onChange = await show(null, jest.fn(), 'date');
    await fireEvent.press(screen.getByTestId('when'));
    jest.mocked(DateTimePickerAndroid.open).mock.calls[0]?.[0].onValueChange?.({} as never, new Date(2026, 11, 24));
    expect(onChange).toHaveBeenCalledWith('2026-12-24');
    expect(DateTimePickerAndroid.open).toHaveBeenCalledTimes(1);
  });

  it('on Android never sends a time before the minimum the time dialog cannot enforce', async () => {
    Platform.OS = 'android';
    const minimum = new Date(2026, 9, 7, 10, 0);
    const onChange = await show(null, jest.fn(), 'datetime', minimum);
    await fireEvent.press(screen.getByTestId('when'));
    const open = jest.mocked(DateTimePickerAndroid.open);
    expect(open.mock.calls[0]?.[0].minimumDate).toBe(minimum);
    open.mock.calls[0]?.[0].onValueChange?.({} as never, new Date(2026, 9, 7));
    open.mock.calls[1]?.[0].onValueChange?.({} as never, new Date(2026, 9, 7, 8, 0));
    expect(onChange).toHaveBeenCalledWith(fromDateTimeLocal('2026-10-07T10:01'));
  });

  it('in date mode speaks of a date, not a time', async () => {
    Platform.OS = 'ios';
    await show(null, jest.fn(), 'date');
    expect(screen.getByTestId('when').props.accessibilityValue).toEqual({ text: en.mobile.editor.dateTime.chooseDate });
    await fireEvent.press(screen.getByTestId('when'));
    expect(screen.getByLabelText(/^Use .* for Scheduled launch$/)).toHaveTextContent(en.mobile.editor.dateTime.confirmDate);
  });
});
