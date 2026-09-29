#!/usr/bin/env bash
#
# Decide whether a restored cluster is actually correct.
#
# The reason this file is longer than the one that performs the restore: a
# server that starts is not a restore that worked. A truncated archive, a
# recovery that stopped early, a base backup from before a migration, an
# archive whose last segments were never written — every one of those produces
# a PostgreSQL that accepts connections and answers queries. §19.4 asks for a
# rehearsal that is "measured and documented", and a rehearsal that measures
# only uptime documents nothing.
#
# So this asks the questions an operator would ask if they had all night:
#
#   recovery-complete       the cluster is promoted, not still following the
#                           archive, and it is on a new timeline
#   target-time-respected   nothing committed after the recovery target is here
#   schema-history          Flyway's history is intact and at the version the
#                           repository expects
#   relations-present       every table the migrations create exists
#   audit-append-only       V21's trigger survived the restore and still refuses
#                           a DELETE. A revoked grant would not have survived,
#                           which is the argument V21 makes and this proves
#   ledger-self-test        the imbalance detector below detects an imbalance
#   ledger-balance          §7.2's invariant holds over every transaction
#   referential-integrity   no orphaned row anywhere in the schema
#   atomicity               no prepared transaction, no invalid index, no
#                           unvalidated constraint, and the witness pair written
#                           by one transaction is present or absent as a pair
#   witness-before-present  a row committed before the target is here
#   witness-after-absent    a row committed after the target is not
#   physical-integrity      pg_amcheck finds no corrupt heap page or index
#   data-checksums          the cluster can detect a corrupt page at all
#
# Exit status is 0 only when every check that ran passed. Anything else is a
# failed drill, and a failed drill is an incident in slow motion.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

HOST="${IDEANEST_BACKUP_SOCKET_DIR:-/tmp}"
PORT="${PGPORT:-5432}"
DBNAME="${PGDATABASE:-ideanest}"
EXPECT_VERSION=""
EXPECT_MIGRATIONS=""
EXPECT_RELATIONS=""
WITNESS_BEFORE=""
WITNESS_AFTER=""
ATOMIC_WITNESS=""
TARGET_TIME=""
REPORT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --host)               HOST="${2:?}"; shift 2 ;;
    --port)               PORT="${2:?}"; shift 2 ;;
    --dbname)             DBNAME="${2:?}"; shift 2 ;;
    --expect-version)     EXPECT_VERSION="${2:?}"; shift 2 ;;
    --expect-migrations)  EXPECT_MIGRATIONS="${2:?}"; shift 2 ;;
    --expect-relations)   EXPECT_RELATIONS="${2:?}"; shift 2 ;;
    --witness-before)     WITNESS_BEFORE="${2:?}"; shift 2 ;;
    --witness-after)      WITNESS_AFTER="${2:?}"; shift 2 ;;
    --atomic-witness)     ATOMIC_WITNESS="${2:?}"; shift 2 ;;
    --target-time)        TARGET_TIME="${2:?}"; shift 2 ;;
    --report)             REPORT="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

require_cmd psql

PASSED=0
FAILED=0
SKIPPED=0
WARNED=0
CURRENT=""
RESULTS=""

q() { psql -qAtX -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -d "$DBNAME" -c "$1"; }

record() { RESULTS="${RESULTS}${1}=${2}"$'\n'; }

check()      { CURRENT="$1"; printf '\n== %s\n' "$1" >&2; }
check_pass() { PASSED=$((PASSED + 1)); printf '   PASS  %s\n' "${1:-ok}" >&2; record "$CURRENT" "PASS"; }
check_fail() { FAILED=$((FAILED + 1)); printf '   FAIL  %s\n' "$1" >&2; record "$CURRENT" "FAIL"; }
check_skip() { SKIPPED=$((SKIPPED + 1)); printf '   SKIP  %s\n' "$1" >&2; record "$CURRENT" "SKIP"; }
check_warn() { WARNED=$((WARNED + 1)); printf '   WARN  %s\n' "$1" >&2; record "$CURRENT" "WARN"; }

# --------------------------------------------------------------------------

check "connectivity"
if SERVER_VERSION="$(q 'SHOW server_version' 2>&1)"; then
  check_pass "connected to $DBNAME on $HOST:$PORT, PostgreSQL $SERVER_VERSION"
else
  check_fail "cannot connect: $SERVER_VERSION"
  # Nothing below can mean anything without a connection.
  printf '\nverification aborted: the restored cluster is not reachable\n' >&2
  exit 1
fi

# --------------------------------------------------------------------------

check "recovery-complete"
IN_RECOVERY="$(q 'SELECT pg_is_in_recovery()')"
SIGNAL_PRESENT="$(q "SELECT (pg_stat_file('recovery.signal', true) IS NOT NULL)")"
TIMELINE="$(q 'SELECT timeline_id FROM pg_control_checkpoint()')"
if [ "$IN_RECOVERY" != "f" ]; then
  check_fail "the cluster is still in recovery; it was never promoted"
elif [ "$SIGNAL_PRESENT" = "t" ]; then
  check_fail "recovery.signal is still present; this cluster would resume recovery on restart"
elif [ "$TIMELINE" -lt 2 ]; then
  check_fail "the cluster is on timeline $TIMELINE; a promotion always advances it"
else
  check_pass "promoted, on timeline $TIMELINE"
fi

# --------------------------------------------------------------------------

check "target-time-respected"
if [ -z "$TARGET_TIME" ]; then
  check_skip "no --target-time; this restore replayed the whole archive"
elif [ "$(q "SELECT to_regclass('public.audit_logs') IS NULL")" = "t" ]; then
  check_skip "audit_logs is not in this schema"
else
  LATEST="$(q "SELECT coalesce(max(occurred_at)::text, '')  FROM audit_logs")"
  if [ -z "$LATEST" ]; then
    check_skip "audit_logs is empty; there is no committed instant to compare"
  elif [ "$(q "SELECT max(occurred_at) <= '$TARGET_TIME'::timestamptz FROM audit_logs")" = "t" ]; then
    check_pass "the newest audited action is $LATEST, at or before the target $TARGET_TIME"
  else
    check_fail "an audited action at $LATEST survived a recovery targeted at $TARGET_TIME"
  fi
fi

# --------------------------------------------------------------------------

check "schema-history"
if [ "$(q "SELECT to_regclass('public.flyway_schema_history') IS NULL")" = "t" ]; then
  check_fail "flyway_schema_history does not exist; this is not a restored IdeyaNest database"
else
  HISTORY_FAILURES="$(q 'SELECT count(*) FROM flyway_schema_history WHERE NOT success')"
  HISTORY_COUNT="$(q 'SELECT count(*) FROM flyway_schema_history WHERE version IS NOT NULL')"
  HISTORY_TOP="$(q 'SELECT version FROM flyway_schema_history WHERE version IS NOT NULL ORDER BY installed_rank DESC LIMIT 1')"
  HISTORY_DUPES="$(q 'SELECT count(*) FROM (SELECT version FROM flyway_schema_history WHERE version IS NOT NULL GROUP BY version HAVING count(*) > 1) d')"
  HISTORY_NULL_SUMS="$(q 'SELECT count(*) FROM flyway_schema_history WHERE version IS NOT NULL AND checksum IS NULL')"
  HISTORY_CONTIGUOUS="$(q 'SELECT count(*) = max(installed_rank) FROM flyway_schema_history')"

  HISTORY_PROBLEM=""
  [ "$HISTORY_FAILURES" = "0" ] || HISTORY_PROBLEM="$HISTORY_FAILURES migrations are recorded as failed"
  [ -n "$HISTORY_PROBLEM" ] || [ "$HISTORY_DUPES" = "0" ] || HISTORY_PROBLEM="$HISTORY_DUPES versions are applied more than once"
  [ -n "$HISTORY_PROBLEM" ] || [ "$HISTORY_NULL_SUMS" = "0" ] || HISTORY_PROBLEM="$HISTORY_NULL_SUMS migrations have no checksum"
  [ -n "$HISTORY_PROBLEM" ] || [ "$HISTORY_CONTIGUOUS" = "t" ] || HISTORY_PROBLEM="installed_rank has gaps; rows are missing from the history"
  if [ -z "$HISTORY_PROBLEM" ] && [ -n "$EXPECT_MIGRATIONS" ] && [ "$HISTORY_COUNT" != "$EXPECT_MIGRATIONS" ]; then
    HISTORY_PROBLEM="the history holds $HISTORY_COUNT migrations, the repository has $EXPECT_MIGRATIONS"
  fi
  if [ -z "$HISTORY_PROBLEM" ] && [ -n "$EXPECT_VERSION" ] && [ "$HISTORY_TOP" != "$EXPECT_VERSION" ]; then
    HISTORY_PROBLEM="the restored schema is at V$HISTORY_TOP, the repository is at V$EXPECT_VERSION"
  fi

  if [ -n "$HISTORY_PROBLEM" ]; then
    check_fail "$HISTORY_PROBLEM"
  else
    check_pass "$HISTORY_COUNT migrations, all successful, newest V$HISTORY_TOP"
  fi
fi

# --------------------------------------------------------------------------

check "relations-present"
if [ -z "$EXPECT_RELATIONS" ]; then
  check_skip "no --expect-relations was given"
else
  MISSING=""
  OLD_IFS="$IFS"; IFS=','
  for REL in $EXPECT_RELATIONS; do
    [ -n "$REL" ] || continue
    if [ "$(q "SELECT to_regclass('public.$REL') IS NULL")" = "t" ]; then
      MISSING="$MISSING $REL"
    fi
  done
  IFS="$OLD_IFS"
  if [ -n "$MISSING" ]; then
    check_fail "missing from the restored schema:$MISSING"
  else
    check_pass "every expected relation is present"
  fi
fi

# --------------------------------------------------------------------------

check "audit-append-only"
if [ "$(q "SELECT to_regclass('public.audit_logs') IS NULL")" = "t" ]; then
  check_fail "audit_logs does not exist in the restored schema"
else
  TRIGGER_STATE="$(q "SELECT coalesce(max(tgenabled::text), 'absent') FROM pg_trigger WHERE tgname = 'audit_logs_is_append_only' AND NOT tgisinternal")"
  # The trigger existing is not the guarantee; the trigger *firing* is. This
  # statement matches no rows and must still be refused, because V21 refuses the
  # statement rather than the row.
  if REFUSAL="$(psql -qAtX -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -d "$DBNAME" -c 'DELETE FROM audit_logs WHERE false' 2>&1)"; then
    check_fail "DELETE FROM audit_logs succeeded; the append-only guarantee did not survive the restore"
  elif printf '%s' "$REFUSAL" | grep -q 'append-only'; then
    check_pass "the trigger is $TRIGGER_STATE and refuses DELETE"
  else
    check_fail "DELETE was refused, but not by the append-only trigger: $REFUSAL"
  fi
fi

# --------------------------------------------------------------------------

check "ledger-self-test"
# Four of the seven fixture rows below belong to transactions that do not
# balance; the detector must find exactly those four groups. A detector that
# finds none is broken in the direction that matters.
SELFTEST_ROWS="$(psql -qAtX -1 -v ON_ERROR_STOP=1 -v tbl=ledger_entries_selftest \
    -h "$HOST" -p "$PORT" -d "$DBNAME" \
    -f "$SCRIPT_DIR/sql/ledger-selftest.sql" \
    -f "$SCRIPT_DIR/sql/ledger-imbalance.sql" 2>&1)" || {
  check_fail "the self-test could not be run: $SELFTEST_ROWS"
  SELFTEST_ROWS=""
}
if [ -n "$SELFTEST_ROWS" ]; then
  SELFTEST_COUNT="$(printf '%s\n' "$SELFTEST_ROWS" | grep -c '^' || true)"
  if [ "$SELFTEST_COUNT" != "4" ]; then
    check_fail "the imbalance detector reported $SELFTEST_COUNT of the 4 planted imbalances; the check below cannot be trusted"
  elif printf '%s' "$SELFTEST_ROWS" | grep -q '00000000-0000-4000-8000-000000000001'; then
    check_fail "the imbalance detector reported the balanced transaction; it is producing false positives"
  else
    check_pass "the imbalance detector found the 4 planted imbalances and no others"
  fi
fi

# --------------------------------------------------------------------------

check "ledger-balance"
if [ "$(q "SELECT to_regclass('public.ledger_entries') IS NULL")" = "t" ]; then
  # Unconditional since V41 created the table (#62). Until then this branch was
  # reachable in a `--ledger-mode absent-ok` run, because §7.2 specified the table
  # and no migration created it; the flag and the negative case that asserted it
  # came out together with the migration, exactly as the runbook said they would.
  #
  # A restored database with no `ledger_entries` is now a restore of the wrong
  # cluster, or one whose migrations did not finish. Either way the strongest check
  # in this file cannot run, and a verification that skipped it would be reporting
  # a clean restore of the platform's books without having looked at them.
  check_fail "ledger_entries does not exist; §7.2 requires it and V41 creates it"
else
  IMBALANCED="$(psql -qAtX -v ON_ERROR_STOP=1 -v tbl=ledger_entries \
      -h "$HOST" -p "$PORT" -d "$DBNAME" -f "$SCRIPT_DIR/sql/ledger-imbalance.sql")"
  ENTRY_COUNT="$(q 'SELECT count(*) FROM ledger_entries')"
  if [ -n "$IMBALANCED" ]; then
    printf '%s\n' "$IMBALANCED" >&2
    check_fail "the ledger does not balance; §18.3 calls any occurrence of this a P0"
  elif [ "$(q "SELECT to_regclass('public.transactions') IS NOT NULL")" = "t" ] \
    && [ "$(q 'SELECT count(*) FROM ledger_entries e WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = e.transaction_id)')" != "0" ]; then
    check_fail "ledger entries reference transactions that are not in the restored database"
  else
    check_pass "$ENTRY_COUNT entries, every transaction balanced in every currency"
  fi
fi

# --------------------------------------------------------------------------

check "referential-integrity"
if FK_OUTPUT="$(psql -qAtX -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -d "$DBNAME" \
    -f "$SCRIPT_DIR/sql/referential-integrity.sql" 2>&1)"; then
  # psql prefixes a notice with the file and line it came from, so the anchor is
  # not the start of the line.
  check_pass "$(printf '%s' "$FK_OUTPUT" | tr -d '\r' | sed -n 's/.*NOTICE:  //p' | head -1)"
else
  printf '%s\n' "$FK_OUTPUT" >&2
  check_fail "orphaned rows exist; part of a transaction survived the restore without the rest of it"
fi

# --------------------------------------------------------------------------

check "atomicity"
PREPARED="$(q 'SELECT count(*) FROM pg_prepared_xacts')"
INVALID_INDEXES="$(q 'SELECT count(*) FROM pg_index WHERE NOT indisvalid')"
UNVALIDATED="$(q 'SELECT count(*) FROM pg_constraint WHERE NOT convalidated')"
ATOMICITY_PROBLEM=""
[ "$PREPARED" = "0" ] || ATOMICITY_PROBLEM="$PREPARED prepared transactions are still open and holding locks"
[ -n "$ATOMICITY_PROBLEM" ] || [ "$INVALID_INDEXES" = "0" ] || ATOMICITY_PROBLEM="$INVALID_INDEXES indexes are invalid; a build was interrupted"
[ -n "$ATOMICITY_PROBLEM" ] || [ "$UNVALIDATED" = "0" ] || ATOMICITY_PROBLEM="$UNVALIDATED constraints are NOT VALID"

if [ -z "$ATOMICITY_PROBLEM" ] && [ -n "$ATOMIC_WITNESS" ]; then
  # One transaction wrote a row to audit_logs and a row to outbox_events. Either
  # both are here or neither is: a restore that produced one of the two would
  # have produced a state the database never committed.
  AUDIT_SIDE="$(q "SELECT count(*) FROM audit_logs WHERE request_id = '$ATOMIC_WITNESS'")"
  OUTBOX_SIDE="$(q "SELECT count(*) FROM outbox_events WHERE aggregate_id = '$ATOMIC_WITNESS'::uuid")"
  if [ "$AUDIT_SIDE" != "$OUTBOX_SIDE" ]; then
    ATOMICITY_PROBLEM="the witness transaction is torn: $AUDIT_SIDE audit rows against $OUTBOX_SIDE outbox rows"
  else
    ATOMIC_NOTE="both halves of the witness transaction agree ($AUDIT_SIDE each)"
  fi
fi

if [ -n "$ATOMICITY_PROBLEM" ]; then
  check_fail "$ATOMICITY_PROBLEM"
else
  check_pass "no prepared transactions, no invalid indexes, no unvalidated constraints${ATOMIC_NOTE:+; ${ATOMIC_NOTE}}"
fi

# --------------------------------------------------------------------------

check "witness-before-present"
if [ -z "$WITNESS_BEFORE" ]; then
  check_skip "no --witness-before was given"
elif [ "$(q "SELECT count(*) FROM audit_logs WHERE id = '$WITNESS_BEFORE'::uuid")" = "1" ]; then
  check_pass "the row committed before the target is present"
else
  check_fail "the row committed before the target is MISSING; recovery stopped short of the target or the archive is incomplete"
fi

check "witness-after-absent"
if [ -z "$WITNESS_AFTER" ]; then
  check_skip "no --witness-after was given"
elif [ "$(q "SELECT count(*) FROM audit_logs WHERE id = '$WITNESS_AFTER'::uuid")" = "0" ]; then
  check_pass "the row committed after the target is absent"
else
  check_fail "a row committed AFTER the target survived; recovery overshot and this is not the database that was asked for"
fi

# --------------------------------------------------------------------------

check "physical-integrity"
if ! command -v pg_amcheck >/dev/null 2>&1; then
  check_skip "pg_amcheck is not installed"
elif ! psql -qAtX -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -d "$DBNAME" \
        -c 'CREATE EXTENSION IF NOT EXISTS amcheck' >/dev/null 2>&1; then
  check_skip "the amcheck extension is not available in this build"
else
  # --heapallindexed also checks that every heap tuple is reachable through each
  # index, which is what catches a page that replayed as readable rubbish rather
  # than as an obvious error.
  if AMCHECK_OUTPUT="$(pg_amcheck -h "$HOST" -p "$PORT" -d "$DBNAME" --heapallindexed 2>&1)"; then
    check_pass "pg_amcheck found no corruption in any heap or index"
  else
    printf '%s\n' "$AMCHECK_OUTPUT" | head -40 >&2
    check_fail "pg_amcheck reported corruption"
  fi
fi

# --------------------------------------------------------------------------

check "data-checksums"
if [ "$(q 'SHOW data_checksums')" = "on" ]; then
  check_pass "page checksums are on, so a corrupt page is an error rather than a wrong answer"
else
  # A warning and not a failure: it is a property of the cluster the backup was
  # taken from, which a restore cannot change and which nobody can fix at 03:00.
  check_warn "page checksums are off in this cluster; silent corruption would restore silently. Fix at the next initdb"
fi

# --------------------------------------------------------------------------

printf '\n----------------------------------------------------------------\n' >&2
printf 'passed %s, failed %s, skipped %s, warnings %s\n' "$PASSED" "$FAILED" "$SKIPPED" "$WARNED" >&2

if [ -n "$REPORT" ]; then
  {
    printf 'verified_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf 'database=%s\n' "$DBNAME"
    printf 'server_version=%s\n' "$SERVER_VERSION"
    printf 'recovery_target_time=%s\n' "${TARGET_TIME:-none}"
    printf '%s' "$RESULTS"
    printf 'passed=%s\nfailed=%s\nskipped=%s\nwarnings=%s\n' "$PASSED" "$FAILED" "$SKIPPED" "$WARNED"
    printf 'outcome=%s\n' "$([ "$FAILED" -eq 0 ] && printf 'PASS' || printf 'FAIL')"
  } >"$REPORT"
  log "report written to $REPORT"
fi

if [ "$FAILED" -ne 0 ]; then
  printf 'RESTORE VERIFICATION FAILED\n' >&2
  exit 1
fi

printf 'RESTORE VERIFICATION PASSED\n' >&2
