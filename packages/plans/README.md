# `@ideanest/plans`

What a creator pays to publish (§22.3), as both clients read it — `apps/web` and `apps/mobile`
(#164). One statement of the wire types and the rules, so the two pricing pages cannot come to
different answers about the same subscription.

| Module | Contents |
|---|---|
| `./catalogue` | `Plan` (with `prices` per `BillingPeriod` and `studentOnly`), `HeldSubscription`, `MySubscription`, `SubscriptionState`; `readPlan`, `readPlanCatalogue` and `readMine` (response narrowing); `isFreePrice` (through `decimal.js`); `standingOf` (pending, lapsed, ending, active); `isHeldPlan`; `PaymentDue` and `HeldSubscription.paymentDue` / `renewalOpensAt` (#449). Re-exports everything in `./periods` and `canChoose` from `./choice`, so existing imports keep working |
| `./periods` | `BillingPeriod` (monthly, six-monthly, yearly), `PlanPrice`, `BILLING_PERIODS`, `MONTHS_IN`, `isBillingPeriod`, `priceFor`, `offeredPeriods`, `isZeroAmount`, `canonicalAmount` and `sameAmount` (decimal equality of amounts as text), and `refusalOf` (`ALREADY_SUBSCRIBED`, `PLAN_NOT_ON_SALE`, `PERIOD_NOT_OFFERED`, `STUDENT_VERIFICATION_REQUIRED`, 401, anything else) — #655. Imports nothing, so a client bundle that needs the period switch does not take `decimal.js` with it (importing these from `./catalogue` cost the web pricing page 35 KiB) |
| `./choice` | `canChoose(held, planId, period?)` — whether a card may be chosen. Imports nothing at runtime |
| `./payment` | `planPaymentRefusalOf` (`SUBSCRIPTION_PAYMENT_NOT_DUE` by `reason`, `STUDENT_VERIFICATION_REQUIRED` for a student plan whose approval lapsed, `PAYMENT_UNAVAILABLE`) and `planPaymentReturnOf` (paid, waiting, unconfirmed or failed on the way back from the provider, decided by the subscription and not the address, #451). Imports nothing, so the web pricing page can use it without `decimal.js` |
| `./student` | `StudentVerification`, `readStudentVerification`, `maySubmit`, `qualifiesForStudentPlans`, `studentSubmissionRefusalOf` — the student check behind `Plan.studentOnly` (`/v1/me/student-verification`) |
| `./fees` | `FeeDisclosure`, `readFeeDisclosure`, `FeeAudience`, and `disclosureStateOf` — unconfigured, unavailable or configured, so a failed read never says "nothing is deducted" (#145) |

Import by subpath only. There is no root entry, so a web bundle pulls in exactly the module it
names.

Nothing here fetches: the web's reads (`apps/web/src/lib/plans/api.ts`,
`apps/web/src/lib/fees/server.ts`) and the app's queries (`apps/mobile/src/features/plans/api.ts`)
stay with each client, and the words stay in `@ideanest/messages`. Amounts and rates are strings
throughout; formatting them is each client's job.
