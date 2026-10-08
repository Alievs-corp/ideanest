import * as WebBrowser from 'expo-web-browser';
import { isClaimedReturnRoute, RETURN_GRACE_MS } from '../../lib/auth-session-links';
import { openCardRegistration } from '../settings/payout/card-return';
import { openPaymentPage } from './payment';

/*
 * The payment and payout-card sessions claim the route they return to for as long as they are
 * open (#165), so the link listener does not open the pledge or the payout panel a second time.
 */

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

const ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const browser = jest.mocked(WebBrowser);

afterEach(() => {
  jest.useRealTimers();
});

it('claims the pledge while the payment page is open, and lets go after the grace period', async () => {
  jest.useFakeTimers();
  let claimedDuring = false;
  browser.openAuthSessionAsync.mockImplementationOnce(() => {
    claimedDuring = isClaimedReturnRoute(`/pledges/${ID}`);
    return Promise.resolve({ type: 'success', url: `ideanest://pledges/${ID}?payment=failed` });
  });

  await expect(openPaymentPage('https://pay.example/r', ID)).resolves.toEqual({ kind: 'returned', hint: 'failed' });
  expect(claimedDuring).toBe(true);
  expect(isClaimedReturnRoute(`/pledges/${ID}`)).toBe(true);
  jest.advanceTimersByTime(RETURN_GRACE_MS);
  expect(isClaimedReturnRoute(`/pledges/${ID}`)).toBe(false);
});

it('releases the claim when the browser will not open', async () => {
  jest.useFakeTimers();
  browser.openAuthSessionAsync.mockRejectedValueOnce(new Error('WebBrowser is already open'));
  await expect(openPaymentPage('https://pay.example/r', ID)).rejects.toThrow('already open');
  jest.advanceTimersByTime(RETURN_GRACE_MS);
  expect(isClaimedReturnRoute(`/pledges/${ID}`)).toBe(false);
});

it('claims the payout panel while the card page is open', async () => {
  jest.useFakeTimers();
  let claimedDuring = false;
  browser.openAuthSessionAsync.mockImplementationOnce(() => {
    claimedDuring = isClaimedReturnRoute('/settings/payout');
    return Promise.resolve({ type: 'cancel' } as WebBrowser.WebBrowserAuthSessionResult);
  });
  await expect(openCardRegistration('https://pay.example/card')).resolves.toEqual({ kind: 'dismissed' });
  expect(claimedDuring).toBe(true);
  jest.advanceTimersByTime(RETURN_GRACE_MS);
  expect(isClaimedReturnRoute('/settings/payout')).toBe(false);
});
