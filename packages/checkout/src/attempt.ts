import { describeFailure, type CheckoutFailure, type PledgeFailureCopy } from './failure';

export const DEFAULT_RETRY_AFTER_MS = 1000;
export const MAX_RETRY_AFTER_MS = 5000;
export const IN_PROGRESS_RETRY_LIMIT = 3;

export type Attempted<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: CheckoutFailure };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a pledge mutation, waiting out `IDEMPOTENT_REQUEST_IN_PROGRESS` with the same key up to
 * {@link IN_PROGRESS_RETRY_LIMIT} times. `run` must reuse its key on every call.
 */
export async function attemptWithRetry<T>(
  run: () => Promise<T>,
  copy: PledgeFailureCopy,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<Attempted<T>> {
  for (let retries = 0; ; retries += 1) {
    try {
      return { ok: true, value: await run() };
    } catch (cause) {
      const failure = describeFailure(cause, copy);
      if (failure.recovery !== 'wait-and-retry' || retries >= IN_PROGRESS_RETRY_LIMIT) {
        return { ok: false, failure };
      }
      await wait(Math.min(failure.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS, MAX_RETRY_AFTER_MS));
    }
  }
}
