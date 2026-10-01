# `apps/api` — IdeyaNest API

Java 21, Spring Boot 4.1, Gradle. The backend for the web, mobile, and admin
clients. The full specification is in [`docs/architecture.md`](../../docs/architecture.md).

---

## Running it

```bash
cd apps/api

./gradlew bootRun        # start on http://localhost:8080
./gradlew build          # compile, run tests, produce the jar
./gradlew test           # tests only
./gradlew exportOpenApi  # rewrite openapi.json from the running application
```

There is no wrapper to install and no Gradle to install: `./gradlew` downloads
the distribution it is pinned to and verifies its checksum before running it.
A JDK 21 or newer must be on the path; the build compiles against a Java 21
toolchain regardless of which JDK launches it.

**Docker is required.** `bootRun` starts the services in `compose.yaml` and stops
them again on exit, and the tests start their own PostgreSQL container. Running
the stack by hand instead:

```bash
docker compose up -d      # from apps/api
docker compose down       # add -v to discard the data
```

The stack is PostgreSQL and **Mailpit**, which accepts every message and
delivers none. Anything the platform emails locally is at
<http://localhost:8025> rather than in somebody's real inbox — including a
campaign the finaliser closed, which is the quickest way to see a real
notification end to end.

**Payout cards register on a local sandbox (#243, temporary).** With no
provider keys there is nothing to register a business card with, so the `local`
profile defaults `PAYMENT_PROVIDER` to `SANDBOX`. "Register a business card" on
`/settings/payout` opens a plain page served by this service: give a holder name
and register or decline, and a real webhook settles it, so the destination, its
standing and the console's verification all run as they will with Epoint. **It
moves no money** — charges, refunds and payouts refuse as if no provider were
configured — and it refuses to start outside the `local` and `test` profiles.
Set `PAYMENT_PROVIDER=EPOINT` with its keys to use Epoint instead. It is removed
once Epoint is configured.

---

## The creator's financial summary

`docs/architecture.md` §4.7's CD-16 and issue #99.
`GET /v1/projects/{projectId}/finance`, guarded by
`ProjectCapability.VIEW_FINANCES` — the same capability the backer report takes,
and for the same reason: this is money.

It lives in the payout module because everything it reports is already decided
there. `PayoutService` prices a campaign against §5.2's schedule, takes the fees
off the gross and the refunds off what is left, and stores all six figures on
the row; `CampaignFinanceService` answers the same question one step earlier
and, once a payout exists, answers it by reading that row rather than computing
it again. A second implementation of the same arithmetic in a dashboard module
would be a second answer to "what am I owed", and the two would disagree the
first time §5.2's rates changed.

### The ledger does not carry the fee split, and the response says so

The response publishes this campaign's ledger balances beside its figures, so
the totals can be checked rather than taken on trust. What that check reveals is
worth stating plainly rather than leaving to be discovered:

- **`platform_fee` has no writer.** A collection debits escrow and credits the
  creator for the gross; a payout does the reverse for the *net*. The difference
  stays in escrow as a balance no account claims, and the creator's account
  keeps a residual credit equal to the fees for ever. `CollectionRun` says the
  payout posts the split and `PayoutPostings` says the collection did; neither
  does. That is #69's to close.
- **`tax_payable` has no writer either**, for a better reason: §4.10's tax
  collection is #78 and is blocked on a legal answer, so there is no tax to
  post.

`reconciled` on the response is therefore a narrower claim than it sounds. It
means the campaign's entries balance, summed per currency — which V41's deferred
constraint trigger already enforces, so it can only be false for a row that
arrived past both the application and the trigger. That is precisely the day
somebody needs to see it rather than be reassured.

---

## Metrics, tracing and alerting

`docs/architecture.md` §18 and §8.4, issue #138.

### Metrics

`GET /actuator/prometheus`, in the Prometheus text format. Spring Boot's own
binders publish HTTP, JDBC, JVM and Hikari; what this repository adds is what
nothing else could know, and it is exactly the three things §8.4 asks to be
alerted on.

| Series | What it is | Bound from |
|---|---|---|
| `ideanest_ledger_reconciliation_findings` | Discrepancies the last reconciliation found | `ReconciliationStatusSource` (#70) |
| `ideanest_ledger_reconciliation_age_seconds` | Seconds since it last ran on this instance | the same |
| `ideanest_payment_collection_attempts_total{outcome}` | Collection attempts, by what came of them | `CollectionMetrics` |
| `ideanest_provider_available{provider}` | 1 when a provider answers, 0 when the breaker is open | `ProviderStatusSource` (#316) |
| `ideanest_queue_waiting{queue}` / `ideanest_queue_dead{queue}` | Every queue on the platform | `QueueDepthSource` (#316) |

`PlatformMetrics` reads the same interfaces §4.11's health screen reads, on
purpose: a dashboard that disagreed with an alert is a dashboard somebody checks
after being paged and then distrusts. It is also what keeps that class in
`shared` — it names three interfaces and no module.

**A rate is not published; the counts are.** "Collection failure rate" needs a
window, and a window is a decision about how long a bad minute has to last before
it is a bad afternoon. `alerts.yml` divides them over fifteen minutes, which is
where that decision belongs — changing it is editing a rule rather than deploying
the service. Every outcome is counted, because ten declines out of ten thousand
collections is a Tuesday and ten out of twelve is an incident.

**Nothing with a person in it.** §17.4 keeps personal data out of the log stream,
and a metric label is worse than a log line: retained longer, indexed, and shipped
to whatever scrapes it. The only labels are a queue's name, a provider's name and
an outcome.

### The endpoint is not anonymous, and does not exist without a credential

| Variable | Default | Meaning |
|---|---|---|
| `METRICS_SCRAPE_USER` | `prometheus` | What the scraper sends. Not a secret |
| `METRICS_SCRAPE_PASSWORD` | unset | The secret. **Unset means no metrics endpoint at all** |

`MetricsScrapeSecurity` is conditional on a non-blank password and puts HTTP
Basic in front of `/actuator/prometheus`. Without it the endpoint falls through
to the API's own deny-by-default chain and answers `401`.

Basic and not a bearer token, because a scraper has no account and no way to
obtain one; giving it a long-lived JWT for a service account would be inventing
an identity type to solve a scraping problem. Basic sends the credential on every
request, so it is only as private as the transport — the service is behind TLS
termination in every environment §19 describes, and `ops/observability/prometheus.example.yml`
scrapes over `https` with a `password_file` rather than an inline secret.

Metrics are not confidential the way a pledge is. They are a map: queue depths,
provider availability, JVM internals, and every URI template this service serves.
Read continuously by a stranger that is reconnaissance, and a rate-limit-free way
to measure when the platform is under strain.

### Tracing

Off unless a collector is configured. `TRACING_ENABLED=true` turns it on,
`OTLP_TRACES_ENDPOINT` says where, `TRACING_SAMPLE_RATE` how much (five per cent
by default — enough to see the shape of a slow endpoint, few enough that the
collector is not a second capacity problem).

Off by default because the exporter would otherwise post to `localhost:4318`
every few seconds and log a connection failure each time, which is a deployment
that looks broken because of a feature nobody asked for.

OpenTelemetry rather than Brave: `CorrelationFilter` already accepts and mints
W3C `traceparent`, which is OTel's native propagation format. A service that
spoke B3 on the wire and W3C in its logs would correlate with neither. Turning
tracing on adds the spans; the correlation identifier in the logs is there
either way.

### The alert rules travel with the service

`ops/observability/alerts.yml`. All three of §8.4's conditions, each with a
second rule beside it for the failure people forget:

| Alert | Catches |
|---|---|
| `LedgerImbalance` | The books do not reconcile |
| `LedgerReconciliationStopped` | Nobody has checked for 36 hours, or ever on this fleet |
| `CollectionFailureRate` | More than a quarter of collections failing over fifteen minutes |
| `NoCollectionsAttempted` | The collection job publishing nothing at all |
| `PaymentProviderUnavailable` | A breaker open for five minutes |
| `QueueBacklog` / `QueueDeadLetters` | A queue that is not draining, and work that has been abandoned |

A monitor that is silent because it is broken looks exactly like a monitor that
is silent because everything is fine, which is why every condition has both
halves. `ops/observability/prometheus.example.yml` is the scrape config to copy.

---

## Ledger reconciliation

`docs/architecture.md` §8.4's `ledger-reconciliation` and issue #70. A daily pass
that asks whether the platform's money adds up, at 02:30 UTC —
`LEDGER_RECONCILIATION_SCHEDULE` overrides it, and `-` registers the job without
scheduling it.

### Three questions, each of which the others would miss

1. **Do the books balance?** Summed per currency across every account, the
   debits must equal the credits. V41's deferred constraint trigger refuses a
   posting that does not, which is exactly why this is worth checking: it can
   only fail for a row that arrived past both the application and the trigger.
2. **Does any account hold a sign it cannot?** Escrow below zero is money
   disbursed that was never taken. A creator's account above zero is a creator
   paid more than they earned — `AccountTotal` names that one as worth an alert.
   Neither is caught by the first check, because two errors of opposite sign
   balance perfectly.
3. **Does the ledger agree with the record of what moved?** `escrow + psp_fee`
   must equal the settled charges less the payouts and the money returned. The
   left side comes from the ledger and the right from `transactions`, so this is
   the only one of the three that catches a posting the application never made.

`psp_fee` is added back to escrow because a chargeback's fee is taken from the
platform's balance rather than from a backer's card: it is the one movement with
a ledger posting and no transaction row, and adding it back puts both sides in
the same terms.

### A finding carries its parts as well as its sentence

`ReconciliationFinding.detail` is the log line — English prose with the account and the
figures in it — and it is what the `ERROR` above prints. Beside it the finding carries
`code`, `account`, `amount` and `otherAmount`, because `/admin/reconciliation` renders these
to a person in one of four languages and cannot translate prose (#403). The console builds
its own sentence from the parts; the log keeps its own.

`code` is finer than `kind` and has to be: two of the four codes are `IMPOSSIBLE_SIGN` and
read in opposite directions — a creator paid more than they earned, and platform money
disbursed that was never taken — so a reader given only the kind is given the severity and
not the meaning.

### It reports and never repairs

Nothing writes to the ledger. A correcting entry depends on which of a dozen
things went wrong, and a job that guessed would turn a detectable problem into
an undetectable one. A finding is an `ERROR` line per discrepancy, which is one
of §8.4's three alerting conditions, plus the last report held in memory — so
that a reconciliation which has silently stopped running is visible too. A check
that has not run since Tuesday is a finding of its own.

**A discrepancy is not a failed job.** Throwing is how a `ScheduledJob` reports
that it could not run: the runner counts the attempt, backs off and eventually
stops scheduling it. A pass that ran perfectly and found something has not
failed, and treating it as a failure would make the platform stop looking.

### There is no comparison against a provider's settlement report

Because there is no provider. §9.3's choice is #60 and carries
`status: needs-decision`; `PaymentProviders` discovers no implementation, and
hosted card tokenisation (#55) is blocked behind the same decision. A settlement
comparison written now would be a parser for a file format nobody has agreed to,
checked against a fixture this repository invented — which is worse than an
absence, because it would look like coverage.

Check three is the shape that comparison will take, against the one counterparty
that exists today: the platform's own record of every transaction it believes
settled. When a provider is chosen, its report becomes a fourth source on the
same right-hand side and the arithmetic does not change.

### Somebody can now read it, which is #106

Until then the answer to "do the platform's books balance?" was reachable in
exactly two places: a log line at 02:30 and a Prometheus gauge. Neither is where
the person who has to act on it works, and that is what kept "build financial
operations tooling" open with the payout queue, refunds and chargebacks all
built — AD-05 had every financial operation except the one that checks the sum
of them.

| Call | What it does |
|---|---|
| `GET /v1/admin/reconciliation` | The last pass **this replica** made |
| `POST /v1/admin/reconciliation/runs` | One now, and answers what it found |

Both need `VIEW_FINANCE` and neither needs more. A pass is two aggregate queries
that write nothing, so the worst a caller can do with the second is spend them —
and gating it behind an approval authority would mean the person who noticed a
discrepancy needs somebody else before they can confirm it. Running one **is**
audited even so, as `ledger.reconciled`: it is what somebody does when they
suspect the books are wrong, and "who last checked, and when" is the question
asked afterwards. Reading the held report is not audited, because it is a count
and a timestamp with nobody's name in it.

**The second call exists because of what the first cannot promise.** The report
lives in the process that made it, deliberately — see above — so a console
request lands on one replica and a fleet redeployed this morning answers "never
run" until tonight. `hasRun` is on the response for that reason and the console
leads with it: `balanced: true, findings: []` is also what a check that stopped
running produces, and a screen that collapsed the two would report a platform
nobody has looked at as one whose books are fine.

---

## Display currency (#327)

§21.2's "display currency, shown as an approximation, converted from central bank
rates cached hourly, with the rate used stored on the pledge for audit". All four
halves of that sentence are built.

**NOTHING HERE DECIDES WHAT ANYBODY IS CHARGED.** Collection happens in the
campaign's currency, which is manat under phase 1 and stays manat whatever a
reader chooses. What this produces is the "≈ $29.41" beside "₼50.00".

| Piece | Where |
|---|---|
| The source | `CentralBankRates` — `cbar.az/currencies/{dd.MM.yyyy}.xml`, public, no key |
| The table | `exchange_rates` (V59). One row per publication per currency, kept rather than overwritten |
| The refresh | `exchange-rate-refresh`, hourly. Eleven of the twelve daily passes write nothing |
| The conversion | `ExchangeRates#approximate` |
| The preference | `users.currency`, `PATCH /v1/me/currency` |
| The audit | `pledges.display_currency` and `pledges.display_rate` (V60), stamped at confirmation |
| The public read | `GET /v1/exchange-rates` |

### Off by default, and that default is not merely conservative

`IDEANEST_FX_ENABLED` is `false`. Turning it on means this service makes an
outbound HTTP call to a third party on a timer, and a deployment that has not
decided to do that must not start doing it because it upgraded. A disabled
deployment still **registers** the job — so `/admin/health` lists it — and the
pass returns without a request.

### The date in the document is believed and the date in the request is not

Asking cbar.az for a Sunday returns a document whose own `Date` attribute is the
preceding Friday: it serves the last published day rather than refusing. A client
that assumed the requested date would write three identical rows over a weekend,
each claiming to be that day's official rate, and the Sunday row would be a claim
the central bank never made.

### Nominals are normalised once, at the edge

The rouble is quoted per **hundred**: `<Nominal>100</Nominal><Value>2.0484</Value>`.
The adapter divides before anything is stored, so every row in the table is per one
unit. Carrying the nominal instead would push that division into every reader, and
the reader that forgot it would be out by a factor of a hundred.

### It degrades to absence, never to a guess

A source that cannot be reached, a currency with no published rate, a rate older
than `ideanest.fx.max-age`, and a deployment with the feature off all produce the
same answer: **no approximation, and no rate on the pledge**. There is no fallback
rate anywhere in the module and there must never be one — a figure computed from a
stale rate is worse than no figure, because a backer acts on it.

The age is measured on the **publication date** and not on the fetch. A source
answering every hour with last month's rates has a fresh fetch and a stale rate,
and it is the rate a reader is shown.

### The parser refuses a doctype outright

This is the only XML in the service and it comes from outside it. The factory sets
`FEATURE_SECURE_PROCESSING`, disables external general and parameter entities, and
disallows doctype declarations entirely — which closes XXE and entity expansion by
removing the class rather than mitigating it. A rates document has no DTD, so
refusing every one costs nothing.

### The rate is not money and is not rounded like it

`numeric(20,10)`. `MoneyRounding`'s two places would turn the lira's `0.0354` into
`0.04` — a thirteen per cent error in every figure computed from it. Only the
converted **amount** is rounded, once, at the end, to the target currency's own
minor unit, by the same `HALF_EVEN` §21.2 declares for everything else.

`Money` is never asked to cross a currency: it refuses with
`CurrencyMismatchException` and that refusal is correct. The division happens on a
plain `BigDecimal` and a `Money` is constructed from the result, so two amounts in
different currencies never meet. `Approximation` carries the exact amount beside
the approximate one, so nothing downstream can put the wrong one on a receipt.

### The rate on a pledge is resolved by the service, not sent by the client

The obvious design is for the checkout to send back the rate it drew — it is the
thing that drew it. It is also the design in which the one number nobody can check
is supplied by the party with an interest in it. The server reads the same hourly
cache the display read, so the two agree except across an hour boundary; across
one, the server's answer is the one that can be reconciled against
`exchange_rates`.

---

## Fraud signals

§17.2's "velocity, geography mismatch, new-account risk" — issue #108.

Every confirmed pledge is scored. The score is written whatever it is, because
"was this flagged at the time" is the question asked after a chargeback and "we
did not write it down because it looked fine" is not an answer.

| Signal | What it catches | Weight |
|---|---|---|
| Pledge velocity, per account | Card testing: a stolen card tried against small pledges in quick succession | 30 |
| Pledge velocity, per source address | The same pattern spread over ten accounts, which is invisible per account | 30 |
| Unfamiliar address | A pledge from an address this account has never signed in from. §4.10 already thinks that is worth telling somebody about | 20 |
| Geography mismatch | §17.2's, and **unavailable on every deployment** — see below | 20 |
| New account | Not evidence on its own. Everybody's account is new once | 10 |

Weights add and the total is clamped to 100. Addition rather than multiplication
because the first question about a flagged pledge is *which signal fired*, and
with addition the answer is the findings list.

### It advises. It does not decide.

Nothing refuses a pledge, holds money, or suspends an account. Blocking on an
automated score needs a false-positive rate somebody has measured, an appeal path
for whoever it gets wrong, and a policy for a campaign whose funding our
arithmetic suppressed. The first is unmeasurable until [#60](https://github.com/ismetcahangirov/ideanest/issues/60) chooses a provider.

Advisory is genuinely useful here rather than merely safe: §9.5 does not charge a
confirmed pledge until the campaign reaches its goal at its deadline, so the gap
between "flagged" and "money moves" is days.

### A signal can be unavailable, and that is not a zero

Geography needs an IP-to-country database. No vendor is chosen and none ships
with the service, so `UnresolvedAddressGeography` — named for what it is —
resolves nothing and the finding records `UNAVAILABLE`.

A signal that quietly scored zero would be indistinguishable from one that looked
and found nothing. `signals_unavailable` sits beside the score for exactly that
reason: **a low score with two unavailable signals is telling the truth about
what it knows.**

A real implementation is a `@Component` implementing `AddressGeography`;
`RiskScorer` already carries the comparison.

## Identity verification

§22.1's anti-money-laundering row and §5.4's R6 — issue #105. **Document capture,
restricted access, and a retention limit.**

### The threshold is not here, deliberately

§22.1 lists "identity verification thresholds for creators" among the questions
requiring a specific legal answer, and [#71](https://github.com/ismetcahangirov/ideanest/issues/71) carries `status: needs-decision`. So
a creator can be asked for a document and a decision can be recorded, and
**nothing on the platform is gated on the outcome**: a campaign launches, a pledge
is taken and a payout is calculated exactly as before.

`ideanest.verification.required` is off and must stay off until somebody may
decide otherwise. A threshold invented here would be a compliance position this
repository made up, and it is the one a regulator would read back to us.

### Restricted access

- A creator reaches their own verification and nobody else's. There is no
  endpoint that takes a verification identifier from a creator
- **Only platform staff open a document, and every opening writes an audit row**
  against the *creator* — `identity.document_read`. "Who has looked at my
  passport" is unanswerable otherwise
- Nothing lists documents across people. The repository has no such query, so a
  screen that wanted one could not be written by accident
- Documents are served `Content-Disposition: attachment` and never `inline`. The
  media type comes from the magic bytes (§17.3), and a stored file served inline
  on the console's own origin is one upload away from a script running there

### The retention limit

A decision destroys the documents behind it in the same transaction — a reviewer
who has finished looking has no further need of the photograph, and "just in
case" is how seven days becomes a year.

`identity-document-retention` is the **backstop**, not the ordinary path. It
covers the submission nobody ever decides, which is what turns a review queue
into an archive of passports, and it measures the age on the document rather than
on its verification so that it does not depend on the state machine being right.

### Where the bytes are

AES-256-GCM in `identity_documents`, under a key the application holds — the same
envelope and the same argument as V36's shipping addresses. There is no object
storage on this platform (§13.1), and the alternative was building it for this
feature; a bounded number of small, short-lived blobs in Postgres is a table that
stays small by construction.

**There is no default key.** An unconfigured deployment starts normally, serves
every other endpoint, and refuses a submission with **503** — not 500, because a
creator told there was a server error tries again for ever and one told the
service is not taking documents asks somebody.

## Cache invalidation

`docs/architecture.md` §4.13 and issue #127. The web client caches its public
reads for a minute; this is how it is told which campaign stopped being true
before the minute is up. `az.ideanest.shared.cache` is the whole of it.

| Variable | Default | Meaning |
|---|---|---|
| `CACHE_REVALIDATE_URL` | unset | The web client's endpoint, e.g. `https://ideanest.az/api/cache/revalidate` |
| `CACHE_REVALIDATE_SECRET` | unset | The shared secret, sent as a bearer token. The same value the web client reads from `IDEANEST_REVALIDATE_SECRET` |

**A deployment that sets neither does nothing, and is correct.** Every cached
read on the far side already carries its own window, so invalidation shortens a
staleness that was always bounded — it does not create correctness that would
otherwise be missing. The service says which state it is in once at start-up and
then stops mentioning it.

Both halves are required together: an endpoint with no secret is a call the far
side answers `401` to, every time, in a log line per event.

### It is a hint, and everything about it follows from that

`CacheInvalidationListener` hangs off the outbox relay, which means it runs
inside the relay's dispatch transaction. `OutboxDispatcher`'s contract is
explicit about what an exception there costs: the row stays pending and the whole
event is delivered again, including the notification fan-out that already
succeeded. Failing a real delivery to retry a cache hint is the wrong way round.

So `CacheInvalidator` never throws, never makes the call on the relay's thread —
which Spring shares with every other scheduled job — and drops rather than queues
when the web client is unreachable. A hint that is lost costs a page that is
stale for up to a minute and then correct on its own.

### Which events, and the one distinction that matters

Money arriving (`pledge.confirmed`, `pledge.collected`), the team speaking
(`project.update_published`), the audience speaking (`comment.posted`), and the
campaign's own state changing.

`project.approved` is deliberately absent — approval is not publication, and a
page that does not exist yet has no cache entry to drop. So are `pledge.edited`
and the payment failures, which arrive in bursts and would each evict a campaign
page for a change of a few manat in a figure rounded to the nearest whole one on
screen.

**The discovery feed is invalidated by membership and never by ordering.** A
launch and the two ways a campaign ends change what is *in* the feed; a pledge
changes only where a campaign sits in it, and evicting every feed page for that
is a cache that is empty at any interesting traffic level.

---

## Email

`NotificationChannel.EMAIL` has a transport since #86 (§12.3). The parts worth
knowing before changing anything:

- **It is SMTP.** `email_deliveries` records `accepted_at`, never
  `delivered_at`: a relay reports that it took the message and nothing about
  what happened next. Bounces, spam filing and opens need a provider webhook,
  and there is no provider.
- **One layout, twenty-two types.** `EmailComposer` builds an `EmailContent` in
  an exhaustive `switch` over `NotificationType`, so **adding a type fails to
  compile** until somebody decides what its email says. The words live in
  `src/main/resources/messages.properties`; the two layouts live in
  `src/main/resources/email/`.
- **Look at a template without sending it**:
  `GET /v1/admin/email-templates/{type}/preview` answers `text/html`, and
  `?format=text` answers the plain-text part — which is the one nothing else
  renders and therefore the one worth checking. `POST …/test-send` sends it to
  your own address and takes no recipient, deliberately.
- **The colours in `email/layout.html` are hex literals**, which CLAUDE.md §2
  forbids in source and which no mail client would resolve any other way.
  `EmailLayoutTests` asserts every one of them is a value
  `packages/design-tokens` publishes, so a token change that is not mirrored
  here fails the build.

---

## The published contract

`openapi.json` beside this file is the OpenAPI 3.1 document §10.1 says the public
API is described by. It is **generated from the controllers, committed, and
asserted current** — `OpenApiContractTests` fails when it stops describing the
service, and `packages/api-client` is generated from it in turn.

```bash
./gradlew exportOpenApi   # rewrite it, then read the diff before committing
```

A task rather than something `build` does, deliberately: a contract regenerated
by the build is a contract whose changes are invisible in review, which is the
same failure as accepting a visual snapshot without reading what changed. Every
line of that diff is something a client depends on.

The document is served at `GET /v3/api-docs` and is `permitAll`, because that is
what "published" means — a document behind a token is a document a build cannot
fetch. It describes endpoints rather than exposing them: every path in it is
still governed by `SecurityConfiguration`. Swagger UI is not on the classpath;
the `-api` starter carries no assets, and a browsable rendering belongs wherever
the documentation is hosted rather than inside the service that holds the payment
endpoints.

Three types are documented by hand because reflection describes the Java and not
the JSON — `Money`, `Patched<T>`, and `/v1/discover`'s filter vocabulary. See
`ContractSchemas` and `DiscoveryQueryDocumentation`, each of which says what it
would otherwise have got wrong.

---

## Database

PostgreSQL 16. Local credentials are in `compose.yaml` and `application-local.yml`
and are deliberately weak — nothing in either file is a secret, and neither is
read by a deployed environment. Deployed environments supply `DB_URL`,
`DB_USERNAME`, and `DB_PASSWORD`, and the service refuses to start without them
rather than falling back to something plausible.

### Migrations

Flyway, in `src/main/resources/db/migration`, applied at start-up in every
environment. Hibernate's `ddl-auto` is `validate` and will never be anything
else: Flyway owns the schema, and Hibernate's job is to refuse to start when the
mapping and the schema disagree.

| Rule | Enforced by |
|---|---|
| `V<version>__<snake_case_description>.sql` | `MigrationConventionTests` |
| One version number used once | `MigrationConventionTests` |
| Every migration carries a `-- Reverse:` block | `MigrationConventionTests` |
| A `DROP` or `TRUNCATE` carries a `-- Contract:` block | `MigrationConventionTests` |
| Applied checksums match the files | `DatabaseMigrationTests` |

**Why the reverse is a comment.** Flyway's community edition has no `undo`. The
reverse therefore has to be written down and reviewed alongside the forward
change; writing it during an incident, against a schema nobody can see, is how
a bad hour becomes a bad week. Where a change genuinely cannot be reversed —
data has been destroyed — the block says so and says why.

**Expand, then contract.** Under a rolling deployment two versions of the code
serve traffic at once. A migration that drops a column the previous version
still selects breaks live requests. So the release that stops using something
and the release that removes it are different releases, and the removal says
which release preceded it.

### Tests

Integration tests run against a real PostgreSQL through Testcontainers. There is
no in-memory substitute here on purpose: H2 does not reproduce PostgreSQL
locking, constraints, or `numeric` semantics, which is precisely the behaviour
a funding platform depends on.

Extend `AbstractIntegrationTest` for anything needing the database. Sharing one
annotation set lets Spring cache a single context, so one container serves the
whole suite instead of one per class. A test of a pure function should not
extend it.

**Google and Apple are never called from a test.** `OidcProviderStub` runs
WireMock in the test JVM, serves a JWKS, and signs ID tokens with a key pair it
generates — which is the only way to produce the cases that matter: a wrong
audience, an expired token, a token signed by a key the provider does not
publish. It is wired in from `AbstractIntegrationTest` rather than from the test
class that uses it, because a class with a property source of its own gets a
context of its own and a second PostgreSQL container with it.

Integration tests run under the `test` profile, which mirrors deployed
configuration rather than the developer's — a health endpoint that hides detail
in production and shows it locally has to be asserted against the production
shape or the assertion proves nothing.

#### The campaign-close load test (#141)

`CollectionLoadTests` closes a six-hundred-backer campaign and drains it from
eight threads at once, which is what two replicas do to one queue. It runs on
every build; it is a load test rather than a benchmark, and the difference is
what it asserts.

**What it asserts exactly** are the properties whose absence is expensive:
one charge per pledge and one `transactions` row per pledge — the failure that
charges somebody twice — no pledge left in either queue, distinct idempotency
keys, the ledger equal to a `BigDecimal` sum rather than a double, §9.6's next
slot at +24 hours on every refused card, and §5.1's frozen outcome unchanged by
a collection that failed.

**What it measures and does not turn into an SLO** is throughput. §20.4 asks for
10,000 collections in ten minutes — 16.7 a second sustained — and that figure has
two owners. Ours is everything between "a pledge is due" and "the money is
recorded, posted and announced"; the provider's is latency, rate limiting and
retry semantics, and #60 has not chosen one. So the test runs against a provider
that answers instantly and asserts only that **our** half clears §20.4's floor —
below which no provider could make the target reachable — and logs the measured
rate, which is around 240 a second on a developer machine.

§9.6 puts 5–15% of a campaign's cards on the failure path, and a stub that always
approves never exercises the retry schedule. The decline is therefore a rule —
one pledge in ten, by a function of its identifier — rather than a queued script,
because the threads claim pledges in an order nobody controls and a script would
make the outcome depend on it.

---

## Health

| Path | Purpose |
|---|---|
| `/actuator/health` | Aggregate status |
| `/actuator/health/liveness` | The process is alive; restart it if this fails |
| `/actuator/health/readiness` | The process can serve traffic; remove it from the load balancer if this fails |

The two probes are separate on purpose. An instance that is alive but not ready
— still warming a connection pool, say — should be taken out of rotation, not
killed and restarted, which would make a slow start-up into a restart loop.

Nothing else is exposed. `/actuator/env` and `/actuator/configprops` print
configuration, and configuration contains secrets. An endpoint is opened when
something needs it and there is an access control story for it, not by default.

Health responses carry a status and no component breakdown. Naming our
dependencies to an unauthenticated caller tells an attacker what to attack.

---

## Layout

Packages are organised **by feature, not by layer**. Everything about pledging
lives under `pledge`; there is no `repository` package holding every repository
in the service.

```
az.ideanest
├── auth              registration, sign-in, tokens, sessions, two-factor
├── user              accounts, profiles, deletion and export
├── project           campaigns and their state machine
├── reward            reward tiers, items, stock
├── pledge            pledge creation, editing, cancellation, checkout
├── payment           charges, refunds, chargebacks, provider adapters
├── ledger            the double-entry record
├── payout            what a creator is owed, approval, sending
├── discovery         browsing, filtering, search, ranking, curation
├── pledgemanager     surveys, addresses, upgrades, shipping, tax
├── community         updates, comments, backer signals, bulk messages
├── realtime          §12.1's live counters: no tables, decides nothing
├── notification      email, push, in-app, preferences
├── media             uploads, validation, transcoding state
├── moderation        reports, review queues, suspension
├── analytics         campaign metric aggregation
├── risk              §17.2's fraud signals: velocity, account age, address familiarity
├── verification      §22.1's identity documents: capture, restricted access, retention
├── admin             internal operations tooling
└── shared            money, outbox, idempotency, audit
```

Within a module:

| Layer | Holds |
|---|---|
| `domain` | Entities, value objects, and rules that hold regardless of the caller |
| `application` | Services and use cases. The transaction boundary |
| `infrastructure` | Repositories, clients, adapters |
| `api` | Controllers and the request and response types they bind |

**A module reaches another module through its `application` layer only.**
Reaching into another module's `domain` or `infrastructure` couples the two to
each other's internals, which is exactly what the boundary exists to prevent —
and what would make extracting a module into its own service expensive later.
`shared` is the exception: it is cross-cutting by definition, which is also why
nothing belonging to one feature may be put there.

`ModuleBoundaryTests` enforces all of it — the boundary, the rule that `domain`
knows nothing of `infrastructure` or `api`, and the absence of cycles between
modules. A rule that lives only in a comment survives until the first afternoon
somebody is in a hurry.

**Where a question crosses that boundary, it crosses as a port in `shared`.**
Three so far, each one interface, each implemented by the module that owns the
rows, and each named in `ModuleBoundaryTests` so the route is checked rather than
merely available:

| Port | The question | Answered by |
|---|---|---|
| `shared.access.ProjectAuthorisation` | May this account do this on this campaign? (#236) | `project` |
| `shared.audience.ProjectAudiences` | Who are these people on this campaign? (#245) | `pledge` |
| `shared.project.ProjectSummaries` | What is this campaign called, and where does it live? (#249) | `project` |

The alternative each replaced was a method per question on the owning module's
service — a published surface that grows without bound — or reaching into another
module's tables, which is the coupling the boundary exists to prevent.

An entity in one module therefore refers to another module's aggregate by its
identifier, not by a JPA association: `Session` holds a `userId`, not a `User`.
The foreign key still exists in the database, because referential integrity is
the database's job and not a convention.

Most modules are still an empty package and a description. That is deliberate:
the package exists so that code lands where the architecture says it belongs,
rather than wherever the first commit happened to put it.

---

## Authentication

| Endpoint | Effect |
|---|---|
| `POST /v1/auth/register` | Creates an unverified account and sends a verification link. Always `202` |
| `POST /v1/auth/verify-email` | Redeems the link. `204` once, `400` thereafter |
| `POST /v1/auth/login` | Starts a session. Returns an access token; the refresh token goes in a cookie, or in the body if the client asks |
| `POST /v1/auth/oauth/{provider}` | Signs in with a Google or Apple ID token. Same session, same tokens, same cookie as `/login` |
| `POST /v1/auth/refresh` | Rotates the refresh token and returns a new access token |
| `POST /v1/auth/logout` | Revokes the session. `204` even with no token |
| `POST /v1/auth/forgot-password` | Asks for a reset link. Always `202`, account or no account |
| `POST /v1/auth/reset-password` | Spends the link and sets the password. `204`. Revokes every session |
| `POST /v1/auth/change-password` | Replaces the password. Costs the current one. `204`. Revokes every session, the caller's included |
| `POST /v1/auth/change-email` | Asks to move the account to another address. Costs the current password. `202` — the address has **not** moved |
| `POST /v1/auth/confirm-email-change` | Spends the link sent to the new address and moves the account. `204`. Unauthenticated |
| `POST /v1/auth/2fa/enable` | Starts a TOTP enrolment. Costs the password. Does **not** switch two-factor on |
| `POST /v1/auth/2fa/confirm` | A current code switches it on and returns the recovery codes, once |
| `POST /v1/auth/2fa/verify` | The second half of a sign-in: a challenge and a code, for tokens |
| `POST /v1/auth/2fa/disable` | Switches it off. Costs the password **and** a code |
| `GET /v1/auth/sessions` | The user's live devices, with the current one marked |
| `DELETE /v1/auth/sessions/{id}` | Revokes one device. `404` if it is not theirs |
| `GET /v1/me` | The signed-in account. The first endpoint behind a bearer token |
| `GET /v1/me/export` | A JSON copy of everything held about the account. Rate limited |
| `POST /v1/me/deletion` | Closes the account after a 30-day delay. Requires the password |
| `DELETE /v1/me/deletion` | Withdraws a pending deletion. `204` either way |

Everything else is denied by default. Forgetting to state who may call a new
endpoint produces a `401` in a test rather than an open door in production.

**Registration does not say whether an address is already registered.** An
endpoint that answers "that email is taken" is an account enumeration oracle:
feed it a breach list and it returns the subset of those people who are backers
here. Both paths return the same status and the same body; what differs is the
message the address receives, and that goes to its owner rather than to whoever
typed it. The cost is that the sign-up form cannot say "you already have an
account" — the email says it instead.

**A password reset says nothing about the address either (#271).**
`POST /v1/auth/forgot-password` answers `202` whether or not the account exists,
for the same reason. One thing differs from registration and it is deliberate:
an address with **no** account receives nothing at all. Registration writes to an
already-registered address because its owner deserves to know somebody is probing
it; the reset form takes whatever was typed into it, and mailing that would make
this service a delivery mechanism for strangers.

The link is single-use, lasts an hour rather than a verification link's
twenty-four, and asking again retires the previous one. The password policy is
checked **before** the link is spent, so a rejected password leaves the link
usable — burning it on the way to a `400` is the reset flow's most common
self-inflicted support ticket. An account that has only ever signed in through a
provider has no `user_credentials` row, and a reset creates one: that is the
documented way back for somebody who has lost the provider account, and the proof
required is control of the mailbox, which is what would recover the provider
account anyway.

**An address change does not move the address (#277).** `V44__create_email_change_requests.sql`
carries the argument: writing `users.email` immediately and clearing the verified
flag fails on a single typo, because sign-in is by address and so is the reset
that would fix it. The request is held in `email_change_requests` and the address
moves in one statement when the link is spent. **Both addresses are written to** —
the new one gets the link, the old one gets a notice with no link at all, which is
how somebody losing their account finds out at an address they still hold.

**A password change revokes every session; an address change revokes none.** A
password is changed precisely when somebody believes the old one is known, and
leaving the sessions it issued alive makes the change ceremonial — including the
session that asked, because "every session except this one" is a rule the client
would have to be trusted to have picked correctly. An address change alters no
credential, so the same password still opens the same sessions. Both cost the
current password, because a stolen access token is fifteen minutes of somebody
else's session and neither of these is what it should be able to make permanent.

**Passwords** must be 12–256 characters and may not contain the address they
protect. There are no composition rules: they reliably produce `Password1!` and
a note on a monitor, and NIST dropped them for that reason. Hashing is Argon2id
at OWASP's parameters, configurable under `ideanest.auth.argon2` — raising them
later rehashes on next sign-in rather than locking anyone out, because Argon2's
encoded output carries the parameters it was made with.

**Tokens** — verification links today, refresh tokens next — are 256 bits from
`SecureRandom`, stored only as SHA-256, and spent by a conditional update so
that two simultaneous redemptions cannot both succeed. The hash is unsalted with
no work factor, which would be indefensible for a password and is correct here:
there is no dictionary against 256 random bits, and the hash is computed on
every refresh.

**Verification email is sent.** `SmtpVerificationNotifier` composes the six auth
messages — verification, the notice to an address somebody tried to register
twice, password reset, the password-change notice, and both halves of an address
change — and hands each to `TransactionalMailer`, which renders it through #86's
layouts and sends it from the same envelope as every notification. Locally the
relay is the Mailpit container in `compose.yaml`; its inbox is at
<http://localhost:8025>. The link is also written to the log under the `local`
profile, and nowhere else.

A relay that refuses is logged and not retried. These messages are sent from an
`AFTER_COMMIT` listener, so by then the account exists and throwing would turn a
successful registration into a 500; what closes the window is #135's outbox.

**Rate limiting is in-process**, which is correct for one instance and wrong for
two — each replica enforces the limit separately. The shared counter is #142.

### Signing in with Google and Apple

The client gets an ID token from the provider and posts it. Nothing else in the
request says who the person is — no subject, no address, no "email verified".
Those are read out of the token, and only after it has been verified:

- **signature** against the provider's JWKS, from configuration, never from the
  token's own `jku` header
- **RS256**, pinned. A decoder that reads the algorithm out of the token accepts
  `alg: none`, and accepts an HMAC token signed with the RSA public key
- **`iss`**, **`aud`**, **`exp`**. `aud` is the one that matters most: Google
  signs valid tokens for every developer who asks, and the client identifier is
  what makes one ours
- **age**, from `iat`, capped at five minutes. Google's tokens live an hour; one
  produced by the sign-in happening now is seconds old
- **`nonce`**, which must match what the client bound its authorisation request
  to. Apple's native flow hashes it before it reaches the token, so what the
  client sends us is whatever it sent the provider — we compare, we do not
  interpret

**The account is the `(provider, subject)` pair, never the address.** Both
providers let a person change their email, and matching on it means whoever
holds that address next inherits the account.

**Linking to an existing account requires both sides to have proven the
address.** A verified provider address matching a *verified* account links
automatically. A verified provider address matching an *unverified* account is
refused with a 409 — anyone can register an address they do not own and choose
the password, so linking would hand them an account that has since become
somebody else's. An *unverified* provider address creates nothing and links to
nothing, and is refused with the ordinary message.

A user created this way has no password: `user_credentials` simply has no row.

**Configuration** is `ideanest.auth.oauth.providers.*`. Issuers and key set
addresses are checked in — they are facts about Google and Apple. Client
identifiers come from the environment, and a provider without them is not
enabled here: its endpoint answers `501`, rather than the service refusing to
start over a feature nobody has called. A provider configured *in part* —
identifiers with no issuer — does stop start-up, because that is a mistake and
its other failure mode is a 401 nobody can explain.

**What is not done yet.** The nonce is the client's, so it binds a token to a
request without proving freshness; server-issued nonces need storage shared
across replicas (#134). There is no endpoint to link or unlink a provider from
account settings (#25 follow-up), so the only linking is the automatic one
above. Apple's client secret — a signed ES256 JWT rather than a static string —
is not needed for ID token verification and is not implemented; it becomes
necessary for token revocation on account deletion (#28).

### Tokens

| | Access token | Refresh token |
|---|---|---|
| Form | JWT, RS256 | Opaque, 256 bits |
| Lifetime | 15 minutes | 30 days, absolute |
| Stored | Nowhere | As SHA-256, in `refresh_tokens` |
| Sent as | `Authorization: Bearer` | httpOnly cookie, or the body for native clients |

RS256 rather than a shared secret: with HMAC, everything that can verify a token
can also mint one, so the first service that needs to check a token has to be
given the ability to impersonate anybody.

The access token carries `amr`: `["pwd"]`, or `["pwd", "otp", "mfa"]` when the
session proved a second factor. A refresh carries it across unchanged — a
refresh proves possession of a token, not a factor, so it must neither add the
claim nor lose it.

**A session is the refresh token family, and rotation is enforced.** Every
refresh spends the presented token and issues a new one. A spent token should
never appear again, so when one does, two parties hold the same credential and
there is no way to tell which is the user — the whole session is revoked with
`TOKEN_REUSE`. Revoking only the presented token would leave whoever holds the
newest one signed in, and that might be the thief.

The claim is atomic: `UPDATE ... WHERE used_at IS NULL`. Two refreshes arriving
together cannot both succeed, and the loser is treated as reuse.

> **Clients must refresh single-flight.** Two concurrent refreshes with the same
> token look exactly like theft and will sign the user out. Concurrent requests
> wait on one in-flight refresh; they do not each start their own.

**Revoking a session does not reach an access token already issued.** Nothing is
looked up when one is verified — that is what stateless means, and it is why the
lifetime is fifteen minutes. `TokenApiTests` asserts this rather than leaving it
to be discovered.

**Signing keys** come from `ideanest.auth.token.private-key-pem` and
`public-key-pem`. Outside `local` and `test` the service refuses to start
without them; generating one would sign tokens with a key that differs per
replica and changes on every restart, signing people out at random in a way
nobody could diagnose.

---

## Two-factor authentication

Time-based one-time passwords, RFC 6238: HMAC-SHA1, six digits, thirty-second
steps. Written out in `auth.domain.Totp` rather than taken from
`dev.samstevens.totp` — that library's last commit is from November 2020 with no
release since 1.7.1, and an unmaintained dependency on the authentication path
buys us nothing that forty lines of `javax.crypto` does not. `TotpTests` checks
it against the RFC's own test vectors, which is the assertion that matters: if
our arithmetic disagrees with an authenticator app, every enrolment is a
lockout.

**One step of skew either side.** Phone clocks drift and people start typing at
the end of a window. The cost is that three codes are valid at any moment, so a
guess is three in a million — which is only a small number because of the rate
limit, and that is why the limit is not optional.

**Enrolling is not enabling.** `2fa/enable` generates a secret and returns it
once, as base32 and as an `otpauth://` URI the client renders as a QR code.
Two-factor is off until `2fa/confirm` accepts a current code. A user whose phone
dies between the two calls signs in exactly as before.

**A password alone stops producing a session.** With two-factor on, `login`
returns `{"twoFactorRequired": true, "challenge": …}` and nothing usable. The
challenge is 256 bits, stored as SHA-256, single use, five minutes, and retired
when a new one is issued — so collecting challenges does not buy more guesses.
It carries the device description from the first call, so the session the second
call creates describes the device that actually signed in.

**A code cannot be replayed.** The accepted time step is recorded and only a
strictly greater one is taken afterwards, so a code works once rather than for
the ninety seconds the skew window spans. The code that confirms an enrolment is
spent the same way.

**Recovery codes** are ten values of a hundred bits, shown once at confirmation
and stored as SHA-256 — unsalted and with no work factor, for the same reason a
refresh token is. Argon2 would be wrong twice over here: there is no dictionary
against a hundred random bits, and the codes are checked on an endpoint an
attacker can reach with a stolen challenge, which would let them spend 19 MiB of
our memory per guess.

**Switching it off costs the password and a code**, or the password and a
recovery code for somebody whose phone is the reason they are asking. Either
half alone would make the whole control worth one password.

**Rate limits.** Five code attempts per challenge; ten enrolment changes per user
per fifteen minutes; `2fa/verify` also counts against the per-address sign-in
allowance, because it is half of a sign-in.

### Requiring it for a payout

Two things are exposed, and neither is enforcement:

| Where | What |
|---|---|
| `sessions.two_factor_at` | When this session proved a second factor, or null |
| `amr` in the access token | `["pwd"]`, or `["pwd", "otp", "mfa"]` |
| `auth.application.TwoFactorPolicy` | `isEnabledFor(userId)`, `isProvedBy(sessionId)` — the front door for another module |

The question a payout must ask is `isProvedBy`, not `isEnabledFor`: an account
can switch two-factor on and still hold sessions that predate it, and a token
minted from one of those proves only a password. **Nothing calls this yet** —
payouts arrive with [#69](https://github.com/ismetcahangirov/ideanest/issues/69),
and that is where the check belongs.

**The TOTP secret is not encrypted at rest.** It cannot be hashed — verifying a
code means recomputing the HMAC — so the control that belongs here is encryption
with a managed key, and there is no key management in the platform yet. Until
there is, the secret is protected exactly as well as the database is, which is
worth knowing before treating two-factor as a defence against a database
compromise.
## Account deletion and export

The full policy, field by field, is in [`docs/architecture.md`](../../docs/architecture.md)
§17.4. What matters when reading the code:

**Deletion needs the password, not just the token.** An access token is fifteen
minutes of trust that a script or a proxy log can leak; a deletion that needed
only that is a vandalism tool. `POST /v1/me/deletion` verifies the password,
which also makes it a password oracle — hence the per-account rate limit.

**The grace period is thirty days, and the account stays usable in exactly three
ways:** sign in, read itself, export itself, cancel. `deleted_at` is *not* set
when the deletion is requested, because every finder excludes soft-deleted rows
and the account has to remain findable to be recovered. The restriction is
enforced in `SecurityConfiguration`: the access token carries a
`deletion_pending` claim, a closing account is not granted `ACCOUNT_ACTIVE`, and
`anyRequest()` requires it. Stated as an authority the account *has* rather than
a flag it lacks, so that a missing claim denies rather than allows.

Sessions are revoked when deletion is requested and stay revoked after a
cancellation. The user has just proved they can sign in; the other devices have
not.

**After the grace period the account is anonymised, not deleted.** The row
survives with its identifier and its foreign keys intact, because "pledge #123
was made by user X" has to stay true after X leaves. The email, name, slug,
avatar, and biography are overwritten; the password credential and every
verification token are deleted; the sessions keep their timings and lose their
IP addresses and user agents.

**The address is released by anonymisation** and not before. Holding it in
reserve permanently would mean retaining the address — or a hash of it, which
for an enumerable space is the same thing — in order to prove we no longer have
it.

**The job is `@Scheduled`, hourly, and belongs on the durable scheduler**
(#134). It is safe on more than one instance: the row is locked before the
decision, so one caller does the work and the rest find it done. Each account is
its own transaction, so a failure stalls one account rather than the batch. Under
the `test` profile the cron is `-`, and the tests call
`AccountAnonymisationJob.anonymiseDueAccounts(Instant)` with the moment they
want to test instead of waiting thirty days.

**The export contains no credentials.** Not the password hash, not the hash of
any refresh or verification token. An export is a copy of what we know about
somebody, not a copy of their keys, and a password hash is the one field here
worth cracking because people reuse passwords. The rest of the security history
*is* included, because it is the part that answers "was somebody else in my
account".

`AccountSecurity` is an interface in `user` implemented in `auth`. Closing an
account needs a password check, session revocation, and credential destruction,
all of which live in `auth` — but `auth` already depends on `user`, so a call the
other way would be a cycle. The dependency is inverted instead.

---

## Build conventions

| Convention | Reason |
|---|---|
| Java toolchain 21, declared in the build | The same bytecode from any developer machine and from CI |
| `-Xlint:all -Werror` | A warning nobody is forced to read is a warning nobody reads |
| Gradle wrapper pinned with a SHA-256 | Without the checksum the build runs whatever that URL serves |
| `gradlew` committed with LF and the executable bit | CI runs it on Linux; a CRLF shebang fails with an error that does not say why |

---

## What is not here yet

| Missing | Tracked by |
|---|---|
| Encryption at rest for the TOTP secret, and the key management it needs | no issue yet |
| A payout action that actually requires two-factor | [#69](https://github.com/ismetcahangirov/ideanest/issues/69) |
| Two-factor over SMS, as a fallback (A-08) | no issue yet |
| Redis and object storage in the local stack. A mail catcher is there since #86 -- Mailpit, on 1025, with its inbox at http://localhost:8025 | [#134](https://github.com/ismetcahangirov/ideanest/issues/134), [#139](https://github.com/ismetcahangirov/ideanest/issues/139) |
| PostGIS, needed for proximity search | [#47](https://github.com/ismetcahangirov/ideanest/issues/47) |
| Money type and arithmetic rules | [#133](https://github.com/ismetcahangirov/ideanest/issues/133) |
| A postal address in §4.7's CD-11 backer export (#79). The file carries the name, the email, the tier, the amounts, the state, the destination **country** and the instant — every fact the platform holds about a backer of a running campaign. `pledges` has no street, because §4.8's PM-07 collects one after the campaign closes; a column of blanks would look like the backers declined to give one | [#75](https://github.com/ismetcahangirov/ideanest/issues/75) |
| §4.7's CD-16 financial summary. Gross, fees, tax and net cannot be stated: there is no `ledger_entries`, no `transactions`, and no processing fee to subtract until a provider is chosen. A "net payout" computed from the 5% platform fee alone would be a number a creator would plan around and would be wrong by the processing fee | [#99](https://github.com/ismetcahangirov/ideanest/issues/99), [#62](https://github.com/ismetcahangirov/ideanest/issues/62), [#60](https://github.com/ismetcahangirov/ideanest/issues/60) |
| Job queue and scheduler | [#134](https://github.com/ismetcahangirov/ideanest/issues/134) |
| A comparison of the fraud score against a real chargeback rate, and therefore any decision made on it. `RiskAssessments` **advises and never blocks**: a false-positive rate nobody has measured is not one a platform should refuse pledges on, and the rate is unmeasurable until a provider is chosen. The score is written for every confirmed pledge and read by staff | [#60](https://github.com/ismetcahangirov/ideanest/issues/60) |
| An IP-to-country source, and with it §17.2's geography-mismatch signal. `UnresolvedAddressGeography` is named for what it is and reports the signal **unavailable** on every assessment rather than clearing it — a low score with an unavailable signal is a different statement from a low score without one | no issue yet |
| Any gate on identity verification. #105 built the capture, the restricted access and the retention limit; **who has to verify** is §22.1's legal question and `ideanest.verification.required` is off | [#71](https://github.com/ismetcahangirov/ideanest/issues/71) |
| Object storage for identity documents. They are AES-256-GCM ciphertext in `identity_documents`, which is affordable because they are small, few per creator, and destroyed within days — see V58. When §13.1's ingestion lands they move | [#139](https://github.com/ismetcahangirov/ideanest/issues/139) |
| A Redis relay behind §12.1's socket (#91). A broadcast reaches the sessions the receiving process holds, so on N replicas a reader is told about roughly one event in N. That is a degraded live counter rather than a wrong page -- the server-rendered numbers are correct and refresh on navigation, and nothing on the platform reads state from that module. The follow-up is one class: a publish to Redis instead of a loop, and a subscriber that calls the loop | [#139](https://github.com/ismetcahangirov/ideanest/issues/139) |
| §12.1's authenticated channels. `user:{id}` carries a person's own notifications and `project:{id}:dashboard` a creator's live metrics; the socket takes no credential, so `RealtimeChannel` has no constant for either -- a value in a published vocabulary is one a caller writes code against | no issue yet |
| A fan-out chunked across several transactions. Every computed audience is bounded at `ideanest.audience.max-recipients`, and exceeding it logs at `ERROR` naming the campaign and the count. Raising the number is not the fix; chunking is | no issue yet |
| The reply half of §4.9's C-12. #98 sends a creator's message to a segment and it renders as §4.10's "direct message"; there is no conversation a backer can answer in | no issue yet |
| Verification links, collaborator invitations, and launch reminders as **email**. Each still reaches its own port and a logging adapter rather than the notification queue, so #86's transport does not carry them -- they are not `NotificationType` rows | no issue yet |
| Bounce handling, a suppression list, and open tracking. All three need a provider webhook, and §16 chose an SMTP relay | no issue yet |
| Existing announcements moved onto the outbox. The table, the relay, and the guarantee are built (#135), and nothing routes through them yet: `AuthEvents`, `ProjectEvents`, and `LaunchReminderDelivery` still publish from after-commit listeners, so a crash between the commit and the send still loses the message | no issue yet |
| Structured logging with redaction | [#137](https://github.com/ismetcahangirov/ideanest/issues/137) |
| Metrics, tracing, alerting | [#138](https://github.com/ismetcahangirov/ideanest/issues/138) |
