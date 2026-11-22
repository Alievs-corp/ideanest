import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizedFetch } from '../api/client';
import { cancelSubscription, formatPrice, readMySubscription, subscribeToPlan } from './api';

vi.mock('../api/client', () => ({ authorizedFetch: vi.fn() }));
const fetchMock = vi.mocked(authorizedFetch);

describe('formatPrice', () => {
  /*
   * The server and the browser have to write the same string, or React throws the server's
   * markup away (#418). Chromium's `az` is root-locale data — `AZN 19` — and Node's full ICU
   * writes `19 ₼`, so the Azerbaijani price must not depend on which of the two answered.
   */
  it('writes an Azerbaijani price the same way in every runtime', () => {
    expect(formatPrice('19.00', 'AZN', 'az')).toBe('19 ₼');
    expect(formatPrice('10000', 'AZN', 'az')).toBe('10.000 ₼');
    expect(formatPrice('19.5', 'AZN', 'az')).toBe('19,50 ₼');
  });

  it('names a currency it has no sign for by its code', () => {
    expect(formatPrice('19', 'USD', 'az')).toBe('19 USD');
  });

  it('formats the other languages through Intl', () => {
    expect(formatPrice('10000', 'AZN', 'en')).toMatch(/^AZN\s10,000$/u);
    expect(formatPrice('10000', 'AZN', 'ru')).toMatch(/^10\s000\sAZN$/u);
  });

  it('shows the raw value when the amount is not a number', () => {
    expect(formatPrice('abc', 'AZN', 'az')).toBe('abc AZN');
  });
});

describe('the held subscription reads', () => {
  /*
   * #655: the held plan's name is localised by the service, and `authorizedFetch` would fill the
   * header from the locale cookie — the language last *chosen*, not the one this page is in. So
   * every read that answers with a plan states the page's language itself.
   */
  const HELD = {
    subscription: {
      id: 's1',
      state: 'ACTIVE',
      entitled: true,
      price: '19.00',
      currency: 'AZN',
      billingPeriod: 'MONTHLY',
      cancelAtPeriodEnd: false,
      createdAt: '',
      plan: { id: 'p1', name: 'Стартовый', price: '19.00', currency: 'AZN', billingPeriod: 'MONTHLY' },
    },
  };

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(HELD), { status: 200 }));
  });

  function languageOf(call: number): string | null {
    return new Headers(fetchMock.mock.calls[call]?.[1]?.headers).get('accept-language');
  }

  it('reads, chooses and cancels in the page language', async () => {
    await readMySubscription('ru');
    await subscribeToPlan('p1', 'SEMIANNUAL', 'tr');
    await cancelSubscription('en');

    expect([languageOf(0), languageOf(1), languageOf(2)]).toEqual(['ru', 'tr', 'en']);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('content-type')).toBe('application/json');
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ planId: 'p1', billingPeriod: 'SEMIANNUAL' }));
  });

  it('gives a held plan from before the periods the one period it names', async () => {
    const mine = await readMySubscription('az');
    expect(mine.subscription?.plan.prices).toEqual([{ billingPeriod: 'MONTHLY', price: '19.00', currency: 'AZN' }]);
    expect(mine.subscription?.plan.studentOnly).toBe(false);
  });
});
