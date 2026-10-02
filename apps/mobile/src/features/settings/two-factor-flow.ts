import { ApiError } from '@ideanest/api-client';
import type { AuthFailure } from '../../lib/auth-failures';
import type { TwoFactorEnrolment } from './two-factor-api';

/**
 * The two-factor card's steps (#161), the web's `TwoFactorPanel`, as a pure reducer so every
 * transition can be tested without rendering.
 *
 * idle → password → scan → codes → idle switches it on; idle → disable → idle switches it off;
 * an "already enabled" refusal of the password step goes straight to disable. The recovery
 * codes live only in this state, which lives only in the component: never in storage, never in
 * the query cache.
 */

export type TwoFactorStep =
  | { readonly kind: 'idle' }
  | { readonly kind: 'password' }
  | { readonly kind: 'scan'; readonly enrolment: TwoFactorEnrolment }
  | { readonly kind: 'codes'; readonly codes: readonly string[]; readonly acknowledged: boolean }
  | { readonly kind: 'disable' };

/** What the service told us, in our words — see {@link isAlreadyEnabled}. */
export type TwoFactorNotice = 'enabled' | 'disabled' | 'alreadyEnabled';

export interface TwoFactorState {
  readonly step: TwoFactorStep;
  readonly busy: boolean;
  readonly failure: AuthFailure | null;
  readonly notice: TwoFactorNotice | null;
  /** Counts step changes. The card moves screen-reader focus to the heading when it changes. */
  readonly moves: number;
}

export type TwoFactorEvent =
  | { readonly type: 'setUp' }
  | { readonly type: 'turnOff' }
  | { readonly type: 'cancel' }
  | { readonly type: 'submitted' }
  | { readonly type: 'enrolled'; readonly enrolment: TwoFactorEnrolment }
  | { readonly type: 'alreadyEnabled' }
  | { readonly type: 'confirmed'; readonly codes: readonly string[] }
  | { readonly type: 'acknowledge'; readonly acknowledged: boolean }
  | { readonly type: 'done' }
  | { readonly type: 'disabled' }
  | { readonly type: 'refused'; readonly failure: AuthFailure }
  | { readonly type: 'dismissNotice' };

export const INITIAL_TWO_FACTOR: TwoFactorState = {
  step: { kind: 'idle' },
  busy: false,
  failure: null,
  notice: null,
  moves: 0,
};

function go(
  state: TwoFactorState,
  step: TwoFactorStep,
  notice: TwoFactorNotice | null = state.notice,
): TwoFactorState {
  return { step, busy: false, failure: null, notice, moves: state.moves + 1 };
}

export function twoFactorReducer(state: TwoFactorState, event: TwoFactorEvent): TwoFactorState {
  const { step } = state;
  switch (event.type) {
    case 'setUp':
      return step.kind === 'idle' && !state.busy ? go(state, { kind: 'password' }) : state;
    case 'turnOff':
      return step.kind === 'idle' && !state.busy ? go(state, { kind: 'disable' }) : state;
    case 'cancel':
      // Never from the codes: they are shown once, and only "Done" leaves them. Never mid-request
      // either, or a confirmation that lands after it would switch two-factor on unseen.
      return step.kind !== 'idle' && step.kind !== 'codes' && !state.busy
        ? go(state, { kind: 'idle' })
        : state;
    case 'submitted':
      return state.busy ? state : { ...state, busy: true, failure: null };
    case 'enrolled':
      return step.kind === 'password' ? go(state, { kind: 'scan', enrolment: event.enrolment }) : state;
    case 'alreadyEnabled':
      // The answer to the question this screen cannot ask: the off-path, with our sentence above it.
      return step.kind === 'password' ? go(state, { kind: 'disable' }, 'alreadyEnabled') : state;
    case 'confirmed':
      return step.kind === 'scan'
        ? go(state, { kind: 'codes', codes: event.codes, acknowledged: false })
        : state;
    case 'acknowledge':
      return step.kind === 'codes'
        ? { ...state, step: { ...step, acknowledged: event.acknowledged } }
        : state;
    case 'done':
      return canFinish(state) ? go(state, { kind: 'idle' }, 'enabled') : state;
    case 'disabled':
      return step.kind === 'disable' ? go(state, { kind: 'idle' }, 'disabled') : state;
    case 'refused':
      return { ...state, busy: false, failure: event.failure };
    case 'dismissNotice':
      return { ...state, notice: null };
  }
}

/** "Done" is the only way off the codes, and it waits for the reader to say they saved them. */
export function canFinish(state: TwoFactorState): boolean {
  return state.step.kind === 'codes' && state.step.acknowledged;
}

/**
 * The service's own sentence for an account that is already enrolled.
 *
 * The endpoint publishes no `code` for it, so — as on the web, whose `TwoFactorPanel` records
 * why — the English wire sentence is what tells it apart, and what is printed is our own
 * translated `alreadyEnabled` rather than what arrived.
 */
const ALREADY_ENABLED = 'Two-factor authentication is already enabled.';

export function isAlreadyEnabled(cause: unknown): boolean {
  return cause instanceof ApiError && cause.problem?.detail === ALREADY_ENABLED;
}
