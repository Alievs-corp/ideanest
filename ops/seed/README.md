# Local demo seed

Fills an empty local database with a platform that looks like it has been
running for a year: 26 campaigns across every lifecycle state, 3 800 pledges
from 900 backers, the money that followed them, and one account per role the
administration console recognises.

**Development only.** Nothing here should ever reach a deployed database. Every
account shares one password, the payment records name providers that were never
called, and the identifiers are derived from readable keys rather than
generated. Do not point it at anything you would mind losing.

---

## Running it

The migrations have to have run first — this seed writes rows, it does not
create tables.

```bash
# 1. Database up, and the service started once so Flyway can finish.
cd apps/api
docker compose up -d
./gradlew bootRun          # wait for "Successfully applied N migrations"

# 2. Seed.
ops/seed/run.sh
```

If a native PostgreSQL already owns port 5432 — which is common — publish the
compose database somewhere else and point the service at it:

```bash
# apps/api/, with a one-service override that replaces the published port
docker compose -f compose.yaml -f compose.local-port.yaml up -d
DB_URL=jdbc:postgresql://localhost:5433/ideanest SPRING_DOCKER_COMPOSE_ENABLED=false ./gradlew bootRun
```

`run.sh` talks to the container by default. To use a `psql` on your PATH
instead:

```bash
SEED_VIA_DOCKER=0 PGPORT=5433 ops/seed/run.sh
```

Re-running is safe. Every insert is `ON CONFLICT DO NOTHING` against a
deterministic id, so a second run adds only what a file gained since the first.

**Two tables cannot be re-seeded in place**: `transactions` and
`ledger_entries` carry append-only triggers that refuse `UPDATE`, `DELETE` and
`TRUNCATE`. Changing a value the seed writes into either one means dropping the
database and starting over.

---

## Accounts

**Password for every account, including all 900 generated backers:**

```
IdeaNest2026!
```

### Console roles

| Email | Name | Role | What it is for |
|---|---|---|---|
| `admin@ideanest.az` | Aysel Məmmədova | `SUPER_ADMIN` | Full console |
| `moderator@ideanest.az` | Rəşad Quliyev | `MODERATOR` | Moderation queue, content and profile reports |
| `curator@ideanest.az` | Nigar Həsənova | `CURATOR` | Collections, badges, open calls, placement |
| `finance@ideanest.az` | Elvin Abbasov | `FINANCE` | Payments, ledger, refunds, chargebacks, fees |
| `superadmin@ideanest.az` | Kamran Əliyev | all four | Convenience account for moving between screens |

Note that `FINANCE` deliberately does not confer payout approval — approving a
payout needs `SUPER_ADMIN`. The seeded payout waiting on its second approver
is there to make that visible.

### Creators

| Email | Name | Campaigns |
|---|---|---|
| `creator@ideanest.az` | Leyla Səfərova | Tumar, Kəlağayı, Xalça lampa, Bakı 1990, Naxış (draft) |
| `orxan@ideanest.az` | Orxan Nəbiyev | Qala, Ağ Qab, Novruz |
| `gunel@ideanest.az` | Günel Rzayeva | İpək Yolu, Şəki ustaları, Yallı, Kiçik Səhnə (submitted) |
| `tural@ideanest.az` | Tural İsmayılov | Sirdaş qəhvə, Qış Bazarı, Kənd südxanası (cancelled) |
| `sevinc@ideanest.az` | Sevinc Bayramova | Narıncı, Səyyah, Qorqud (unsuccessful) |
| `ramin@ideanest.az` | Ramin Cəfərov | Elektro tar, Kür, Səs arxivi (prelaunch) |
| `aysu@ideanest.az` | Aysu Kərimova | Divar, Gecə Bakı |
| `elnur@ideanest.az` | Elnur Şirinov | Torpaq, Şəbəkə |

### Backers and others

| Email | Name | What it is for |
|---|---|---|
| `backer@ideanest.az` | Nurlan Əhmədov | Pledges, saves, follows, a mixed notification inbox |
| `aygun@ideanest.az` | Aygün Vəliyeva | A backer with an open support ticket |
| `emin@ideanest.az` | Emin Salmanov | English locale |
| `zaur@ideanest.az` | Zaur Qasımov | Russian locale, private profile |
| `samir@ideanest.az` | Samir Bağırov | Turkish locale |
| `lale@ideanest.az`, `ferid@ideanest.az`, `nezrin@ideanest.az` | | Comment authors, reporters, ticket requesters |
| `collab@ideanest.az` | Vüsal Məmmədli | Accepted collaborator on two campaigns |
| `spam@ideanest.az` | Faked Deals | **Suspended.** Owns the suspended campaign and the deleted comments |
| `backer1@example.az` … `backer900@example.az` | generated | The crowd behind the funding figures |

---

## What is in there

**26 campaigns**, chosen so that every state in the lifecycle has at least one
row behind it — 13 `LIVE` between 15% and 171% funded, plus `SUCCESSFUL`,
`UNSUCCESSFUL`, `COLLECTING`, `LATE_PLEDGE`, `FULFILLING`, `COMPLETED`,
`DRAFT`, `PRELAUNCH`, `SUBMITTED`, `SCHEDULED`, `SUSPENDED` and `CANCELED`.

A demo where everything is `LIVE` hides exactly the screens that are hardest to
reason about, so the ended, suspended and cancelled campaigns are as deliberate
as the live ones.

- **Campaign pages**: cover image, story document, reward tiers (sold out,
  limited, early-bird expired, add-on, secret), FAQ, updates including a
  backers-only one, and a two-level comment tree with creator replies.
- **Money**: charges, a failed charge behind every `CHARGE_FAILED` pledge,
  balanced double-entry ledger postings, refunds in all three states, four
  disputes across four states, and five payouts including one waiting on a
  second approver and one the bank declined.
- **Console**: moderation queue with open and resolved reports, support tickets
  with internal notes, editorial collections including an unpublished draft and
  an open call, fee schedules with a closed validity window, feature flags at
  partial rollout, and an audit trail with a refused action in it.
- **Creator dashboards**: daily analytics rollups, referral attribution by
  channel, backer segments, campaign messages, surveys with responses,
  fulfilment records with tracking numbers.

Campaign copy is in Azerbaijani, with a few comments and tickets in English and
Russian because the platform supports four locales and a seed in one language
never exercises the other three.

---

## How it is put together

| File | What it writes |
|---|---|
| `00_helpers.sql` | Four functions the other files use. Dropped again by `09`. |
| `01_accounts.sql` | Named accounts, credentials, staff roles, social links |
| `02_projects.sql` | Twenty campaigns, state transitions, story versions |
| `02b_more_campaigns.sql` | Six more live campaigns with tiers, FAQ, updates |
| `03_rewards.sql` | Reward tiers, items, shipping rules and zones, FAQ |
| `04_backers.sql` | Nine hundred generated backer accounts |
| `05_pledges.sql` | Pledges, charges, ledger postings, fulfilments |
| `06_community.sql` | Updates, comments, saves, follows, notification inbox |
| `07_operations.sql` | Collections, tags, fees, flags, support, moderation, refunds, disputes, payouts, surveys, analytics, audit |
| `08_recompute.sql` | Campaign totals, tier stock, tag usage — all derived |
| `09_cleanup.sql` | Drops the helpers |

Three decisions worth knowing about before editing any of it:

**Identifiers are derived from readable keys.** `seed_id('project:tumar')` is
the same uuid on every machine and in every file, which is what lets the files
reference each other without a lookup table and lets the whole seed be re-run
without duplicating anything.

**Backer counts are derived from a funding percentage, not typed.**
`05_pledges.sql` states the percentage it wants for each campaign and works
backwards to a headcount through the weighted average of that campaign's own
reward tiers. Typing a headcount instead would mean re-deriving the percentage
by hand every time a tier price changed, and the two would drift apart the first
time nobody bothered.

**Aggregates are computed, never written twice.** `pledged_amount`,
`backers_count`, `claimed_quantity` and `usage_count` are all set by
`08_recompute.sql` from the rows underneath them. A pledged total typed by hand
is a number that disagrees with the backer list on the creator dashboard, and
there is no way to tell which one is wrong.

### Images

Covers, story images and avatars are hotlinked from `images.unsplash.com` and
`i.pravatar.cc`. There is no uploader and no object storage yet
(`docs/architecture.md` §13.1), and `next.config.mjs` allows any HTTPS host for
exactly that reason.

Unsplash returns an exact crop when width and height are both given, so the
dimensions stored in `cover_image_width` / `cover_image_height` are the
dimensions the browser receives — which matters, because the column is
all-or-nothing by constraint and a guessed height is what makes a card jump once
the picture arrives.

**They need a network.** Offline, every campaign card renders its layout with a
broken image.

### Passwords

`seed_password()` returns one Argon2id encoding, produced by registering a
single account through `POST /v1/auth/register` and copying the hash out. It is
a hash this service's own verifier accepts rather than one assembled by hand,
and giving every account the same one means the demo is about what each role can
see rather than about credential handling.

To change the shared password, register an account through the API, read
`user_credentials.password_hash`, and replace the literal in `00_helpers.sql`.
