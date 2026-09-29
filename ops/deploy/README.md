# Environments and deployment

`docs/architecture.md` §19, issue #139.

| Environment | Trigger | Approval | Data |
|---|---|---|---|
| Local | `pnpm dev` and `./gradlew bootRun` | — | Docker Compose: PostgreSQL and Mailpit |
| Preview | Per pull request | — | Storybook only, today. See "What is not built" |
| Staging | Every merge to `main` | None | Anonymised snapshot, provider sandbox |
| Production | A `v*` tag | Required reviewers | Live |

## The one property everything else follows from

**Nothing is built twice.** `release.yml` builds each image once, pushes it, and
records its digest. Staging deploys a digest; production deploys *the same*
digest; a rollback deploys a digest that was running yesterday.

A pipeline that rebuilt from a tag would produce a different image from the same
source — different base layers, different transitive dependencies resolved on a
different day — and "roll back to what was working" would be a hope rather than
an instruction.

## Rolling back

1. Open the **Release** workflow → **Run workflow**.
2. Choose the environment.
3. Paste the digest that was running before. Every deploy writes both digests
   into its job summary for exactly this moment; the registry's package page has
   them too.

The build and migration jobs are skipped when a digest is given, because the
image already exists. The rollout is the same code path as a forward deploy —
there is no separate rollback mechanism to be wrong.

**A rollback does not undo a migration.** §19.3 is why it does not have to:
expand then contract, so a migration deployed with release N is one release N−1
can still run against. If a release broke that rule, the rollback will not save
it and the reversal in the migration's `-- Reverse:` block is what you are
reading at three in the morning. That block is required by
`MigrationConventionTests` for this reason.

## What an operator has to configure

Per GitHub Environment (`staging`, `production`):

| Kind | Name | Meaning |
|---|---|---|
| Secret | `DEPLOY_HOOK_URL` | Where to POST the rollout. **Absent means nothing is deployed**, loudly — the workflow warns and stops rather than passing silently |
| Secret | `DEPLOY_HOOK_TOKEN` | Optional bearer token for the hook |
| Variable | `HEALTH_URL` | The API's readiness probe, polled after the rollout. Absent skips the verification |
| Variable | `ENVIRONMENT_URL` | Shown on the deployment in GitHub's UI |
| Variable | `SITE_URL` | Repository-level. Baked into the web image — see below |

Production's approval is the GitHub Environment's **required reviewers** setting,
not anything in this repository. An approval rule a pull request can edit is not
an approval rule.

### The hook's contract

A POST with this body, and whatever the environment does with it is its own
business — an Argo webhook, a Cloud Run deployment, an SSH-triggered
`docker compose pull`:

```json
{
  "environment": "staging",
  "images": { "api": "sha256:…", "web": "sha256:…" },
  "ref": "9f2c…"
}
```

Two digests and an environment name. Deliberately nothing else: the moment this
contract knows what a cluster is, this repository owns infrastructure it cannot
test.

## `IDEANEST_SITE_URL` is baked in, and that is not an oversight

`apps/web`'s image takes it as a build argument. `lib/seo/metadata.ts` writes
every canonical URL, `og:url`, sitemap entry and absolute social-image URL
against it, and the statically rendered pages hold it — an image built with the
default and deployed to production serves a sitemap full of `localhost`, which a
crawler believes.

So one image per site URL is unavoidable. `release.yml` builds the production
one from the repository variable `SITE_URL`. A staging host that differs needs
its own build:

```bash
docker build -f apps/web/Dockerfile \
  --build-arg IDEANEST_SITE_URL=https://staging.ideanest.az \
  -t ghcr.io/<owner>/<repo>/web:staging-<sha> .
```

The API has its own name for the same origin: `WEB_BASE_URL`, read at runtime,
which every e-mail link is built from and which is also the origin a payment
provider may return a person to (#139, `docs/architecture.md` §9.4). **`WEB_BASE_URL`
must be the site's https origin** (production: `https://ideyanest.com`) in every
deployed environment. An http value on a real host is logged at start-up and every
payment return address is then refused. Left unset it falls back to
`http://localhost:3000`, which is a valid origin: the API starts, logs a loud
`PAYMENT RETURN ADDRESSES ARE LOOPBACK ONLY` WARN (when a payment provider is
configured or a non-local profile is active), and refuses every real return
address — so check for that line after a deploy.

The web builds the return addresses from the browser's `location.origin`
(`apps/web/src/lib/pledges/payment.ts`, `apps/web/src/lib/account/payout.ts`), not
from `IDEANEST_SITE_URL`. So **every host the web is served on** must be either the
site origin (`WEB_BASE_URL`) or listed in `PAYMENT_RETURN_ORIGINS` (comma
separated, https only; a malformed entry stops the API starting), or payments
started on that host are refused with `INVALID_RETURN_URL`. Production is served on
`https://ideyanest.com`, and `www.ideyanest.com` redirects to it, so production
needs nothing extra; a staging site, a preview host, or a second domain that serves
pages rather than redirecting must be added. Every refusal is logged at WARN with
the field and the host (never the full address), which is where a missing host
shows up.

`IDEANEST_API_ORIGIN` is **not** baked in. It is read at request time by the
proxy and by the server reads, so one API image and one web image run against
staging and production alike.

## Building the images by hand

```bash
# The API: context is its own directory.
docker build -f apps/api/Dockerfile -t ideanest-api apps/api

# The web application: context is the REPOSITORY ROOT, because it compiles three
# source-only workspace packages. `.dockerignore` keeps that context to a few
# megabytes rather than the whole checkout.
docker build -f apps/web/Dockerfile -t ideanest-web .
```

Both run as a non-root user and carry a `HEALTHCHECK`. The API's checks
`/actuator/health/readiness`; the web application's checks `/en/about` rather
than `/`, because the root path is a 307 to a language — a check that follows
redirects would pass on a broken application and one that does not would fail on
a working one.

## Runbooks

§19.4 requires three, and they are not written yet: provider outage, database
failover, mass collection failure. Two of the three are about a payment provider
this platform has not chosen (#60), and a runbook for an integration that does
not exist would be fiction. The third is #141's territory.

What exists in the meantime: `ops/backup/` for restore, and
`ops/observability/alerts.yml` for what wakes somebody up and why.

## What is not built, and why it is named here

**Ephemeral preview environments per pull request.** §19.1 asks for one with its
own database. `ci.yml` publishes a Storybook preview per pull request and that is
all — a full preview environment needs a place to run, a database to provision
and tear down, and a per-pull-request URL, none of which this repository can
create without owning infrastructure. The pipeline is shaped so that adding one
is a third `environment:` in `release.yml` rather than a redesign.

**Blue-green for payment releases.** §19.2 asks for rolling updates by default
and blue-green for anything touching payments. Which of the two happens is
decided by whatever the hook talks to, so this repository states the requirement
and the environment implements it. That split is stated rather than hidden
because it is the one place the pipeline stops being self-describing.
