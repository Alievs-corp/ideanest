import { currentAccessToken } from './api/access-token';
import { publicFetch } from './api/client';

/**
 * What is switched on for the person reading the page — AD-12.
 *
 * <h2>Nothing reads this yet, and that is stated rather than hidden</h2>
 *
 * The console has edited flags since #312 and no client could read one, so a switch on the
 * screen switched nothing. `GET /v1/feature-flags` answers every flag for the caller, and this
 * is how a component asks. No feature is behind a flag today; the console's flags screen says
 * so, and the day a feature reads one through {@link readFeatureFlags} the switch becomes its
 * kill switch.
 *
 * <h2>It fails closed</h2>
 *
 * A flag the answer does not mention is off, and so is every flag when the answer cannot be
 * read — the service down, the platform closed for maintenance, the network gone. A feature
 * that appeared because a request failed would be a feature nobody decided to ship, which is
 * the rule the service's own `FeatureFlags.isOn` follows for a name with no row.
 *
 * <h2>Asked once per reader per short while</h2>
 *
 * The service answers `private, max-age` for as long as it holds its own snapshot, but
 * {@link publicFetch} revalidates every request on purpose. So the answer is held here, in
 * memory, for the same few seconds and for the same reader: a page with five components that
 * ask costs one request, and signing in or out — a different token — asks again, because the
 * answer depends on who is asking.
 */

export interface FeatureFlagAnswers {
  /** Whether the reader sees the feature. False for a name the service did not mention. */
  readonly isOn: (key: string) => boolean;
}

/** Everything off: what a failed read means. */
export const ALL_OFF: FeatureFlagAnswers = Object.freeze({ isOn: () => false });

/** The service's snapshot is held for ten seconds; holding the answer longer would only make a switch slower. */
const HOLD_MS = 10_000;

interface Held {
  readonly reader: string | null;
  readonly at: number;
  readonly answers: Promise<FeatureFlagAnswers>;
}

let held: Held | null = null;

/**
 * The flags for whoever is reading, signed in or not.
 *
 * Never rejects: a failure is {@link ALL_OFF}. An aborted read is also answered as all off,
 * which is what a caller that has stopped listening would be given anyway.
 */
export function readFeatureFlags(now: number = Date.now()): Promise<FeatureFlagAnswers> {
  const reader = currentAccessToken();
  if (held !== null && held.reader === reader && now - held.at < HOLD_MS) return held.answers;

  const answers = fetchAnswers();
  held = { reader, at: now, answers };
  // A failure is not held: the next caller asks again rather than inheriting an outage.
  void answers.then((result) => {
    if (result === ALL_OFF && held?.answers === answers) held = null;
  });
  return answers;
}

async function fetchAnswers(): Promise<FeatureFlagAnswers> {
  try {
    const response = await publicFetch('/v1/feature-flags');
    if (!response.ok) return ALL_OFF;
    return answersFrom(await response.json());
  } catch {
    return ALL_OFF;
  }
}

/** The service's body as answers, keeping only what is unmistakably a yes. */
export function answersFrom(body: unknown): FeatureFlagAnswers {
  const flags = typeof body === 'object' && body !== null ? (body as { flags?: unknown }).flags : undefined;
  if (typeof flags !== 'object' || flags === null) return ALL_OFF;

  const on = new Set<string>();
  for (const [key, value] of Object.entries(flags)) {
    if (value === true) on.add(key);
  }
  return Object.freeze({ isOn: (key: string) => on.has(key) });
}

/** Tests only: forget the held answer. */
export function forgetFeatureFlags(): void {
  held = null;
}
