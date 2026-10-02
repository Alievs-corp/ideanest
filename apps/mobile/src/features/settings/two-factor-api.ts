import { sendJson } from '../../api/client';

/**
 * The three signed-in two-factor endpoints (#161), the web's `lib/auth/twoFactor.ts`. Each
 * refusal is thrown as the shared `ApiError` with the service's own sentence.
 */

/** The secret, returned once: a second `enable` generates a different one. */
export interface TwoFactorEnrolment {
  readonly secret: string;
  readonly otpauthUri: string;
  readonly digits: number;
  readonly periodSeconds: number;
  readonly algorithm: string;
}

/** Exactly one of a generated code and a recovery code. */
export type TwoFactorProof =
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'recovery-code'; readonly recoveryCode: string };

function isEnrolment(value: unknown): value is TwoFactorEnrolment {
  if (value === null || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.secret === 'string' &&
    typeof body.otpauthUri === 'string' &&
    typeof body.digits === 'number' &&
    typeof body.periodSeconds === 'number' &&
    typeof body.algorithm === 'string'
  );
}

/** `POST /v1/auth/2fa/enable` — starts an enrolment. Two-factor is not on when this returns. */
export async function startTwoFactorEnrolment(password: string): Promise<TwoFactorEnrolment> {
  const body = await sendJson('POST', '/v1/auth/2fa/enable', { password });
  if (!isEnrolment(body)) throw new Error('The enrolment response was not the expected shape.');
  return body;
}

/**
 * `POST /v1/auth/2fa/confirm` — switches it on and returns the recovery codes, in the only
 * response that will ever contain them.
 */
export async function confirmTwoFactorEnrolment(code: string): Promise<readonly string[]> {
  const body = await sendJson('POST', '/v1/auth/2fa/confirm', { code });
  if (body === null || typeof body !== 'object') return [];
  const codes = (body as { recoveryCodes?: unknown }).recoveryCodes;
  return Array.isArray(codes) ? codes.filter((item): item is string => typeof item === 'string') : [];
}

/** `POST /v1/auth/2fa/disable` — the password and a proof. */
export async function disableTwoFactor(password: string, proof: TwoFactorProof): Promise<void> {
  await sendJson('POST', '/v1/auth/2fa/disable', {
    password,
    ...(proof.kind === 'code' ? { code: proof.code } : { recoveryCode: proof.recoveryCode }),
  });
}
