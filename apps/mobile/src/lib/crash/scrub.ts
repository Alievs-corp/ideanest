import type { Breadcrumb, Event } from '@sentry/react-native';

/**
 * What may never leave the phone in a crash report, removed from the report before it does —
 * issue #165, and §17.4's rule that personal data is redacted wherever it is written down.
 *
 * <h2>One list, the service's</h2>
 *
 * The field names and the shape rules are `apps/api/.../shared/observability/Redaction.java`'s,
 * ported rather than reinvented: the service's log lines and the app's crash reports end up side
 * by side when somebody joins them by trace id, and they should be equally quiet about who was
 * involved. Over-masking is the safe direction here as there: a report that says less than it
 * could is an inconvenience, one that names a backer and their address is a breach.
 *
 * <p>What the app adds to the service's list, and why:
 *   - `Authorization`, `Cookie`: the service masks the bearer by shape and keeps the scheme; a
 *     header here is masked by name, whole, because a report has no use for either half;
 *   - `Idempotency-Key`: the service keeps it readable in its own logs (it is a correlation id
 *     there), but on a phone it is the key that would replay a pledge, and #165 lists it;
 *   - `locality`, `region`, `countryCode`: the mobile shipping form's own field names
 *     (`features/fulfilment/api.ts`), beside the service's `city` and `postcode`;
 *   - `legalName`, `taxId`, `registeredAddress`, `registrationNumber`: the payout form's.
 *
 * <h2>Two passes, as in the service</h2>
 *
 * By **name**: an object property whose name is on the list loses its value, whatever the value
 * is — this is what catches a name or a street, which have no shape. Names are compared without
 * case, `-` or `_`, so `Idempotency-Key`, `idempotency_key` and `idempotencyKey` are one name.
 *
 * By **shape**: every string, wherever it sits, has the shape rules applied — a bearer token, a
 * JWT, an email address, a phone number, a card number, an IBAN, and any listed name written as
 * `name=value` or `"name":"value"` inside text. That is what reaches an exception message, a
 * console breadcrumb, and every `?token=` an email link put in a URL.
 *
 * <h2>What is deliberately left alone</h2>
 *
 * The parts of an event the SDK writes about itself and the device — `sdk`, `debug_meta`,
 * `modules`, the `os`/`device`/`app`/`runtime` contexts, the trace ids and the tags this app sets
 * — are not passed through the name rules, because Sentry's own fields are called `name` and
 * masking `contexts.os.name` would break the grouping a crash report exists for. The one field in
 * them that can name a person, `contexts.device.name` ("Aysel's iPhone"), is removed outright.
 */

export const MASK = '<redacted>';

/** `Redaction.java`'s `SENSITIVE_FIELDS`, in its order, then the app's additions (see above). */
const SENSITIVE_FIELDS = [
  // Credentials.
  'passwordConfirmation',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'password',
  'passwd',
  'pwd',
  // Secrets and keys.
  'twoFactorSecret',
  'clientSecret',
  'totpSecret',
  'secret',
  'privateKeyPem',
  'privateKey',
  'apiKey',
  'api_key',
  // Session material.
  'refreshToken',
  'refresh_token',
  'accessToken',
  'access_token',
  'bearerToken',
  'idToken',
  'id_token',
  'sessionToken',
  'sessionId',
  'session_id',
  'token',
  'challenge',
  // Second factor.
  'otpauthUri',
  'otpauth',
  'recoveryCodes',
  'recoveryCode',
  'verificationCode',
  'twoFactorCode',
  'securityCode',
  'codes',
  'code',
  'totp',
  'otp',
  // Contact details.
  'emailAddress',
  'email',
  'mail',
  'phoneNumber',
  'phone',
  'mobile',
  'msisdn',
  // Who somebody is.
  'displayName',
  'fullName',
  'firstName',
  'lastName',
  'givenName',
  'familyName',
  'recipientName',
  'recipient',
  'userName',
  'username',
  'name',
  'bio',
  // Where they are.
  'shippingAddress',
  'deliveryAddress',
  'billingAddress',
  'addressLine1',
  'addressLine2',
  'streetAddress',
  'address',
  'street',
  'line1',
  'line2',
  'city',
  'postalCode',
  'postcode',
  'zipCode',
  'zip',
  'ipAddress',
  'remoteAddr',
  'clientIp',
  'forwardedFor',
  // Instruments.
  'cardholderName',
  'cardNumber',
  'card',
  'pan',
  'cvv',
  'cvc',
  'expiry',
  'iban',
  'accountNumber',
  'bankAccount',
  'routingNumber',
  'sortCode',
  // The app's additions.
  'authorization',
  'proxyAuthorization',
  'cookie',
  'cookies',
  'setCookie',
  'idempotencyKey',
  'locality',
  'region',
  'countryCode',
  'legalName',
  'taxId',
  'registeredAddress',
  'registrationNumber',
] as const;

const normalise = (name: string): string => name.toLowerCase().replace(/[-_\s]/g, '');

const SENSITIVE_NAMES: ReadonlySet<string> = new Set(SENSITIVE_FIELDS.map(normalise));

/** Whether a property of this name loses its value. */
export function isSensitiveName(name: string): boolean {
  return SENSITIVE_NAMES.has(normalise(name));
}

/**
 * The names as one alternation, each word break an optional `-` or `_` — so `refreshToken` also
 * matches `refresh_token`, and `idempotencyKey` matches `Idempotency-Key`. Longest first.
 */
const FIELD_NAMES = [...SENSITIVE_FIELDS]
  .sort((a, b) => b.length - a.length)
  .map((name) =>
    name
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .split(/[-_]/)
      .join('[-_]?'),
  )
  .join('|');

/** A listed name, followed immediately by its separator — `Redaction.java`'s rule, verbatim. */
const FIELD_AND_SEPARATOR = `(?<![A-Za-z0-9_])(?:${FIELD_NAMES})(?![A-Za-z0-9_])\\\\?"?[:=]\\s*`;

const RULES: readonly (readonly [RegExp, string])[] = [
  // The enrolment URI carries the shared secret in its query, so the whole of it goes, first.
  [/otpauth:\/\/[^\s"',)\]}]+/gi, MASK],
  // The credential goes; the scheme stays.
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${MASK}`],
  // A JWT anywhere, named or not: every JWT header is JSON, so every JWT starts with `eyJ`.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, MASK],
  /*
   * A listed name as a URL query parameter — `?token=…` from the email links, above all. Only the
   * value goes, up to the next `&` or `#`, so the rest of the URL still says which request it was.
   * The service has no rule like it because the service does not log query strings.
   */
  [new RegExp(`([?&#;](?:${FIELD_NAMES})=)[^&#\\s"']*`, 'gi'), `$1${MASK}`],
  // A listed name with a quoted value: JSON, and anything that renders like it.
  [new RegExp(`(${FIELD_AND_SEPARATOR})"(?:\\\\.|[^"\\\\])*"`, 'gi'), `$1"${MASK}"`],
  // A listed name with a bare value, up to the next delimiter — unless the URL rule has been.
  [new RegExp(`(${FIELD_AND_SEPARATOR})(?!"|${MASK})[^,;\\]})\\r\\n]*`, 'gi'), `$1${MASK}`],
  // A bank account.
  [/\b[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}\b/g, MASK],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, MASK],
  // International, and requiring the literal `+`, so an ISO timestamp is not a phone number.
  [/(?<![\w+])\+\d[\d\s().-]{7,17}\d(?!\w)/g, MASK],
  // Local, in the shape Azerbaijani mobile numbers are written in.
  [/(?<![\w+])0\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\w)/g, MASK],
];

const CARD_CANDIDATE = /(?<![0-9])[0-9](?:[ -]?[0-9]){11,18}(?![0-9])/g;

/** Masks everything §17.4 forbids in a piece of text. */
export function scrubText(text: string): string {
  let output = text;
  for (const [pattern, replacement] of RULES) output = output.replace(pattern, replacement);
  return output.replace(CARD_CANDIDATE, (candidate) =>
    cardLike(candidate.replace(/[ -]/g, '')) ? MASK : candidate,
  );
}

/** An issuer prefix at a length that issuer uses, and Luhn — `Redaction.java`'s `cardLike`. */
function cardLike(digits: string): boolean {
  return hasIssuerPrefix(digits) && passesLuhn(digits);
}

function hasIssuerPrefix(digits: string): boolean {
  const length = digits.length;
  const two = Number(digits.slice(0, 2));
  const four = Number(digits.slice(0, 4));
  switch (digits[0]) {
    case '4':
      return length === 13 || length === 16 || length === 19;
    case '5':
      return length === 16 && two >= 51 && two <= 55;
    case '2':
      return length === 16 && four >= 2221 && four <= 2720;
    case '3':
      return (length === 15 && (two === 34 || two === 37)) || (length === 16 && two === 35);
    case '6':
      return (
        (length === 16 && (digits.startsWith('6011') || two === 65)) ||
        (two === 62 && length >= 16 && length <= 19)
      );
    default:
      return false;
  }
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let doubling = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubling) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubling = !doubling;
  }
  return sum % 10 === 0;
}

/** Both passes over any value: names in objects, shapes in strings. */
export function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = isSensitiveName(key) && entry !== null && entry !== undefined ? MASK : scrubValue(entry);
    }
    return output;
  }
  return value;
}

/** The shape rules only — for the SDK's own descriptions of the device, whose fields are `name`. */
function scrubTextOnly(value: unknown): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map(scrubTextOnly);
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) output[key] = scrubTextOnly(entry);
    return output;
  }
  return value;
}

/** Top-level parts of an event that are the SDK's bookkeeping, never anybody's data. */
const UNTOUCHED = new Set([
  'event_id',
  'timestamp',
  'start_timestamp',
  'level',
  'platform',
  'release',
  'dist',
  'environment',
  'type',
  'sdk',
  'debug_meta',
  'modules',
  'tags',
  'fingerprint',
  'measurements',
]);

/** Contexts the SDK fills in about the device, the build and the trace. */
const SYSTEM_CONTEXTS = new Set(['os', 'device', 'app', 'runtime', 'culture', 'trace', 'react_native_context']);

/** Span and trace identifiers, which the shape rules could mistake for a card in a lucky run of digits. */
const IDENTIFIERS = new Set(['trace_id', 'span_id', 'parent_span_id', 'event_id']);

function scrubContexts(contexts: unknown): unknown {
  if (contexts === null || typeof contexts !== 'object') return contexts;
  const output: Record<string, unknown> = {};
  for (const [name, context] of Object.entries(contexts)) {
    if (name === 'trace') {
      output[name] = context;
    } else if (SYSTEM_CONTEXTS.has(name)) {
      const kept = scrubTextOnly(context);
      if (name === 'device' && kept !== null && typeof kept === 'object') {
        delete (kept as Record<string, unknown>).name;
      }
      output[name] = kept;
    } else {
      output[name] = scrubValue(context);
    }
  }
  return output;
}

function scrubSpans(spans: unknown): unknown {
  if (!Array.isArray(spans)) return spans;
  return spans.map((span: unknown) => {
    if (span === null || typeof span !== 'object') return span;
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(span)) {
      output[key] = IDENTIFIERS.has(key) ? entry : scrubValue(entry);
    }
    return output;
  });
}

/**
 * An event — an error or a transaction — as it may leave the phone: `beforeSend` and
 * `beforeSendTransaction`. The user is reduced to the account id (§18.1's pseudonymous UUID);
 * nothing else about them is ever set, and anything that was is dropped here.
 */
export function scrubEvent<E extends Event>(event: E): E {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (UNTOUCHED.has(key)) output[key] = value;
    else if (key === 'contexts') output[key] = scrubContexts(value);
    else if (key === 'spans') output[key] = scrubSpans(value);
    else if (key === 'user') output[key] = userIdOnly(value);
    else output[key] = scrubValue(value);
  }
  return output as E;
}

function userIdOnly(user: unknown): unknown {
  if (user === null || typeof user !== 'object') return user;
  const { id } = user as { id?: unknown };
  return typeof id === 'string' || typeof id === 'number' ? { id } : {};
}

/** A breadcrumb as it may be recorded: `beforeBreadcrumb`. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return {
    ...breadcrumb,
    ...(breadcrumb.message === undefined ? {} : { message: scrubText(breadcrumb.message) }),
    ...(breadcrumb.data === undefined
      ? {}
      : { data: scrubValue(breadcrumb.data) as Record<string, unknown> }),
  };
}
