# `@ideanest/plans`

What a creator pays to publish (§22.3), as both clients read it — `apps/web` and `apps/mobile`
(#164). One statement of the wire types and the rules, so the two pricing pages cannot come to
different answers about the same subscription.

| Module | Contents |
|---|---|
| `./catalogue` | `Plan`, `HeldSubscription`, `MySubscription`, `BillingPeriod`, `SubscriptionState`; `readPlan`, `readPlanCatalogue` and `readMine` (response narrowing); `isFreePrice` (through `decimal.js`); `standingOf` (pending, lapsed, ending, active); `blocksChoice`, `isHeldPlan`; `refusalOf` (`ALREADY_SUBSCRIBED`, `PLAN_NOT_ON_SALE`, 401, anything else) |
| `./fees` | `FeeDisclosure`, `readFeeDisclosure`, `FeeAudience`, and `disclosureStateOf` — unconfigured, unavailable or configured, so a failed read never says "nothing is deducted" (#145) |

Import by subpath only. There is no root entry, so a web bundle pulls in exactly the module it
names.

Nothing here fetches: the web's reads (`apps/web/src/lib/plans/api.ts`,
`apps/web/src/lib/fees/server.ts`) and the app's queries (`apps/mobile/src/features/plans/api.ts`)
stay with each client, and the words stay in `@ideanest/messages`. Amounts and rates are strings
throughout; formatting them is each client's job.
