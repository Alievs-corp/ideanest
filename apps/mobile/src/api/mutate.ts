import { sendJson } from './client';

/**
 * A pledge mutation. The key is required by the signature, never optional: a money write without
 * one is a second pledge waiting to happen. No retry here; `attemptWithRetry` owns that.
 */
export async function sendIdempotent<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
  if (idempotencyKey === '') throw new Error('A pledge mutation needs an Idempotency-Key.');
  return (await sendJson('POST', path, body, { 'Idempotency-Key': idempotencyKey })) as T;
}
