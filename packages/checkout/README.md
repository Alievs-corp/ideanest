# `@ideanest/checkout`

The checkout's rules with one right answer, for `apps/web` and `apps/mobile`:

| Module | Contents |
|---|---|
| `./types` | Pledge wire types, `isShipped`, `isSoldOut` |
| `./quote` | The client preview on `decimal.js`, destination options and refusals |
| `./idempotency` | `canonicalize`, `IdempotencyKeyring` (the key minter is injectable; React Native passes `expo-crypto`'s `randomUUID`) |
| `./failure` | `describeFailure`, `PLEDGE_FAILURE_CODES` and the recovery table |
| `./refusals` | `contributionMessage`, `refusalMessage` over the `checkout.errors` copy |
| `./attempt` | `attemptWithRetry`: `IDEMPOTENT_REQUEST_IN_PROGRESS` waited out with the same key |
| `./reservation`, `./draft` | The reservation clock and the draft and payment bodies |
| `./pledge` | A pledge's controls (`isEditable`, `isRaisable`, `isDisputable`), its tone and charge note, the payment and raise return outcomes, the settling poll bounds, `quotedRate` |
| `./edit` | The Merge-Patch edit: `draftOf`, `changesFrom` (absent keeps, `null` clears), `seedOf`, `raiseDifference` |

Money never becomes a `number`: amounts are `Money` strings on the wire and `Decimal` in arithmetic.
