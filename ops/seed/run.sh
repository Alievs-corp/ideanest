#!/usr/bin/env bash
#
# Loads the local demo seed. Development only -- see README.md in this
# directory for what it creates and why none of it belongs anywhere else.
#
#   ops/seed/run.sh                      # against the compose database
#   PGPORT=5433 ops/seed/run.sh          # when 5432 is taken by a local server
#   SEED_VIA_DOCKER=0 ops/seed/run.sh    # use a psql on PATH instead of the container
#
# The migrations have to have run first: this file writes rows, it does not
# create tables. Start the service once (`./gradlew bootRun` in apps/api) and
# let Flyway finish before running it.
#
# The shared password is generated on this machine the first time the seed
# runs, kept in ops/seed/.seed-password (git-ignored) so that a re-run matches
# the accounts it already created, and printed at the end. Set SEED_PASSWORD to
# choose it instead. Hashing it needs Node 24.7 or later, for crypto.argon2.

set -euo pipefail

cd "$(dirname "$0")"

# ---------------------------------------------------------------------------
# NOT PRODUCTION. Checked before a single statement is sent.
#
# Every seeded account shares one password, and the money rows name providers
# that were never called: run against a deployed database, this is a set of
# console accounts with a known credential and a ledger that lies. The lists
# and the rule are ops/seed/e2e/seed.mjs's -- literal names only, because
# staging may share the production server, and refusing on a resolved address
# would refuse the environment that seed exists for.
# ---------------------------------------------------------------------------
PRODUCTION_DOMAINS=(ideyanest.com ideanest.az)
PRODUCTION_ADDRESSES=(46.224.142.29)

is_production_host() {
    local host address domain
    host=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -e 's/^\[//' -e 's/\]$//' -e 's/\.$//')
    for address in "${PRODUCTION_ADDRESSES[@]}"; do
        [ "$host" = "$address" ] && return 0
    done
    for domain in "${PRODUCTION_DOMAINS[@]}"; do
        [ "$host" = "$domain" ] && return 0
        case "$host" in
            staging*."$domain") ;;
            *."$domain") return 0 ;;
        esac
    done
    return 1
}

refuse_production() {
    printf 'Refusing to seed: %s names %s, which is production. This seed is for a local database.\n' "$1" "$2" >&2
    exit 2
}

# PGHOST in both modes: it is what SEED_VIA_DOCKER=0 connects to, and a PGHOST
# naming production with the container path selected is a mistake worth
# stopping rather than quietly ignoring.
if is_production_host "${PGHOST:-localhost}"; then
    refuse_production PGHOST "$PGHOST"
fi
# `docker exec` runs wherever the Docker client points, which is not always this
# machine: DOCKER_HOST=ssh://deploy@ideanest.az makes the container path a
# production one.
if [ -n "${DOCKER_HOST:-}" ]; then
    docker_host=$(printf '%s' "$DOCKER_HOST" | sed -E 's#^[a-z+]+://##; s#^[^@]*@##; s#^\[([^]]*)\].*$#\1#; s#[:/].*$##')
    if is_production_host "$docker_host"; then
        refuse_production DOCKER_HOST "$docker_host"
    fi
fi

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-ideanest}"
PGPASSWORD="${PGPASSWORD:-ideanest}"
PGDATABASE="${PGDATABASE:-ideanest}"
SEED_VIA_DOCKER="${SEED_VIA_DOCKER:-1}"
SEED_CONTAINER="${SEED_CONTAINER:-ideanest-postgres}"

# ---------------------------------------------------------------------------
# The shared password: this machine's, never a value written in the repository.
#
# A password in a README is a password on every database somebody once seeded
# and forgot about -- a staging box, a demo laptop, a restored backup -- and the
# seed's accounts include every console role. Generated once and kept beside
# this script (git-ignored, readable by its owner only), so that a re-run,
# whose inserts are ON CONFLICT DO NOTHING, hands out the password the existing
# rows were made with rather than a new one that matches nothing.
# ---------------------------------------------------------------------------
PASSWORD_FILE=".seed-password"
if [ -n "${SEED_PASSWORD:-}" ]; then
    seed_password="$SEED_PASSWORD"
elif [ -s "$PASSWORD_FILE" ]; then
    seed_password=$(cat "$PASSWORD_FILE")
else
    # 18 random bytes: 24 characters of base64url, well past the service's
    # twelve-character minimum, and nothing a person picked.
    seed_password=$(head -c 18 /dev/urandom | base64 | tr '+/' '-_')
    (umask 077 && printf '%s' "$seed_password" > "$PASSWORD_FILE")
fi

# Argon2id with the service's own parameters (ideanest.auth.argon2 in
# application.yml), in the encoding Spring's Argon2PasswordEncoder reads -- so the
# service accepts it and does not rehash it on first sign-in. The password
# reaches node through the environment rather than the command line, where any
# process on the machine could list it.
if ! seed_password_hash=$(SEED_PASSWORD="$seed_password" node -e '
const crypto = require("node:crypto");
if (typeof crypto.argon2Sync !== "function") process.exit(3);
const salt = crypto.randomBytes(16);
const hash = crypto.argon2Sync("argon2id", {
  message: process.env.SEED_PASSWORD, nonce: salt, parallelism: 1, tagLength: 32, memory: 19456, passes: 2,
});
const b64 = (bytes) => bytes.toString("base64").replace(/=+$/, "");
process.stdout.write(`$argon2id$v=19$m=19456,t=2,p=1$${b64(salt)}$${b64(hash)}`);
'); then
    printf 'Cannot hash the seed password: this needs Node 24.7 or later (crypto.argon2).\n' >&2
    exit 1
fi

# Sent to every psql session ahead of 00_helpers.sql, whose seed_password()
# reads it back. A session setting rather than a psql variable, because the
# function body is dollar-quoted and psql does not interpolate inside one. The
# encoding is base64 and `$`, so it cannot close the quotes around it.
preamble="SET seed.password_hash = '${seed_password_hash}';"

# Order matters. Later files reference rows earlier files created, and the
# helper definitions in 00 are dropped again by 09, so 00 is prepended to every
# invocation rather than run once.
FILES=(
    01_accounts.sql
    02_projects.sql
    02b_more_campaigns.sql
    03_rewards.sql
    04_backers.sql
    05_pledges.sql
    06_community.sql
    07_operations.sql
    08_recompute.sql
    09_cleanup.sql
)

run_sql() {
    if [ "$SEED_VIA_DOCKER" = "1" ]; then
        docker exec -i -e PGCLIENTENCODING=UTF8 "$SEED_CONTAINER" \
            psql -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -q
    else
        PGPASSWORD="$PGPASSWORD" PGCLIENTENCODING=UTF8 \
            psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -q
    fi
}

for file in "${FILES[@]}"; do
    printf '  %s ... ' "$file"
    # 00 first, every time: 09 drops the helpers, and a partial re-run would
    # otherwise fail on a function that no longer exists.
    #
    # THE OUTPUT IS CAPTURED RATHER THAN PIPED. psql's exit code is lost through
    # a pipe, and a seed that reports success over a constraint violation is
    # worse than one that fails loudly.
    if output=$({ printf '%s\n' "$preamble"; cat 00_helpers.sql "$file"; } | run_sql 2>&1); then
        if grep -qi 'ERROR' <<<"$output"; then
            printf 'failed\n\n%s\n' "$output" >&2
            exit 1
        fi
        printf 'ok\n'
    else
        printf 'failed\n\n%s\n' "$output" >&2
        exit 1
    fi
done

printf '\nSeeded. Every account signs in with the password kept in ops/seed/%s:\n\n  %s\n' "$PASSWORD_FILE" "$seed_password"
