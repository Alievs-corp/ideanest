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

**Payriff (#351).** `PAYMENT_PROVIDER=PAYRIFF` needs `PAYRIFF_SECRET_KEY` (a
Coolify secret, never in the repository) and `PAYRIFF_CALLBACK_URL`, the API's
public `https://<api host>/v1/webhooks/psp/payriff`; either missing, or a callback
that is not https, stops the API starting. Staging uses a Payriff application in
**Development** status — Payriff's sandbox, test cards only, listed in
`apps/api/README.md` — and production a live application's key; nothing else
differs. Payouts refuse under Payriff until #352. **Only the primary provider has
an adapter**: switching from Epoint to Payriff turns Epoint's off, so its callbacks
are refused and its charges can no longer be refunded. Switch only while no Epoint
charge can still need either (`docs/architecture.md` §9.4).

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

What exists in the meantime: `ops/backup/` for restore,
`ops/observability/alerts.yml` for what wakes somebody up and why, and
"Maintenance" below for taking the platform down on purpose.

## Maintenance

Issue #214. The contract itself (status, headers, body, the exempt paths) is in
`docs/architecture.md`, "Maintenance". This section is how to operate it.

A maintenance response is always `503`, `Cache-Control: no-store`, a
`Retry-After`, and an `application/problem+json` body with
`type: "https://ideanest.az/problems/maintenance"`. It comes from one of two
places, and the body's `source` says which:

| `source` | Who answers | When | `startsAt` / `endsAt` | `Retry-After` |
|---|---|---|---|---|
| `api` | The API's `MaintenanceFilter` | A window is active in the console and the API is running | The announced times (`endsAt` may be `null`) | Seconds to the announced end, 30 s – 1 h; 300 with no end |
| `edge` | `ops/edge`, through Traefik | The API (or the web) container is not running, starting, unhealthy, or timing out | Both `null` | 120 |

Clients open their maintenance screen for that `type` only. Any other `5xx`,
including a `503` without it, is an ordinary error.

### Scheduling, starting, ending and verifying a window

In the admin console, `/admin/maintenance` (needs `CONFIGURE_PLATFORM`):

| Action | What it does |
|---|---|
| **Schedule** | A start, an end (or none: "until further notice"), when the notice starts showing (default: 24 hours before the start), and an internal note that readers never see. One window may be active or upcoming at a time; an overlapping one is refused |
| **Start now** | Starts an upcoming window immediately. Asks for confirmation |
| **End now** | Ends the active window. Asks for confirmation |
| **Extend** | Moves the end, or changes the note |
| **Cancel** | Cancels an upcoming window |

The same operations are `/v1/admin/maintenance` in the API (`GET` for current,
upcoming and the last 20; `POST` to schedule; `POST /{id}/start-now`;
`POST /{id}/end-now`; `PATCH /{id}` for the end or the note; `DELETE /{id}` to
cancel). The request bodies are in `apps/api/openapi.json`. Every change is in
the audit log with its before and after state.

A change reaches every API instance within 10 seconds (the windows are cached
like feature flags). Verify from outside rather than trusting the console:

```bash
# The status endpoint says what readers are being told. Never cached.
curl -s https://api.ideyanest.com/v1/status
#   {"state":"maintenance","maintenance":{"startsAt":…,"endsAt":…},"upcoming":null}

# A business endpoint answers with the contract, source "api".
curl -si https://api.ideyanest.com/v1/categories
#   HTTP/2 503 … retry-after: … cache-control: no-store … "source":"api"

# The web renders its /maintenance page with 503.
curl -si https://ideyanest.com/az | head -1
```

While the window is active, staff still get in: sign-in and token refresh work
for staff accounts, and any request carrying a staff access token passes the
filter. A reader's sign-in is refused with the maintenance problem after the
password is checked, so no reader session is issued during a window.

After **End now**, `/v1/status` says `operational` within 10 seconds, the web's
maintenance page sends readers back to where they were, and paused background
work resumes.

### Deploying under a window

1. **Schedule the window first**, with the notice period readers should get (24
   hours by default). The web and the app show a dismissible "planned
   maintenance" banner from then on.
2. **At the start**, check `/v1/status` says `maintenance`. From here readers get
   the API's answer, with the announced end.
3. **Deploy** (the Release workflow, above). While the API container is replaced,
   the edge answers instead, with `source: "edge"` and no end. That is expected
   and lasts as long as the new container takes to become healthy.
4. **Check the platform as staff** once the new API is healthy: the window is
   still active, so readers still see maintenance while staff use it normally.
5. **End the window**, and check `/v1/status` says `operational`.

A deploy without a window still works: the edge covers the restart. Readers just
get no notice, and see the neutral edge wording rather than an announced end.

### Webhooks and background jobs meanwhile

- **Window active, API running.** Payment provider webhooks are exempt from the
  filter and are accepted and recorded as usual. Outbound work (payouts,
  scheduled e-mails, reconciliation passes, notification fan-out) does not claim
  anything while the window is active and resumes when it ends. Nothing is
  collected during a window, and campaign deadlines do not move.
- **API not running (the edge answers).** Webhooks get the edge's `503` and are
  not recorded. Payment providers retry on their own schedule, so keep a stop
  shorter than the shortest provider retry period; if a provider gives up, the
  next reconciliation pass is what picks up the settlement. Background jobs do
  not run because nothing is running; they resume with the API, and during a
  still-active window they wait for its end as above.

### The edge (`ops/edge`)

A small nginx container (`ops/edge/Dockerfile`) that answers every request with
the maintenance contract, `source: "edge"`, `Retry-After: 120`. It tells an API
request from a web request by the **port** the proxy sends it to, not by
anything in the request:

| Port | Answers with |
|---|---|
| `8080` | The problem document, for every path and method. Traefik service `edge-api` |
| `8081` | A static HTML page (Azerbaijani, English, Russian, Turkish; no scripts, no external assets, reloads every 120 s); the problem document under `/v1/`, which the web proxies to the API. Traefik service `edge-web` |

`ops/edge/traefik/edge-maintenance.yaml` wires it into Coolify's Traefik in two
ways, because a down API can be down in two ways:

- **Fallback routers.** When a container is stopped, starting or unhealthy,
  Traefik's Docker provider drops it, and with it the router Coolify's labels
  declared. Without a fallback Traefik would answer `404`. `edge-api-fallback`
  and `edge-web-fallback` match the same hosts at priority 2, below every
  application router, so they only ever match when the application's router is
  gone.
- **`errors` middlewares**, `edge-api-errors` and `edge-web-errors`, attached to
  the application routers. They replace a `504` (the upstream timed out) with the
  edge's answer and rewrite the status to `503`. They deliberately do **not**
  take `502` or `503`: the middleware cannot tell a status Traefik produced from
  one the application produced, and the API produces both on purpose (its own
  maintenance `503` with the announced end, ordinary dependency `503`s, and a
  `502` for an unavailable mail relay). Rewriting those would present a real
  error as maintenance. Nothing in the platform answers `504` itself.

`.github/workflows/edge.yml` runs `ops/edge/test/static.test.mjs` (the files
against the contract) and `ops/edge/test/live.test.mjs` (a real Traefik with the
shipped file, stand-ins labelled the way Coolify labels the API and the web,
then the stand-ins stopped) on every change under `ops/edge`. Both run locally
with Node and Docker:

```bash
node ops/edge/test/static.test.mjs
node ops/edge/test/live.test.mjs
```

### Applying the edge in Coolify (once, by the owner)

Nothing in this repository changes the server. These steps do, and they are
done by hand:

1. **Check the proxy's Traefik version** is v3.4 or later (`statusRewrites` needs
   it): `docker exec coolify-proxy traefik version`. Upgrade the proxy from
   Coolify first if it is older.
2. **Create the edge resource** in the same Coolify project and on the same
   server and network as the API and the web: a Dockerfile application from this
   repository, base directory `/ops/edge`, ports exposed `8080,8081`, **no
   domain** and no host port mapping. Without a domain Coolify generates no router
   for it, which is right: only the fallback routers and the middlewares reach it.
3. **Make it resolvable from the proxy.** The shipped file addresses it as
   `ideanest-edge`. Either give the container that name or network alias on the
   proxy's network, or replace `ideanest-edge` in the two service URLs with the
   name it does have (`docker inspect <container> --format '{{json .NetworkSettings.Networks}}'`
   lists its aliases). Then check from the proxy:
   ```bash
   docker exec coolify-proxy wget -q -S -O /dev/null http://ideanest-edge:8080/
   #   HTTP/1.1 503 Service Temporarily Unavailable   <- right
   ```
4. **Add the dynamic configuration**: Servers → the server → Proxy → Dynamic
   Configurations, a new file `edge-maintenance.yaml` with the content of
   `ops/edge/traefik/edge-maintenance.yaml`. The hosts in it are production's;
   the entry point (`https`) and certificate resolver (`letsencrypt`) are
   Coolify's defaults and must match what the API's and the web's routers use.
   Check the proxy log for errors after saving.
5. **Attach the middlewares.** In the API resource's container labels, append
   `,edge-api-errors@file` to its https router's
   `traefik.http.routers.<router>.middlewares` label (add the label if there is
   none). Do the same on the web resource's https router(s) with
   `edge-web-errors@file`. Redeploy each so the labels take effect. Coolify
   regenerates labels when a domain changes, so check them again after editing a
   domain.
6. **Verify nothing changed while everything is up**: `/v1/status` answers `200`,
   the site loads. Then do the staging test below before relying on it.

### Testing the edge on a staging copy

Never on production: stopping the API there is an outage.

1. On a copy of the production setup with its own hosts, apply the steps above
   with the staging hosts in the dynamic file.
2. **Stop the API container** (the API resource → Stop).
3. Within a few seconds:
   ```bash
   curl -si https://<staging-api-host>/v1/status
   #   HTTP/2 503
   #   content-type: application/problem+json
   #   retry-after: 120
   #   cache-control: no-store
   #   {"type":"https://ideanest.az/problems/maintenance","title":"Scheduled maintenance",
   #    "status":503,"startsAt":null,"endsAt":null,"source":"edge"}
   curl -si -X POST https://<staging-api-host>/v1/auth/login   # the same
   ```
   The app, pointed at staging, shows its maintenance screen with the neutral
   wording.
4. **Stop the web container** too, and open the site: the static page with
   `503` (`curl -si https://<staging-web-host>/ | head -1`).
5. **Start both.** Normal answers return as soon as each is healthy, with no
   change to the proxy.
6. Record the result on issue #214; the acceptance criteria ask for this dry run
   once on a copy of production.

### Known limits

- **The edge cannot tell a planned stop from a crash.** An unplanned crash also
  shows the maintenance answer, with `source: "edge"` and no announced end. That
  is still more honest than a raw `502`, which is why the clients word the edge
  case neutrally ("IdeyaNest is unavailable right now, we're working on it") and
  never say "planned". The alerts in `ops/observability/alerts.yml`, not the
  edge, are what tell a person something crashed.
- **A `502` in the moment between a process dying and Docker marking its
  container stopped** passes through as Traefik's plain `502`, for the reason
  above. The fallback router takes over once the container is marked.
- **If the proxy's Docker provider sets `allowEmptyServices`**, Traefik keeps a
  stopped application's router and answers `503` itself, which the middlewares
  do not take. Coolify does not set it; the staging test shows it if it does.
- **The web's server-side reads go wherever `IDEANEST_API_ORIGIN` points.** If
  that is the public API host, a page rendered while the API is down reads the
  edge's problem document and the web renders its `/maintenance` page. If it is
  an internal address, the read fails to connect and the web shows its ordinary
  error page until the API is back.
- **If the server itself is down, nothing here helps.** `ideyanest.com` is behind
  Cloudflare, which then shows its own `52x` page; `api.ideyanest.com` is
  DNS-only and simply does not answer.

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
