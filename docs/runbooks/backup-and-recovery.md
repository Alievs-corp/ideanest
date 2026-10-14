# Runbook — backup and disaster recovery

**You are reading this because something is wrong with the database.** Start at
[§4, Which failure is this](#4-which-failure-is-this). Everything above it is
context you can read afterwards.

This runbook is written for somebody who did not write it, at 03:00, who has
never performed this restore before. Every command is exact. Where a decision is
required, the runbook says who makes it and what the options cost.

| | |
|---|---|
| Owner | Platform / on-call |
| Scope | PostgreSQL 16 primary (§14.4). Not object storage, not Redis, not the search index — those are rebuildable and are covered in §11 |
| Scripts | `ops/backup/` |
| Rehearsal | Quarterly, `.github/workflows/restore-drill.yml`. See [§12](#12-the-drill) |
| Related | `docs/architecture.md` §7 (schema), §9 (payments), §17.4 (data protection), §19.4 (objectives) |

---

## 1. Objectives

### 1.1 The numbers

| Data class | Tables | RPO — tolerated data loss | RTO — time to serve again |
|---|---|---|---|
| **Money and evidence** | `transactions`, `ledger_entries`, `audit_logs`, `outbox_events` | **0 acknowledged commits** | 1 hour |
| **Everything else transactional** | `pledges`, `projects`, `users`, `reward_tiers`, … | **5 minutes** | 1 hour |
| **Derived** | search index, `project_analytics_daily`, Redis, denormalised counters | 24 hours — rebuilt from the primary, never restored | 4 hours |

§19.4 states the platform-wide numbers — recovery point 5 minutes, recovery time
1 hour. This table refines the first of them, because "5 minutes" is the wrong
answer for two of the tables above.

### 1.2 Why the ledger and the audit log get zero

§1 of the specification: *"Every movement of money must be auditable. An
immutable ledger, always. No balance is ever computed — it is read from the
ledger."*

That sentence removes the usual escape route. On a platform that computes
balances, a lost row is a wrong number that the next recomputation corrects.
Here the ledger **is** the balance, so a lost `ledger_entries` row is a balance
that is wrong for ever, and §18.3 classifies any ledger imbalance as a **P0**.

Nothing outside the database can reconstruct it. The payment provider's
settlement report knows what it collected from a card; it does not know the
platform fee, the processing fee, the tax split or the creator the money was
held for — §9.5's whole distribution exists only in our rows. Five minutes of
lost ledger entries at a campaign close is a five-minute hole in the money that
no reconciliation can fill.

`audit_logs` is the same argument in a different currency. V21 makes the table
append-only in the database precisely so that history cannot be edited; a
recovery point that discards the last five minutes of it edits history by
another route, and an audit trail with a five-minute hole around an incident is
an audit trail that is missing exactly the rows anybody will want.

`outbox_events` is included for a narrower reason: §8.3's guarantee is that a
commit and its event cannot diverge. They diverge if the event is lost and the
business change is not.

### 1.3 How zero is reached, and what is true today

**Continuous archiving alone cannot deliver RPO 0.** `archive_command` runs when
a 16 MB segment fills or `archive_timeout` elapses, so the exposure is
everything committed since the last completed segment. With
`archive_timeout = 60s` that is bounded at about a minute, which satisfies the
five-minute line for ordinary data and does not satisfy zero.

Zero requires the archive to be part of the commit. The mechanism is a
synchronous WAL receiver:

```sh
# On the archive host, as the archive user. Streams the write-ahead log as it is
# written rather than a segment at a time, and reports flushes back to the
# primary as a standby does.
pg_receivewal \
  --directory=/var/lib/ideanest/spool \
  --slot=ideanest_archive --create-slot --if-not-exists \
  --synchronous \
  --compress=none
```

```conf
# On the primary.
synchronous_standby_names = 'ideanest_archive'
synchronous_commit = on
```

A commit is then not acknowledged to the application until its write-ahead log
record is fsynced into the archive stream. Losing the primary at that instant
loses nothing that any client was told had happened.

> **Not deployed. This is the one gap in this document that matters.**
> The platform has no deployed environment yet — §19.1's four environments are a
> plan, and there is no Terraform in this repository. What is built and
> rehearsed here is the `archive_command` path, which gives an RPO of roughly
> one minute. The receiver above is configuration for the day the primary is
> provisioned, and until then **the money classes are held to the same one
> minute as everything else, and this table is a target rather than a
> measurement.** Saying otherwise would be the failure this runbook exists to
> prevent.
>
> The replication slot in that command is not decoration: without it the primary
> may recycle a segment the receiver has not taken, which is the same data loss
> arriving by a slower route. With it, a receiver that stays down will eventually
> fill the primary's disk — so `pg_replication_slots.safe_wal_size` needs an
> alert beside §18.3's others.

### 1.4 Why one hour to recover

An hour is not comfort; it is the largest number the product's own deadlines
allow.

- §18.3 pages at **P0** when the finaliser has not run for five minutes. §8.4
  runs `campaign-finalizer` every minute, and §5.1 decides success **at the
  deadline** from confirmed pledges. A campaign whose deadline passes during an
  outage is finalised late, and every backer of it is told late.
- §9.6 gives failed collections four attempts across seven days on a fixed
  schedule. Hours of that window spent unavailable are hours of retries not
  attempted against cards that expire.
- §4's discovery and pledge surfaces are the business. An hour of downtime on a
  campaign's final day is measurable money.

The hour is spent as follows, and the drill measures the third line:

| Phase | Budget | Owned by |
|---|---|---|
| Detect | 5 min | Alerting (§18.3) |
| Decide (see [§5](#5-who-decides)) | 10 min | Incident lead |
| Restore and replay | 25 min | This runbook |
| Verify and cut over | 20 min | `ops/backup/verify-restore.sh`, then the incident lead |

> **What the drill's measured restore time does and does not tell you.** The
> rehearsal recovers a schema-only database in seconds. That number measures the
> *procedure* — that the archive is readable, the keys work, the replay reaches
> the target — and it does not extrapolate to production, where the time is
> dominated by downloading and decrypting the base backup and by the volume of
> write-ahead log since it. The 25-minute line above is a budget, and it is only
> a measurement once the drill runs against a staging snapshot of production
> size. That is named in [§13](#13-what-is-not-done) as not done.

---

## 2. The mechanism

```
    primary (PostgreSQL 16)
      |
      |  archive_command = ops/backup/archive-wal.sh %p %f
      |     encrypts each completed segment to the archive's public key
      v
    archive/wal/000000010000000000000004.age        <- continuous
    archive/base/base-20260818T031500Z/             <- daily
        base.tar.age
        meta
        SHA256SUMS
```

| | |
|---|---|
| **Base backup** | Daily, `ops/backup/base-backup.sh`. `pg_basebackup --format=tar --wal-method=none`, streamed straight through encryption so the plaintext never touches the backup host's disk |
| **Write-ahead log** | Continuous, `ops/backup/archive-wal.sh` as `archive_command`, with `archive_timeout = 60s` so an idle cluster still bounds its exposure |
| **Encryption** | `age`, public-key. The primary holds **only the recipient's public key**, so a compromised database host can add to the archive and cannot read it. `gpg` is supported for a deployment that already has a key hierarchy |
| **Where it lives** | An object store in a **different region** from the primary (§17.4: "encrypted, cross-region"), with object lock for the retention period so that a credential leak cannot delete history |
| **Credentials on the primary** | Append-only. The primary can `PUT` and cannot `GET`, `DELETE` or overwrite. Ransomware that owns the database host cannot destroy the way back |
| **Retention** | 35 days. See [§10](#10-data-protection-and-what-must-happen-after-a-restore) — this is a data-protection number, not a storage one |
| **Integrity** | `SHA256SUMS` over the archived objects, checked before extraction; `pg_verifybackup` against the manifest after extraction; `pg_amcheck --heapallindexed` over the recovered cluster |

`--wal-method=none` is deliberate. Including the write-ahead log in the base
backup would make a backup restorable on its own, and would therefore hide a
broken `archive_command` until the day the archive was the only thing left.

### 2.1 Configuration the primary needs

```conf
wal_level = replica
archive_mode = on
archive_command = '/opt/ideanest/archive-wal.sh %p %f'
archive_timeout = 60
```

```sh
# In the primary's environment — the postmaster's, because archive_command is
# its child. Never in this repository.
IDEANEST_BACKUP_ARCHIVE_DIR=/var/lib/ideanest/archive
IDEANEST_BACKUP_ENCRYPTION=age
IDEANEST_BACKUP_AGE_RECIPIENT=age1...        # public key only
```

---

## 3. Before you touch anything

1. **Declare the incident** and take the incident-lead role, or find who has it.
2. **Do not restart the primary "to see".** A crash-recovering PostgreSQL is
   doing something useful; a second restart in the middle of it is not.
3. **Take a copy of the evidence first** if the cluster is up at all:
   ```sh
   psql -c "SELECT pg_current_wal_lsn(), pg_is_in_recovery(), now()"
   psql -c "SELECT * FROM pg_stat_archiver"
   ```
   `pg_stat_archiver.last_archived_wal` and `failed_count` decide, in one line,
   whether the archive is complete up to the failure. Write them into the
   incident record before doing anything that changes them.
4. **Stop the workers before the API.** §8.4's jobs write. `campaign-refunds` and
   `hosted-charge-sweep` in particular move or settle money, and a job that runs
   against a database you are about to rewind is a refund or a payment that exists
   at the provider and not in the ledger.

---

## 4. Which failure is this?

Work down the table. The first row that matches is the one.

| Symptom | This is | Go to |
|---|---|---|
| The host is gone, the volume is gone, or the managed instance is deleted | Total loss | [§6](#6-procedure-a--total-loss-of-the-primary) |
| PostgreSQL will not start; the log says `invalid page`, `could not read block`, checksum failure | Corruption | [§6](#6-procedure-a--total-loss-of-the-primary), targeting the last known-good instant |
| PostgreSQL is fine; the **data** is wrong — a migration dropped a column, a script deleted rows, a bug wrote nonsense | Logical damage | [§7](#7-procedure-b--point-in-time-recovery-from-a-mistake) |
| `ledger_imbalance_detected_total > 0` (§18.3, P0) | Possibly logical damage, possibly a bug | [§8](#8-procedure-c--a-ledger-that-does-not-balance) |
| The primary is up but slow, or connections are exhausted | **Not this runbook.** Capacity, §19.5 | — |
| The primary is fine and a replica is broken | **Not this runbook.** Rebuild the replica | — |
| `pg_stat_archiver.failed_count` is climbing and `pg_wal` is filling | The archive is broken, the database is not | [§9](#9-procedure-d--the-archive-is-failing) |

**Tell the two apart before choosing.** A restore is the wrong answer to a
logical problem that a single `UPDATE` would fix, and the right answer to
corruption that a restart appears to have cured. The question that separates
them: *does the database contain rows nobody wrote?* If yes, it is logical
damage and the target time is just before the bad write. If it contains rows it
cannot read, it is corruption and the target is the last instant before the
corruption was written.

---

## 5. Who decides

| Decision | Who | Notes |
|---|---|---|
| Declare the incident | Whoever is paged | Do not wait for permission |
| Restore into a **new** cluster | On-call, alone | Always safe. Costs money and nothing else. **Start this while the rest is being decided** |
| Point the application at the recovered cluster (failover) | **Incident lead**, and not the person performing the restore | This is the irreversible step: from here, writes to the old primary are lost |
| Choose a recovery target that discards committed data | **Incident lead plus one engineer**, both named in the incident record | It is §17.2's dual approval applied to the same kind of harm |
| Resume `campaign-refunds` and `hosted-charge-sweep` after a rewind | **Incident lead**, after [§10.3](#103-payments-after-a-rewind) reconciliation | Never automatic |
| Tell backers and creators | Incident lead, with whoever owns communications | [§11](#11-communication) |

The split in row three exists because the person who has just spent forty
minutes on a restore is the worst-placed person on the call to judge whether it
is good enough. Two people, and the second one reads the verification output.

---

## 6. Procedure A — total loss of the primary

**Goal:** a promoted cluster holding everything the archive contains.

```sh
# 0. Everything below runs on the recovery host, as the postgres user.
export IDEANEST_BACKUP_ARCHIVE_DIR=/var/lib/ideanest/archive
export IDEANEST_BACKUP_ENCRYPTION=age

# 1. Fetch the archive identity. It is the only secret in this procedure, it is
#    in the secret store, and fetching it is an audited action. It never lands
#    on a laptop and never lands on the primary.
umask 077
<your secret-store client> read ideanest/backup/age-identity > /run/ideanest/age-identity.txt
export IDEANEST_BACKUP_AGE_IDENTITY_FILE=/run/ideanest/age-identity.txt

# 2. Choose the base backup. The newest one whose `started_at` is before the
#    incident. `meta` in each directory says when it was taken.
ls -1 "$IDEANEST_BACKUP_ARCHIVE_DIR/base"
cat "$IDEANEST_BACKUP_ARCHIVE_DIR/base/base-20260818T031500Z/meta"

# 3. Restore and replay everything the archive has. No --target-time: this is a
#    hardware failure, and the answer is "as far forward as possible".
ops/backup/restore.sh \
  --backup "$IDEANEST_BACKUP_ARCHIVE_DIR/base/base-20260818T031500Z" \
  --pgdata /var/lib/postgresql/recovered \
  --port 5433
```

`restore.sh` verifies the checksums, extracts, runs `pg_verifybackup`, writes the
recovery configuration, starts the server and waits until it has left recovery.
It forces `archive_mode = off` in the recovered copy — **do not undo that** until
the recovered cluster is the primary and has its own archive location.

Then verify, before anybody points anything at it:

```sh
# Read from the repository rather than typed, so the expectation cannot be
# stale. Run these from a checkout of the release that was deployed.
MIGRATIONS=apps/api/src/main/resources/db/migration
EXPECT_MIGRATIONS=$(find "$MIGRATIONS" -name 'V*__*.sql' | wc -l)
EXPECT_VERSION=$(find "$MIGRATIONS" -name 'V*__*.sql' \
                 | sed 's|.*/V\([0-9][0-9]*\)__.*|\1|' | sort -n | tail -1)

ops/backup/verify-restore.sh \
  --host /tmp --port 5433 --dbname ideanest \
  --expect-version "$EXPECT_VERSION" --expect-migrations "$EXPECT_MIGRATIONS" \
  --report /tmp/restore-verification.txt
```

Read the output. `RESTORE VERIFICATION PASSED` and a zero exit status are the
only acceptable result. Attach `/tmp/restore-verification.txt` to the incident.

Then go to [§10.2](#102-after-any-restore).

---

## 7. Procedure B — point-in-time recovery from a mistake

**Goal:** the database as it was one instant before the damage.

The difference from §6 is one argument, and one hard question: **what time?**

### 7.1 Finding the target time

Everything below is read from the *damaged* cluster, which is still running.
None of it modifies anything.

```sh
# The audit log is the first place to look: every privileged action is there
# with the instant it happened (§7.2, V21).
psql -c "SELECT occurred_at, actor_type, actor_id, action, entity_type, entity_id, outcome
         FROM audit_logs ORDER BY occurred_at DESC LIMIT 50"

# A migration that did the damage:
psql -c "SELECT version, description, installed_on, success
         FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 10"

# A campaign's own history, when the damage is to one project:
psql -c "SELECT * FROM project_state_transitions
         WHERE project_id = '...' ORDER BY created_at DESC LIMIT 20"
```

**Take the instant immediately *before* the first bad write, not after it.**
Recovery is inclusive of the target (`recovery_target_inclusive = on`), so a
target equal to the bad transaction's commit time keeps it.

Write the chosen target into the incident record with the evidence for it,
before running anything. This is the number the second approver in
[§5](#5-who-decides) is approving.

### 7.2 Recover

```sh
ops/backup/restore.sh \
  --backup "$IDEANEST_BACKUP_ARCHIVE_DIR/base/base-20260818T031500Z" \
  --pgdata /var/lib/postgresql/recovered \
  --port 5433 \
  --target-time '2026-08-18 12:59:11.689486+00'
```

The base backup must be **older** than the target. If the newest one is not, use
the previous one; replay takes longer and is otherwise identical.

> **`FATAL: recovery ended before configured recovery target was reached`.**
> The target is *later* than the last commit the archive contains, and
> PostgreSQL refuses to promote rather than pretending it stopped where it was
> asked to. Two causes, and they need opposite responses: either the archive is
> incomplete — go to [§9](#9-procedure-d--the-archive-is-failing), because
> segments are missing and this is now a second incident — or the target is
> simply after the last write, in which case drop `--target-time` and replay
> everything. Do not move the target later to make the message go away; it is
> already later than everything there is.

### 7.3 Verify, with the witnesses that make it meaningful

```sh
ops/backup/verify-restore.sh \
  --host /tmp --port 5433 --dbname ideanest \
  --expect-version "$EXPECT_VERSION" --expect-migrations "$EXPECT_MIGRATIONS" \
  --target-time '2026-08-18 12:59:11.689486+00' \
  --report /tmp/restore-verification.txt
```

Then, by hand, the two questions the script cannot know the answers to:

```sh
# The damage is gone.
psql -h /tmp -p 5433 -d ideanest -c "<the query that showed the damage>"

# Something that existed before the target is still here.
psql -h /tmp -p 5433 -d ideanest -c "SELECT count(*) FROM pledges WHERE created_at < '<target>'"
```

### 7.4 The cost of a rewind, stated plainly

Everything committed between the target and the failure is gone. Before the
incident lead approves the cut-over, they must be able to say what that is:

```sh
-- On the damaged cluster, before it is discarded.
SELECT count(*) FROM pledges     WHERE created_at   > '<target>';
SELECT count(*) FROM audit_logs  WHERE occurred_at  > '<target>';
SELECT count(*) FROM users       WHERE created_at   > '<target>';
```

Those numbers belong in the incident record and in the communication in
[§11](#11-communication). "We lost some data" is not a message anybody can act
on; "41 pledges made between 12:59 and 13:40 were lost and their backers have
been emailed" is.

**Keep the damaged cluster.** Do not delete it, do not reuse the volume. It is
the only copy of the rows the rewind discarded, and recovering some of them by
hand afterwards is often possible.

---

## 8. Procedure C — a ledger that does not balance

`ledger_imbalance_detected_total > 0` is a **P0** (§18.3) and it is not
automatically a restore.

1. **Freeze money.** Stop `campaign-refunds`, `hosted-charge-sweep` and
   `payout-scheduler`. Nothing that moves money runs while the ledger is
   suspect.
2. **Identify the offending transactions:**
   ```sh
   psql -v tbl=ledger_entries -f ops/backup/sql/ledger-imbalance.sql
   ```
3. **Decide which of the two it is.** A ledger that has never balanced for a
   given transaction is a **code** defect — a restore reproduces it, because the
   bad rows were written correctly by wrong code. A ledger that balanced
   yesterday and does not today, with no deployment in between, is data damage.
4. Code defect → this runbook ends here; it is a P0 bug fix and a manual
   correcting entry (§7.2: `transactions` is insert-only, corrections are new
   rows).
5. Data damage → [§7](#7-procedure-b--point-in-time-recovery-from-a-mistake),
   with the target immediately before the first imbalanced entry's `created_at`.

---

## 9. Procedure D — the archive is failing

The database is healthy. The recovery point is not, and `pg_wal` is growing.

```sh
psql -c "SELECT * FROM pg_stat_archiver"
journalctl -u postgresql | grep 'archive command failed'
```

`archive-wal.sh` prints the reason on the postmaster's stderr, and it fails
rather than lying — every message begins `archive-wal:`.

| Message | Cause | Fix |
|---|---|---|
| `already exists in the archive with a different size` | Two clusters archiving to one prefix, usually a recovered copy whose `archive_mode` was turned back on | Stop the second writer. **Do not delete the existing object** — it is the real one |
| `age is not installed on the database host` | Image or package drift | Restore the package; the segments are still in `pg_wal` and archive on their own once it works |
| `IDEANEST_BACKUP_AGE_RECIPIENT is not set` | Environment lost across a restart | Restore the variable and reload |
| `cannot create <dir>` / no space | The archive volume is full | Extend it. Then run `ops/backup/prune-archive.sh` — dry run first, `--apply` second |
| `refusing an implausible segment name` | Not something PostgreSQL produced | Escalate; do not loosen the check |

The pressure is real: PostgreSQL keeps every unarchived segment, so a broken
archiver ends as a full disk and a stopped primary. If the disk is close and the
cause is not fixable in minutes, the escape is to set `archive_command` to a
plain local copy into scratch space and move the segments into the archive
afterwards. **Turning `archive_mode` off is not an escape.** It silently ends
the recovery point.

---

## 10. Data protection, and what must happen after a restore

### 10.1 The obligations on the archive itself

| | |
|---|---|
| **What is in it** | Everything: email addresses, shipping addresses (encrypted at rest by the application, §17.4), payment metadata, provider references, the whole audit log. Treat any archive object as the most sensitive data the platform holds |
| **Encryption** | `age`, public key. The private identity exists only in the secret store. The primary cannot decrypt what it wrote |
| **Access control** | Read access to the archive bucket and to the identity are separate grants, both restricted to the on-call role, both audited on use. The primary's credential is append-only. A production restore needs two people ([§5](#5-who-decides)) |
| **Retention** | **35 days**, `ops/backup/prune-archive.sh`, with the newest two base backups always kept whatever their age |
| **Deletion obligation** | See below |

**Why 35 days and not 90.** §17.4 gives a closing account a 30-day grace period
and then anonymises it. Anonymisation reaches the live database and cannot reach
a backup. So the archive's retention is the period during which a deleted
person's data still exists somewhere: 30 days of grace plus a 5-day margin for a
backup taken on the last day of it. The commitment the platform can therefore
make is **at most 65 days from the deletion request to the last copy expiring**,
and that number belongs in the privacy notice.

Keeping backups longer would mean holding personal data past the point the
platform can justify. Keeping them shorter would put the oldest restorable
instant inside the window in which a bad migration might not yet have been
noticed. §17.4's separate requirement that *financial records* be retained for
the statutory period is a property of the **live database**, not of the archive
— retaining backups for years is not how that is met, and §22.1 records that the
period itself is still an unanswered legal question.

### 10.2 After any restore

Run these in order. Every one of them is a way a restored database differs from
the one that was lost.

1. **Re-run the deletion sweep.** Accounts whose grace period elapsed between
   the target and now were anonymised in the lost database and are *not*
   anonymised in this one. §8.4's `account-anonymiser` runs hourly and will
   catch up on its own — confirm that it has, and confirm no account that
   requested deletion is readable:
   ```sh
   # The anonymiser's own predicate, from V5's partial index.
   psql -c "SELECT count(*) FROM users
            WHERE anonymised_at IS NULL
              AND deletion_scheduled_at IS NOT NULL
              AND deletion_scheduled_at < now()"
   # Must reach 0 within the hour. If it does not, the anonymiser is not running
   # and this is a data-protection incident of its own.
   ```
2. **Expect redelivery from the outbox.** Rows that were `PUBLISHED` before the
   failure may be `PENDING` again. §8.3 makes delivery at-least-once by design
   and every consumer deduplicates on the event `id`, so this is safe — but
   somebody watching the notification volume should know why it spiked.
3. **Idempotency keys are rewound.** §17.2 retains them 24 hours. A client
   retrying a payment mutation whose key is no longer in the table will have the
   work **executed again rather than replayed**. This is the reason
   `campaign-refunds` and `hosted-charge-sweep` stay stopped until §10.3 is done.
4. **Scheduled job leases are stale.** `scheduled_jobs` rows may hold leases
   belonging to a process that no longer exists. They expire on their own within
   `ideanest.jobs.lock-lease` (one minute). Do nothing.
5. **Rebuild what is derived**, in this order: search index (§11.2's full
   reindex), `project_analytics_daily`, then let `denormalization-sync` correct
   the cached counters.
6. **Record the audit gap.** If the restore discarded time, `audit_logs` has a
   hole. Note its exact bounds in the incident record — that record is now the
   only evidence for that window.

### 10.3 Payments after a rewind

**This is the part that costs real money if it is skipped.**

A rewind moves the database back in time. The payment provider does not move
with it. Any charge, refund or payout sent between the target and the failure
**happened**, and the restored database does not know:

1. Keep `campaign-refunds`, `hosted-charge-sweep` and `payout-scheduler` stopped.
2. Pull the provider's transaction list for the window
   `[target, incident]` — §9.3 R-08 requires idempotency and every request
   carries a key (§9.4), so the provider can be asked what it did.
3. For each provider transaction with no matching row in `transactions`, insert
   the transaction and its balancing `ledger_entries` by hand. `transactions` is
   insert-only (§7.2); corrections are new rows, never updates.
4. Run the imbalance query until it is empty:
   ```sh
   psql -v tbl=ledger_entries -f ops/backup/sql/ledger-imbalance.sql
   ```
5. Let §8.4's `ledger-reconciliation` run once and compare to settlement.
6. Only then restart the collection jobs, and only on the incident lead's word.

Skipping step 3 means the platform believes it did not collect money it did
collect. The backer's card statement says otherwise, and the creator is short.

---

## 11. Communication

| When | Who is told | What they are told |
|---|---|---|
| Within 15 minutes | Internal incident channel | What is broken, that a restore has started, no estimate yet |
| Within 30 minutes | Status page | Plain description, no cause, next update time |
| Before any cut-over that discards data | Incident lead → whoever owns communications | The exact window discarded and the counts from [§7.4](#74-the-cost-of-a-rewind-stated-plainly) |
| At recovery | Status page | Resolved, and whether data was lost |
| Within 24 hours | Backers and creators whose rows were lost | Individually. They made a pledge and it is not there |
| Within 5 days | Written post-incident review | Includes the verification report and the drill evidence |

Say what was lost. A backer whose pledge vanished discovers it either from us or
from a campaign page that does not list them, and only one of those is
recoverable.

Never publish the recovery target, the archive location, or anything about the
key material.

---

## 12. The drill

**Cadence: quarterly** (§19.4), plus on every pull request that touches
`ops/backup/**` or a migration.

**Where the evidence is:** the `restore-drill-evidence` artifact on the *Restore
drill* workflow run, retained 400 days, plus the run's job summary. That is the
answer to "when was the last successful restore rehearsal and what did it
verify".

Run it locally exactly as CI does:

```sh
./ops/backup/drill/run-drill.sh --report evidence/drill.txt
```

It builds a cluster from this repository's migrations with Flyway, archives its
write-ahead log through `archive-wal.sh`, takes a base backup, writes rows on
both sides of a chosen instant, **destroys the source cluster**, recovers to that
instant from the archive alone, and verifies the result. It needs Docker and
nothing else.

### 12.1 What the verification actually checks

A server that starts is not a restore that worked, which is why
`verify-restore.sh` is longer than `restore.sh`:

| Check | Catches |
|---|---|
| `recovery-complete` | A cluster still following the archive, or one that would resume recovery on restart |
| `target-time-respected` | Replay that ran past the instant that was asked for |
| `schema-history` | A base backup from a different release; a partial or failed migration |
| `relations-present` | Tables missing from the restored schema, compared against the repository's own migrations |
| `audit-append-only` | V21's trigger not surviving the restore — the guarantee is asserted by attempting a `DELETE` and requiring the refusal |
| `ledger-self-test` | The imbalance detector itself being broken, which would make the next line meaningless |
| `ledger-balance` | §7.2's double-entry invariant, per transaction **and per currency** |
| `referential-integrity` | An orphan anywhere in the schema — a transaction that survived in part |
| `atomicity` | Prepared transactions, invalid indexes, unvalidated constraints, and a witness pair written by one transaction arriving as one row |
| `witness-before-present` | Replay that stopped short of the target |
| `witness-after-absent` | Replay that overshot it |
| `physical-integrity` | Corrupt heap pages and indexes, via `pg_amcheck --heapallindexed` |
| `data-checksums` | A cluster that cannot detect a corrupt page at all |

### 12.2 The negative cases

A verification nobody has watched fail is a verification nobody has tested. CI
runs two restores that **must** fail:

```sh
./ops/backup/drill/run-drill.sh --negative late-target      # replay overshoots
./ops/backup/drill/run-drill.sh --negative schema-history   # history incomplete
```

**There was a third, and #62 removed it.** `require-ledger` demanded the ledger
tables §7.2 specified and no migration created, so that the drill's one exception
was asserted rather than assumed — the verification had to *fail* when the tables
were required, and CI watched it fail. V41 creates `transactions` and
`ledger_entries`, so the case started passing, which is precisely the signal this
paragraph used to describe. The case, the `--ledger-mode` flag in
`verify-restore.sh`, and the `absent-ok` default in `run-drill.sh` came out
together with the migration.

`ledger-balance` is therefore an ordinary check now: a restored database with no
`ledger_entries` fails the verification, because the strongest check in it cannot
run and a restore of the platform's books that never looked at them is not a
verified restore.

---

## 13. What is not done

Named here rather than left to be discovered during an incident.

| Gap | Consequence | What closes it |
|---|---|---|
| **No synchronous WAL receiver** | The money classes' RPO is about one minute, not zero. [§1.3](#13-how-zero-is-reached-and-what-is-true-today) | `pg_receivewal --synchronous` in `synchronous_standby_names`, on the day a primary is provisioned |
| **No deployed environment** | Everything here is rehearsed against a container, not against infrastructure. There is no Terraform in this repository and §19.1's environments are a plan | The infrastructure epic |
| **The drill's database is schema-only** | The measured restore time proves the procedure, not the 25-minute budget | Run the quarterly drill against a staging snapshot of production size |
| **No standby, so no failover** | Recovery is restore-and-promote, and the RTO has a full restore inside it. There is no "promote the replica" path | A streaming replica, which also gives the read replica §7.3 assumes |
| **Object storage and the search index are not backed up** | Media loss is permanent; the index is rebuildable and not backed up on purpose | The media pipeline epic (§13) |
| **`prune-archive.sh` is not scheduled** | Retention is enforced by running it. Until it is scheduled, that is a manual step | A scheduled job on the archive host |
