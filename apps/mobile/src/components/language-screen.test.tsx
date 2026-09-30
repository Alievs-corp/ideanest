import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntlProvider } from 'use-intl';
import { LOCALE_NAMES } from '@ideanest/messages';
import en from '@ideanest/messages/en.json';
import LanguageScreen from '../app/settings/language';
import { saveAccountLocale } from '../api/client';
import { currentLocale, setLocale } from '../lib/locale';

/**
 * The language screen's account half — issue #150: `PATCH /v1/me/locale` only when signed in,
 * and a failed save keeps the local choice and says so, with a retry.
 *
 * <p>Here rather than beside `app/settings/language.tsx` because every file under `src/app` is a
 * route to Expo Router, and a test file there would be offered as a screen.
 */

jest.mock('expo-router', () => ({ Stack: Object.assign(() => null, { Screen: () => null }) }));

let mockSignedIn = false;
jest.mock('../lib/use-session', () => ({
  useSession: () => ({ signedIn: mockSignedIn, locked: false, unlocked: false }),
}));

jest.mock('../api/client', () => ({ saveAccountLocale: jest.fn(async () => true) }));

const failed = en.mobile.language.saveFailed;

/* The screen's module graph loads on the first render, which took past 5 s on a CI runner elsewhere. */
jest.setTimeout(20_000);

async function renderScreen() {
  const client = new QueryClient();
  // English words whatever language is chosen: what is under test is the behaviour, not the copy.
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={en}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  );
  return render(<LanguageScreen />, { wrapper });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockSignedIn = false;
  await act(async () => setLocale('az'));
});

describe('the language screen', () => {
  it('signed out: switches the language and tells no account', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByRole('radio', { name: LOCALE_NAMES.ru }));

    expect(currentLocale()).toBe('ru');
    expect(saveAccountLocale).not.toHaveBeenCalled();
    expect(screen.queryByText(failed)).toBeNull();
  });

  it('signed in: sends the choice to the account', async () => {
    mockSignedIn = true;
    await renderScreen();
    await fireEvent.press(screen.getByRole('radio', { name: LOCALE_NAMES.tr }));

    expect(saveAccountLocale).toHaveBeenCalledWith('tr');
    expect(currentLocale()).toBe('tr');
    expect(screen.queryByText(failed)).toBeNull();
  });

  it('a failed save keeps the local choice, says so, and retries', async () => {
    mockSignedIn = true;
    jest.mocked(saveAccountLocale).mockResolvedValueOnce(false);
    await renderScreen();
    await fireEvent.press(screen.getByRole('radio', { name: LOCALE_NAMES.ru }));

    expect(currentLocale()).toBe('ru');
    expect(await screen.findByText(failed)).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: en.mobile.language.retry }));
    expect(saveAccountLocale).toHaveBeenLastCalledWith('ru');
    expect(saveAccountLocale).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(failed)).toBeNull();
  });
});
