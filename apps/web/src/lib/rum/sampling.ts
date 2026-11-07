import { newTraceId } from './correlation';

/**
 * Who is measured, decided once per page load rather than once per metric.
 *
 * <h2>Why the decision is per session and not per sample</h2>
 *
 * A coin flip per metric looks equivalent and destroys the thing being measured.
 * Core Web Vitals is a **p75 over sessions**: the question is "three quarters of
 * visits were at least this good", and it is answered by ranking whole visits.
 * Flipping per metric ranks *metrics*, so a session that reported LCP but was
 * dropped for INP appears in one distribution and not the other, and the slow
 * sessions — the ones that emit more samples because they are slow enough for a
 * user to interact repeatedly — are over-represented in exactly the metric they
 * are worst at. The number that comes out has the shape of a p75 and is not one.
 *
 * The decision is therefore a pure function of the session identifier, taken
 * once and reused for every metric that session produces.
 *
 * <h2>Why a session is a page load, held in memory — #641</h2>
 *
 * It used to be kept in `sessionStorage`, so a reload continued the same session.
 * That is storage on the reader's device that the reader did not ask for and the
 * site does not strictly need, which under the EU ePrivacy benchmark is what a
 * consent banner exists to ask about. So the session now lives in this page's
 * JavaScript and nowhere else: a client-side navigation stays in it, a reload or a
 * new tab starts another. The cost is that a reload is a fresh flip, which at the
 * default rate of 1.0 is no cost at all, and below it measures slightly more,
 * shorter visits; the p75 is still over whole page loads, never over metrics.
 *
 * <h2>Why the default rate is 1.0</h2>
 *
 * Because a percentile computed from too few samples is a number that will be
 * believed and should not be. The working rule is **roughly a thousand samples
 * per route per day** before a p75 is stable enough to notice a regression in;
 * below a few hundred it moves by more between two ordinary days than a real
 * regression would move it — the same argument
 * `apps/web/performance/README.md` makes for not gating on lab Core Web Vitals.
 *
 * `docs/architecture.md` §11.4 states the platform's current position plainly:
 * it has "no metrics, tracing, or alerting", and there is no production traffic
 * to sample down from. At this volume any rate below 1.0 buys nothing and costs
 * the ability to say anything. The rate exists as a knob because the day
 * `/discover` is serving real traffic the arithmetic reverses, and the rule for
 * turning it down is written above: keep about a thousand samples per route per
 * day, and no fewer.
 *
 * `0` disables collection entirely, and is the correct setting for an
 * environment where the endpoint has nowhere to write.
 */

/**
 * The rate, as a fraction between 0 and 1.
 *
 * `NEXT_PUBLIC_` because the decision is taken in the browser. It is inlined at
 * build time, so changing it means rebuilding — which is the honest description
 * of a value baked into a bundle, and the reason the reader below is given the
 * raw string rather than a `process.env` lookup it could not have inlined.
 */
export const SAMPLE_RATE_VARIABLE = 'NEXT_PUBLIC_IDEANEST_RUM_SAMPLE_RATE';

export const DEFAULT_SAMPLE_RATE = 1;

/**
 * Where the session is held: a property of the page's global object, for the
 * life of its JavaScript. `instrumentation-client.ts` and the reporter both
 * resolve the session and must agree on its trace, and a registered symbol is
 * the same key even if the bundler gives each of them its own copy of this
 * module, which a module-level variable would not be.
 */
export const SESSION_SLOT: unique symbol = Symbol.for('ideanest.rum.session');

/** What holds the session: the `window` in a browser, a plain object in a test. */
export interface SessionHolder {
  [SESSION_SLOT]?: RumSession;
}

export interface RumSession {
  /** A v4 UUID. Not an account, not a device, and gone with the page. */
  readonly id: string;
  /** Whether this visit reports. Taken once; every metric obeys it. */
  readonly sampled: boolean;
  /** The trace every beacon from this session belongs to (§18.1). */
  readonly traceId: string;
}

/**
 * A configured rate, clamped, or the default.
 *
 * A value that is set but unreadable falls back rather than throwing, which is
 * the opposite of `lib/seo/sitemap/config.ts`'s rule for `IDEANEST_SITE_URL` and
 * is the right way round for this one: a bad site URL silently poisons every
 * canonical in production, whereas a bad sample rate would take a monitoring
 * feature and turn it into a blank page.
 */
export function parseSampleRate(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_SAMPLE_RATE;
  const trimmed = raw.trim();
  if (trimmed === '') return DEFAULT_SAMPLE_RATE;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return DEFAULT_SAMPLE_RATE;
  if (parsed <= 0) return 0;
  return parsed >= 1 ? 1 : parsed;
}

/**
 * FNV-1a, 32 bit, mapped onto `[0, 1)`.
 *
 * Deterministic and dependency-free. It is not a cryptographic hash and does not
 * need to be: the input is already 122 bits of `crypto.randomUUID()` entropy, so
 * the hash is only being asked to spread it evenly, and an attacker who wanted
 * to be sampled in could simply reload until they were.
 */
export function hashToUnitInterval(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    // `Math.imul` keeps the multiply in 32 bits; `*` would lose the low bits to
    // the float mantissa and collapse the output range.
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

/** Whether this session reports, given the rate. Same session, same answer, always. */
export function isSampled(sessionId: string, rate: number): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return hashToUnitInterval(sessionId) < rate;
}

/**
 * The session for this page: the one already resolved, or a new one now.
 *
 * Nothing is read from or written to storage, so there is nothing left over from
 * an earlier page to validate, and nothing for a private window or a strict
 * storage policy to refuse.
 */
export function resolveSession(
  holder: SessionHolder,
  rate: number,
  mintId: () => string = () => crypto.randomUUID(),
): RumSession {
  const existing = holder[SESSION_SLOT];
  if (existing !== undefined) return existing;

  const id = mintId();
  const session: RumSession = { id, sampled: isSampled(id, rate), traceId: newTraceId() };
  holder[SESSION_SLOT] = session;
  return session;
}
