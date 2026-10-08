import type { ErrorEvent } from '@sentry/react-native';
import { MASK, scrubBreadcrumb, scrubEvent, scrubText } from './scrub';

/**
 * #165's acceptance test: a crafted event carrying every kind of thing the issue lists comes out
 * of `beforeSend` with none of it. The values have the real shapes — a JWT, a UUID key — but are
 * spelled out as fakes, so a secret scanner does not mistake the fixtures for credentials.
 */

const ACCESS_TOKEN = ['eyJfakeheader', 'fakepayload', 'fakesignature'].join('.');
const EMAIL_TOKEN = 'fake-email-link-token';
const IDEMPOTENCY_KEY = '9b1e2f6a-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const ACCOUNT_ID = 'c0ffee00-1234-4abc-9def-001122334455';
const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

function craftedEvent(): ErrorEvent {
  return {
    type: undefined,
    event_id: 'e1',
    release: '1.0.0+12',
    dist: 'ios',
    environment: 'production',
    message: 'Pledge failed for aysel.mammadova@example.az',
    tags: { api_trace_id: TRACE_ID, boundary: 'route' },
    user: { id: ACCOUNT_ID, email: 'aysel.mammadova@example.az', username: 'Aysel', ip_address: '10.0.0.1' },
    request: {
      url: `https://api.ideyanest.com/v1/auth/verify-email?token=${EMAIL_TOKEN}&next=%2Fpledges`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Idempotency-Key': IDEMPOTENCY_KEY,
        'Accept-Language': 'az',
      },
      data: { refreshToken: 'fake-refresh-token', accessToken: ACCESS_TOKEN },
    },
    exception: {
      values: [
        {
          type: 'ApiError',
          value: `Request with Authorization: Bearer ${ACCESS_TOKEN} was refused`,
        },
      ],
    },
    extra: {
      address: {
        recipient: 'Aysel Məmmədova',
        line1: 'Nizami küçəsi 10, mənzil 5',
        line2: '',
        locality: 'Bakı',
        region: 'Bakı',
        postcode: 'AZ1000',
        countryCode: 'AZ',
        phone: '+994 50 123 45 67',
      },
      note: 'call 050 123 45 67 or pay with 4111 1111 1111 1111',
    },
    contexts: {
      trace: { trace_id: TRACE_ID, span_id: 'a1b2c3d4e5f60718' },
      os: { name: 'iOS', version: '18.0' },
      device: { name: "Aysel's iPhone", model: 'iPhone14,7' },
    },
    breadcrumbs: [
      {
        category: 'fetch',
        data: { url: `https://ideyanest.com/reset-password/confirm?token=${EMAIL_TOKEN}`, status_code: 200 },
      },
    ],
  };
}

function everyString(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(everyString);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(everyString);
  return [];
}

describe('scrubEvent', () => {
  const clean = scrubEvent(craftedEvent());
  const text = everyString(clean).join('\n');

  it.each([
    ['the access token', ACCESS_TOKEN],
    ['the refresh token', 'fake-refresh-token'],
    ["the email link's token", EMAIL_TOKEN],
    ['the idempotency key', IDEMPOTENCY_KEY],
    ['the email address', 'aysel.mammadova@example.az'],
    ['the recipient', 'Məmmədova'],
    ['the street', 'Nizami'],
    ['the postcode', 'AZ1000'],
    ['the international phone number', '123 45 67'],
    ['the card number', '4111 1111 1111 1111'],
    ['the device name', 'Aysel'],
    ['the IP address', '10.0.0.1'],
  ])('carries nothing of %s', (_what, secret) => {
    expect(text).not.toContain(secret);
  });

  it('masks the Authorization and Idempotency-Key headers by name', () => {
    expect(clean.request?.headers).toEqual({
      Authorization: MASK,
      'Idempotency-Key': MASK,
      'Accept-Language': 'az',
    });
  });

  it('keeps the rest of a URL whose token it removed', () => {
    expect(clean.request?.url).toBe(
      `https://api.ideyanest.com/v1/auth/verify-email?token=${MASK}&next=%2Fpledges`,
    );
  });

  it('keeps the account id as the only thing about the user', () => {
    expect(clean.user).toEqual({ id: ACCOUNT_ID });
  });

  it('leaves what joins a report to the service log and groups it intact', () => {
    expect(clean.tags).toEqual({ api_trace_id: TRACE_ID, boundary: 'route' });
    expect(clean.contexts?.trace).toEqual({ trace_id: TRACE_ID, span_id: 'a1b2c3d4e5f60718' });
    expect(clean.contexts?.os).toEqual({ name: 'iOS', version: '18.0' });
    expect(clean.contexts?.device).toEqual({ model: 'iPhone14,7' });
    expect(clean.release).toBe('1.0.0+12');
    expect(clean.exception?.values?.[0]?.type).toBe('ApiError');
  });

  it('does not change the event it was given', () => {
    const event = craftedEvent();
    scrubEvent(event);
    expect(event).toEqual(craftedEvent());
  });
});

describe('scrubBreadcrumb', () => {
  it('removes a token from a fetch breadcrumb and an email from a console one', () => {
    expect(
      scrubBreadcrumb({
        category: 'fetch',
        data: { url: `https://ideyanest.com/confirm-email-change?token=${EMAIL_TOKEN}`, method: 'GET' },
      }),
    ).toEqual({
      category: 'fetch',
      data: { url: `https://ideyanest.com/confirm-email-change?token=${MASK}`, method: 'GET' },
    });
    expect(
      scrubBreadcrumb({ category: 'console', message: 'signed in as aysel@example.az', data: { arguments: [] } })
        .message,
    ).toBe(`signed in as ${MASK}`);
  });
});

describe('scrubText', () => {
  it.each([
    ['a JSON field', '{"refreshToken":"abc.def"}', `{"refreshToken":"${MASK}"}`],
    ['a key=value field', 'idempotency_key=abc123, ok', `idempotency_key=${MASK}, ok`],
    ['a header in text', 'Idempotency-Key: 9b1e2f6a', `Idempotency-Key: ${MASK}`],
    ['a basic credential', 'Basic dXNlcjpwYXNzd29yZA==', `Basic ${MASK}`],
    ['an IBAN', 'to AZ21NABZ00000000137010001944', `to ${MASK}`],
    ['a bare JWT', `token was ${ACCESS_TOKEN} here`, `token was ${MASK} here`],
  ])('masks %s', (_what, input, output) => {
    expect(scrubText(input)).toBe(output);
  });

  it.each([
    ['a trace id', TRACE_ID],
    ['an epoch timestamp', '1760000000000'],
    ['an ISO timestamp', '2026-10-08T12:00:00+04:00'],
    ['a field that merely contains a listed name', 'shippingCountry=AZ tokenDelivery=sms'],
  ])('leaves %s alone', (_what, input) => {
    expect(scrubText(input)).toBe(input);
  });
});
