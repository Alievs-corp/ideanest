import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Platform, Text } from 'react-native';
import { useAssistiveTechnology } from './assistive-tech';

/**
 * `useAssistiveTechnology` (#280): a screen reader, or on Android any accessibility service, and
 * the change events for both — with overlapping reads published in order.
 */

function Probe() {
  return <Text testID="assisted">{useAssistiveTechnology() ? 'yes' : 'no'}</Text>;
}

type Handler = () => void;

/** The handler the hook registered for an event, from the platform mock. */
function handlerFor(event: string): Handler {
  const call = jest
    .mocked(AccessibilityInfo.addEventListener)
    .mock.calls.filter(([name]) => name === event)
    .at(-1);
  if (call === undefined) throw new Error(`nothing listens to ${event}`);
  return call[1] as Handler;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const os = Platform.OS;

beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  Platform.OS = os;
  jest.restoreAllMocks();
});

describe('useAssistiveTechnology', () => {
  it('follows the screen reader', async () => {
    const reader = jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    const view = await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('assisted')).toHaveTextContent('no'));

    reader.mockResolvedValue(true);
    await act(async () => handlerFor('screenReaderChanged')());
    await waitFor(() => expect(screen.getByTestId('assisted')).toHaveTextContent('yes'));
    await view.unmount();
  });

  it('publishes only the newest of two overlapping reads', async () => {
    const slow = deferred<boolean>();
    const reader = jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    const view = await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('assisted')).toHaveTextContent('no'));

    // The first read is slow and stale (on); the second, started after it, is quick (off).
    reader.mockImplementationOnce(() => slow.promise).mockResolvedValueOnce(false);
    await act(async () => handlerFor('screenReaderChanged')());
    await act(async () => handlerFor('screenReaderChanged')());
    await act(async () => slow.resolve(true));
    await act(async () => Promise.resolve());
    expect(screen.getByTestId('assisted')).toHaveTextContent('no');
    await view.unmount();
  });

  it('on Android, listens for accessibility services coming and going, Switch Access among them', async () => {
    Platform.OS = 'android';
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    const service = jest.spyOn(AccessibilityInfo, 'isAccessibilityServiceEnabled').mockResolvedValue(false);
    const view = await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('assisted')).toHaveTextContent('no'));

    service.mockResolvedValue(true);
    await act(async () => handlerFor('accessibilityServiceChanged')());
    await waitFor(() => expect(screen.getByTestId('assisted')).toHaveTextContent('yes'));
    await view.unmount();
  });

  it('does not ask for the Android-only service signal on iOS', async () => {
    Platform.OS = 'ios';
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    const view = await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('assisted')).toHaveTextContent('no'));
    expect(AccessibilityInfo.isAccessibilityServiceEnabled).not.toHaveBeenCalled();
    expect(jest.mocked(AccessibilityInfo.addEventListener).mock.calls.map(([name]) => name)).not.toContain(
      'accessibilityServiceChanged',
    );
    await view.unmount();
  });
});
