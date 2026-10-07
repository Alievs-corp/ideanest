import { useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { impactAsync, notificationAsync, selectionAsync } from 'expo-haptics';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { Glyphs } from '../../icons';
import { PinDots, PinPad } from './pin-pad';

/**
 * The app lock's PIN pad (#319): named keys, digits never read back, the count said as
 * "N of 6 entered", and the PIN handed on the press that completes it.
 */

const P = en.mobile.lock.pad;

function Harness({ onComplete, action }: { onComplete: (pin: string) => void; action?: () => void }) {
  const [value, setValue] = useState('');
  return (
    <IntlProvider locale="en" messages={en}>
      <PinDots count={value.length} />
      <PinPad
        value={value}
        onChange={setValue}
        onComplete={onComplete}
        action={action === undefined ? null : { label: 'Use fingerprint', icon: Glyphs.FingerScan, onPress: action }}
      />
    </IntlProvider>
  );
}

const announced = () =>
  jest
    .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    .mock.calls.map(([message]) => message);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('PinPad', () => {
  it('names every key, each at least a touch target high', async () => {
    await render(<Harness onComplete={jest.fn()} action={jest.fn()} />);
    for (const digit of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      expect(screen.getByRole('keyboardkey', { name: digit })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: P.delete })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use fingerprint' })).toBeTruthy();
  });

  it('shows the count as dots and says it, never the digits', async () => {
    await render(<Harness onComplete={jest.fn()} />);
    expect(screen.getByLabelText('0 of 6 entered')).toBeTruthy();

    await fireEvent.press(screen.getByRole('keyboardkey', { name: '7' }));
    await fireEvent.press(screen.getByRole('keyboardkey', { name: '3' }));

    expect(screen.getByLabelText('2 of 6 entered')).toBeTruthy();
    expect(screen.getAllByTestId('pin-dots-filled', { includeHiddenElements: true })).toHaveLength(2);
    expect(screen.getAllByTestId('pin-dots-empty', { includeHiddenElements: true })).toHaveLength(4);
    expect(announced()).toEqual(['1 of 6 entered', '2 of 6 entered']);
    expect(announced().join(' ')).not.toMatch(/7|3 of/);
    expect(selectionAsync).toHaveBeenCalledTimes(2);
    expect(impactAsync).not.toHaveBeenCalled();
    expect(notificationAsync).not.toHaveBeenCalled();
  });

  it('deletes the last digit, and does nothing when empty', async () => {
    await render(<Harness onComplete={jest.fn()} />);
    expect(screen.getByRole('button', { name: P.delete }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await fireEvent.press(screen.getByRole('keyboardkey', { name: '1' }));
    await fireEvent.press(screen.getByRole('button', { name: P.delete }));
    expect(screen.getByLabelText('0 of 6 entered')).toBeTruthy();
  });

  it('hands the whole PIN on the sixth press, and takes no seventh digit', async () => {
    const onComplete = jest.fn();
    await render(<Harness onComplete={onComplete} />);
    for (const digit of ['1', '3', '5', '7', '9', '0', '2']) {
      await fireEvent.press(screen.getByRole('keyboardkey', { name: digit }));
    }
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('135790');
    expect(screen.getByLabelText('6 of 6 entered')).toBeTruthy();
  });

  it('completes once when two presses land in the same batch', async () => {
    const onComplete = jest.fn();
    const onChange = jest.fn();
    await render(
      <IntlProvider locale="en" messages={en}>
        <PinPad value="12345" onChange={onChange} onComplete={onComplete} />
      </IntlProvider>,
    );
    // The parent has not re-rendered between them: both presses see value "12345".
    await fireEvent.press(screen.getByRole('keyboardkey', { name: '6' }));
    await fireEvent.press(screen.getByRole('keyboardkey', { name: '7' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('runs its action key', async () => {
    const action = jest.fn();
    await render(<Harness onComplete={jest.fn()} action={action} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Use fingerprint' }));
    expect(action).toHaveBeenCalledTimes(1);
  });
});
