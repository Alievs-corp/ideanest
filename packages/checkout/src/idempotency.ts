/**
 * Idempotency keys for the payment mutations — §10.3, PL-14.
 *
 * <h2>The rule, and why it is the most important detail in this client</h2>
 *
 * `Idempotency-Key` is required on `POST /v1/pledges/draft`, `POST
 * /v1/pledges/{id}/confirm`, `PATCH /v1/pledges/{id}` and `DELETE
 * /v1/pledges/{id}`. A replayed key returns the ORIGINAL response — same status,
 * same body — and keys are retained for twenty-four hours (§17.2).
 *
 * All of that is worth nothing if the client mints a fresh key per attempt.
 * Consider the failure the mechanism exists for: the request reaches the server,
 * the server reserves stock and writes a pledge, and the response is lost on the
 * way back — a dropped connection, a sleeping laptop, a proxy timing out. The
 * browser reports a network error and the backer presses the button again. With a
 * fresh key that second request is a second pledge. With the same key it is the
 * first one, answered from the server's record of it.
 *
 * **So a key belongs to an INTENT, not to an attempt**, and this module is the
 * only place that decides what an intent is.
 *
 * <h2>What counts as the same intent</h2>
 *
 * The body. Two requests that would create the same thing are the same intent;
 * two requests that differ in any field are not, and reusing a key across them
 * earns `409 IDEMPOTENCY_KEY_REUSED` — the server's own guard against a client
 * that thinks a changed selection is a retry. So the intent is keyed on a
 * canonical serialisation of the request body rather than on a hand-written
 * label, which makes "the same intent" an objective fact about the request
 * instead of a judgement a caller has to remember to make.
 *
 * <h2>When a key must be RETIRED</h2>
 *
 * Exactly one case, and it is not obvious: **the reservation expired**. A draft's
 * five minutes elapse, the backer presses "start again", and the body is
 * identical to the one that produced the expired draft — same tier, same add-ons,
 * same amount. Replaying the key would hand back the very draft that just
 * expired, and the checkout would loop. A new reservation after an expiry is a
 * NEW intent that happens to look like the old one, so the key is retired and the
 * next request mints a fresh one. `retire` exists for that, and for the mirror
 * case of `IDEMPOTENCY_KEY_REUSED`, where the server has told us the key is spent.
 *
 * <h2>What this deliberately does not do</h2>
 *
 * The keys live in memory, so a page reload starts over with new ones. Persisting
 * them across a reload would extend the guarantee to "the backer reloaded because
 * it looked stuck and tried again", which is a real case — but it also puts a
 * payment identifier into `sessionStorage`, where it survives being logged out,
 * and it fails in ways storage fails. The backstop for that case is the server's:
 * §7.2's unique index gives one active pledge per backer per campaign, and the
 * second attempt is refused with `PLEDGE_ALREADY_EXISTS` rather than duplicated.
 * That refusal is rendered as what it is (see `./failure`).
 */

/**
 * A canonical string for a request body: object keys sorted, at every depth.
 *
 * `JSON.stringify` alone would be enough for the bodies this client builds, since
 * it builds them itself in a fixed order — but "enough today" is how a
 * duplicate-charge bug is written. `{tier: 'a', qty: 2}` and `{qty: 2, tier: 'a'}`
 * describe the same pledge and must produce the same key, and a later refactor
 * that reorders a literal must not silently become a second charge.
 *
 * `undefined` is dropped exactly as `JSON.stringify` drops it, so a field the
 * caller omitted and a field it set to `undefined` are the same intent — which is
 * also what the wire sees.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`);
    return `{${entries.join(',')}}`;
  }

  if (typeof value === 'undefined') return 'null';

  return JSON.stringify(value) ?? 'null';
}

/**
 * A fresh key.
 *
 * `crypto.randomUUID()` because the contract says a UUID string, and because the
 * key has to be unguessable: a key is a claim on somebody's pledge for
 * twenty-four hours, and a counter or a timestamp would let one request be
 * answered with another's result.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * The keys one checkout has issued, by intent.
 *
 * A plain object rather than a hook so that the same rule is testable without
 * rendering anything, and so that the caller decides its lifetime — `useCheckout`
 * holds one in a ref, which makes the keys survive every re-render and none of
 * the remounts that mean the backer started over.
 */
export class IdempotencyKeyring {
  private readonly issued = new Map<string, string>();
  private readonly mint: () => string;

  constructor(mint: () => string = newIdempotencyKey) {
    this.mint = mint;
  }

  /**
   * The key for this body, minting one the first time and returning the same one
   * for every request that would send the same body afterwards.
   */
  keyFor(body: unknown): string {
    const intent = canonicalize(body);
    const existing = this.issued.get(intent);
    if (existing !== undefined) return existing;

    const minted = this.mint();
    this.issued.set(intent, minted);
    return minted;
  }

  /**
   * Forgets the key for this body, so the next request for it mints a new one.
   *
   * Only for the two cases the file comment names: a reservation that expired,
   * and a key the server has said is spent. Calling it anywhere else turns a safe
   * retry back into a second pledge.
   */
  retire(body: unknown): void {
    this.issued.delete(canonicalize(body));
  }

  /** How many intents have been issued a key. For tests, and for nothing else. */
  get size(): number {
    return this.issued.size;
  }
}
