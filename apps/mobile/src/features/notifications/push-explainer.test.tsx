import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { IntlProvider } from 'use-intl';
import * as Notifications from 'expo-notifications';
import en from '@ideanest/messages/en.json';
import { registerForPush } from '../../lib/push';
import { deviceStore } from '../../lib/storage';
import { PushExplainer } from './push-explainer';

jest.mock('../../lib/push', () => ({
  ...jest.requireActual('../../lib/push'),
  registerForPush: jest.fn(async () => ({ status: 'registered' })),
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => {},
  getPermissionsAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
}));

const E = en.mobile.notifications.explainer;
const permissions = jest.mocked(Notifications.getPermissionsAsync);
const DAY = 24 * 60 * 60 * 1000;

function phone(status: 'granted' | 'denied' | 'undetermined') {
  permissions.mockResolvedValue({ granted: status === 'granted', status } as Awaited<
    ReturnType<typeof Notifications.getPermissionsAsync>
  >);
}

async function show(moment: 'pledge' | 'follow' | 'save' = 'pledge') {
  const view = await render(
    <IntlProvider locale="en" messages={en}>
      <PushExplainer moment={moment} />
    </IntlProvider>,
  );
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  deviceStore.remove('push.explainerSnoozedUntil');
  phone('undetermined');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the push explainer (#160)', () => {
  it('explains, then asks the system only on "Turn on"', async () => {
    await show('pledge');

    expect(screen.getByText(E.title)).toBeTruthy();
    expect(screen.getByText(E.pledgeBody)).toBeTruthy();
    expect(registerForPush).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: E.turnOn }));
    await act(async () => {});
    expect(registerForPush).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(E.title)).toBeNull();
  });

  it('says what each moment is for', async () => {
    await show('follow');
    expect(screen.getByText(E.followBody)).toBeTruthy();
    await show('save');
    expect(screen.getByText(E.saveBody)).toBeTruthy();
  });

  it('stays away for thirty days after "Not now", then comes back', async () => {
    const start = Date.parse('2026-10-06T10:00:00Z');
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    const first = await show();
    await fireEvent.press(screen.getByRole('button', { name: E.notNow }));
    expect(screen.queryByText(E.title)).toBeNull();
    expect(registerForPush).not.toHaveBeenCalled();
    await first.unmount();

    now.mockReturnValue(start + 29 * DAY);
    const second = await show();
    expect(screen.queryByText(E.title)).toBeNull();
    await second.unmount();

    now.mockReturnValue(start + 30 * DAY + 1);
    await show();
    expect(screen.getByText(E.title)).toBeTruthy();
  });

  it('is not shown once the phone has decided, either way', async () => {
    phone('granted');
    const allowed = await show();
    expect(screen.queryByText(E.title)).toBeNull();
    await allowed.unmount();

    phone('denied');
    await show();
    expect(screen.queryByText(E.title)).toBeNull();
  });
});
