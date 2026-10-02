import { sendJson } from '../../api/client';

/** `POST /v1/auth/change-email` — 202: the link is sent, nothing has moved yet. */
export async function requestEmailChange(input: {
  readonly currentPassword: string;
  readonly newEmail: string;
}): Promise<void> {
  await sendJson('POST', '/v1/auth/change-email', input);
}

/** `POST /v1/auth/change-password` — every session on the account ends, this one included. */
export async function changePassword(input: {
  readonly currentPassword: string;
  readonly newPassword: string;
}): Promise<void> {
  await sendJson('POST', '/v1/auth/change-password', input);
}

/** `PATCH /v1/me/currency`. */
export async function saveDisplayCurrency(currency: string): Promise<void> {
  await sendJson('PATCH', '/v1/me/currency', { currency });
}
