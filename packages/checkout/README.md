# `@ideanest/checkout`

The checkout's rules with one right answer, for `apps/web` and `apps/mobile`:

| Module | Contents |
|---|---|
| `./types` | Pledge wire types, `isShipped`, `isSoldOut` |
| `./quote` | The client preview on `decimal.js`, destination options and refusals |
| `./idempotency` | `canonicalize`, `IdempotencyKeyring` (the key minter is injectable; React Native passes `expo-crypto`'s `randomUUID`) |
| `./failure` | `describeFailure`, `PLEDGE_FAILURE_CODES` and the recovery table |
| `./refusals` | `contributionMessage`, `refusalMessage` over the `checkout.errors` copy |

Money never becomes a `number`: amounts are `Money` strings on the wire and `Decimal` in arithmetic.
