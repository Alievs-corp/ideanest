import { describe, expect, it } from 'vitest';
import { canonicalize, IdempotencyKeyring, newIdempotencyKey } from './idempotency';

/**
 * The keys, on their own, without a component around them.
 *
 * CLAUDE.md §3 makes idempotency non-optional to test, and this is why: every
 * failure here is invisible until it has already charged somebody twice or
 * refused a pledge that should have gone through. There is nothing to see in a
 * screenshot and nothing to notice in review.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('newIdempotencyKey', () => {
  it('is a UUID, and a different one each time', () => {
    const first = newIdempotencyKey();
    const second = newIdempotencyKey();

    expect(first).toMatch(UUID);
    expect(second).toMatch(UUID);
    expect(first).not.toBe(second);
  });
});

describe('canonicalize', () => {
  it('reads two spellings of the same body as the same thing', () => {
    // A later refactor that reorders a literal must not silently become a second
    // charge, which is what a raw `JSON.stringify` would allow.
    expect(canonicalize({ projectId: 'p1', rewardTierId: 'r1' })).toBe(
      canonicalize({ rewardTierId: 'r1', projectId: 'p1' }),
    );
  });

  it('sorts at every depth, and keeps array order', () => {
    expect(canonicalize({ a: { z: 1, y: 2 } })).toBe(canonicalize({ a: { y: 2, z: 1 } }));
    // An ordered list is data, not a spelling: `[1, 2]` and `[2, 1]` are
    // different bodies and the server would treat them as such.
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it('treats an omitted field and an undefined one as the same body', () => {
    // Which is what the wire sees — `JSON.stringify` drops both.
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });

  it('does not confuse a null with a missing field', () => {
    expect(canonicalize({ a: 1, b: null })).not.toBe(canonicalize({ a: 1 }));
  });
});

describe('IdempotencyKeyring', () => {
  const body = { projectId: 'p1', rewardTierId: 'r1', contribution: { amount: '45.00' } };

  it('gives one key to one intent, however many times it is asked', () => {
    const keyring = new IdempotencyKeyring();

    // The retry case: the request went out, the response was lost, the backer
    // pressed the button again. The second request has to be the first one.
    expect(keyring.keyFor(body)).toBe(keyring.keyFor(body));
    expect(keyring.size).toBe(1);
  });

  it('gives a different key to a body that would create something else', () => {
    const keyring = new IdempotencyKeyring();
    const other = { ...body, rewardTierId: 'r2' };

    // Reusing one here would be answered `409 IDEMPOTENCY_KEY_REUSED`, and the
    // backer would be stuck holding a tier they had already changed their mind
    // about.
    expect(keyring.keyFor(body)).not.toBe(keyring.keyFor(other));
  });

  it('mints a new key once an intent is retired', () => {
    const keyring = new IdempotencyKeyring();
    const first = keyring.keyFor(body);

    // What happens after a reservation expires: the body is identical, and
    // replaying the key would hand back the very draft that expired.
    keyring.retire(body);

    expect(keyring.keyFor(body)).not.toBe(first);
  });

  it('retires by body rather than by identity', () => {
    const keyring = new IdempotencyKeyring();
    const first = keyring.keyFor(body);

    // A caller that rebuilt the body from state — which is what every render
    // does — must still be able to retire the key it produced.
    keyring.retire({ ...body });

    expect(keyring.keyFor({ ...body })).not.toBe(first);
  });
});

describe('IdempotencyKeyring with an injected minter', () => {
  it('mints through the given function, once per intent', () => {
    let count = 0;
    const keyring = new IdempotencyKeyring(() => `key-${++count}`);
    expect(keyring.keyFor({ a: 1 })).toBe('key-1');
    expect(keyring.keyFor({ a: 1 })).toBe('key-1');
    expect(keyring.keyFor({ a: 2 })).toBe('key-2');
    keyring.retire({ a: 1 });
    expect(keyring.keyFor({ a: 1 })).toBe('key-3');
  });
});
