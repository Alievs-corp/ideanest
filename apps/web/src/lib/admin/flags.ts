import type { components } from '@ideanest/api-client/schema';
import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/**
 * §4.11's AD-12: what is switched on, for whom — issue #312.
 *
 * <h2>Off means off, including for the named accounts</h2>
 *
 * `enabled` is the master switch. An account on the explicit list does not see a disabled
 * flag, because "I turned it off and it is still on for some people" is the worst possible
 * property of the control somebody reaches for during an incident.
 *
 * <h2>A percentage is a stable hash, not a sample</h2>
 *
 * Which accounts fall inside a rollout is decided by hashing the flag and the account, so
 * widening a rollout only ever adds people. A stored sample would have to be recomputed when
 * the percentage moved, and every recomputation takes the feature away from somebody who had
 * it.
 *
 * <h2>A save names the version it was made from</h2>
 *
 * The screen sends a flag's whole state, read from a list that may be minutes old. A create
 * sends no version and is refused for a name that exists (`FEATURE_FLAG_EXISTS`); an edit sends
 * the version it read and is refused when somebody has saved over it since
 * (`FEATURE_FLAG_CHANGED`). Before that, typing a live flag's name into the add form switched it
 * off for everybody, and two people editing one flag lost each other's change.
 */

export interface FeatureFlag {
  readonly key: string;
  readonly description: string;
  /** The master switch. Off is off for everybody. */
  readonly enabled: boolean;
  readonly rolloutPercentage: number;
  /** Always in, whatever the percentage says — as long as the flag is enabled. */
  readonly enabledAccounts: readonly string[];
  readonly updatedAt: string;
  readonly updatedBy: string;
  /** What an edit sends back. */
  readonly version: number;
}

export interface FeatureFlagList {
  readonly flags: readonly FeatureFlag[];
}

type WireFlag = components['schemas']['FeatureFlag'];

/*
 * The generated types mark every field optional, because the service's records are read
 * through springdoc without `@Schema(requiredMode)`. The service always sends them except
 * where they are null, which it omits; the defaults are what a missing one would mean.
 */
function flagFrom(wire: WireFlag): FeatureFlag {
  return {
    key: wire.key ?? '',
    description: wire.description ?? '',
    enabled: wire.enabled ?? false,
    rolloutPercentage: wire.rolloutPercentage ?? 0,
    enabledAccounts: wire.enabledAccounts ?? [],
    updatedAt: wire.updatedAt ?? '',
    updatedBy: wire.updatedBy ?? '',
    version: wire.version ?? 0,
  };
}

/** Every flag, alphabetically. */
export async function readFlags(signal?: AbortSignal): Promise<FeatureFlagList> {
  const response = await authorizedFetch('/v1/admin/feature-flags', { signal });
  if (!response.ok) throw await errorFrom(response);

  const body = (await response.json()) as { flags?: WireFlag[] };
  return { flags: (body.flags ?? []).map(flagFrom) };
}

/** Everything a save sends about a flag. */
export interface FlagState {
  readonly key: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly rolloutPercentage: number;
  readonly enabledAccounts: readonly string[];
}

/**
 * Creates a flag: off, at nought percent, for nobody — always.
 *
 * A flag that arrived switched on would be a feature shipped by the act of naming it. No
 * version is sent, which is what makes this a create: the service refuses it with
 * `FEATURE_FLAG_EXISTS` when the name is taken rather than resetting the flag that has it.
 */
export function createFlag(key: string, description: string): Promise<FeatureFlag> {
  return put(key, { description, enabled: false, rolloutPercentage: 0, enabledAccounts: [] });
}

/**
 * Replaces everything about a flag except its name, from the version the screen read.
 *
 * Refused with `FEATURE_FLAG_CHANGED` when somebody has saved over that version since.
 */
export function saveFlag(state: FlagState, version: number): Promise<FeatureFlag> {
  return put(state.key, {
    description: state.description,
    enabled: state.enabled,
    rolloutPercentage: state.rolloutPercentage,
    enabledAccounts: [...state.enabledAccounts],
    version,
  });
}

async function put(key: string, body: Record<string, unknown>): Promise<FeatureFlag> {
  const response = await authorizedFetch(`/v1/admin/feature-flags/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await errorFrom(response);

  return flagFrom((await response.json()) as WireFlag);
}

/**
 * What the service accepts as a flag name.
 *
 * Mirrors V50's `CHECK`, so the screen can refuse before the request. The service checks it
 * too and answers `FEATURE_FLAG_KEY_INVALID`. Lower case, hyphenated, three characters or more.
 */
export const FLAG_KEY_PATTERN = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;

/** V50's bounds. */
export const MAX_DESCRIPTION = 2000;
export const MAX_ENABLED_ACCOUNTS = 200;

/** The percentages the screen offers as one press each. Any other value is still shown. */
export const ROLLOUT_STEPS: readonly number[] = [0, 10, 25, 50, 100];

/**
 * Who a flag reaches, as the screen words it.
 *
 * <ul>
 *   <li>`off` — switched off, so nobody, including the named accounts;
 *   <li>`nobody` — on, at nought percent, with nobody named: it reaches nobody, which the screen
 *       says because "On" beside it reads as though it did;
 *   <li>`named` — on at nought percent, for the named accounts only;
 *   <li>`some` — on for a share of signed-in readers, and the named accounts;
 *   <li>`everybody` — on at a hundred percent, visitors included.
 * </ul>
 */
export type FlagReach = 'off' | 'nobody' | 'named' | 'some' | 'everybody';

export function reachOf(flag: Pick<FlagState, 'enabled' | 'rolloutPercentage' | 'enabledAccounts'>): FlagReach {
  if (!flag.enabled) return 'off';
  if (flag.rolloutPercentage >= 100) return 'everybody';
  if (flag.rolloutPercentage > 0) return 'some';
  return flag.enabledAccounts.length > 0 ? 'named' : 'nobody';
}

/**
 * Whether a change makes the flag reach anybody it did not reach before.
 *
 * Those changes ask first, because they show a feature to people. One that only narrows — off,
 * a lower percentage, an account taken out — is one press: it is what somebody reaches for when
 * a feature is misbehaving, and a question in front of it is a delay at the worst moment.
 */
export function widensReach(before: FlagState, after: FlagState): boolean {
  const reach = reachOf(after);
  if (reach === 'off' || reach === 'nobody') return false;
  if (!before.enabled) return true;
  if (after.rolloutPercentage > before.rolloutPercentage) return true;
  const had = new Set(before.enabledAccounts);
  return after.enabledAccounts.some((account) => !had.has(account));
}
