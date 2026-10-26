# Real user monitoring

What real visitors' browsers measure, what is done with it, and — at least as
importantly — what is deliberately not collected.

`apps/web/performance/` is the **lab** half: Lighthouse, on a CI runner, against
a build. This is the **field** half: five metrics, from real devices on real
networks, reported at the 75th percentile. The two use the same metric names and
the same thresholds, and `apps/web/src/lib/rum/metrics.test.ts` fails the build
if they stop agreeing.

---

## The metrics, and the thresholds

| Metric | Good | Needs improvement | Poor | Why it is here |
|---|---|---|---|---|
| **LCP** — Largest Contentful Paint | ≤ 2500 ms | 2500–4000 ms | > 4000 ms | Core Web Vital |
| **INP** — Interaction to Next Paint | ≤ 200 ms | 200–500 ms | > 500 ms | Core Web Vital |
| **CLS** — Cumulative Layout Shift | ≤ 0.1 | 0.1–0.25 | > 0.25 | Core Web Vital |
| **TTFB** — Time to First Byte | ≤ 800 ms | 800–1800 ms | > 1800 ms | Where a bad LCP came from |
| **FCP** — First Contentful Paint | ≤ 1800 ms | 1800–3000 ms | > 3000 ms | The same |

**These are Google's published boundaries, not numbers this repository chose.**
`docs/architecture.md` sets latency targets for the API (§20.4) and names no
client-side performance budget at all, so there was no specification number to
report against and none has been invented in its place. Using Google's means a
row here means what the same row means in Search Console.

**INP, and never FID.** Google retired First Input Delay in September 2024.
Next's `useReportWebVitals` still subscribes to `onFID`, so a FID sample arrives
at the reporter on every page load; it is dropped there. Two interaction metrics
on one dashboard, one of which measures only the first interaction, is worse
than one.

**TTFB and FCP are not Core Web Vitals and are collected anyway**, because they
are what makes a bad LCP actionable. An LCP of four seconds behind a TTFB of two
is a server problem; the same LCP behind a TTFB of 100 ms is a client one.
Without them the only honest response to a regression is to go and measure
again.

### Why p75

Core Web Vitals is defined as the 75th percentile of the distribution: three
quarters of visits were at least this good. A mean is the number everybody
reaches for and it describes nobody — one visitor on a train with a thirty-second
LCP moves it, and a page that is fast for most people and unusable for a quarter
of them has a perfectly respectable mean.

The p75 here is **nearest rank**: the observation at rank `ceil(0.75 × n)` in
ascending order, which is a value somebody actually experienced. Interpolating
between two neighbouring ranks would produce a headline figure no session had,
and CrUX — the thing this is meant to be comparable with — does not interpolate
either. The consequence worth knowing is that with fewer than four observations
the p75 is the maximum, which is why every row prints its sample count beside
the figure.

### The lab and the field do not measure the same thing

They are not expected to agree, and a difference between them is information
rather than a fault.

| | Lab (`performance/`) | Field (this) |
|---|---|---|
| Where | A CI runner, once per pull request | Real devices, continuously |
| INP | **Impossible** — a headless load performs no interaction. TBT is reported as Google's recommended proxy, labelled as one | Measured directly |
| Network, CPU | Lighthouse's default mobile emulation | Whatever the visitor has |
| Blocking | No — advisory. See `apps/web/performance/README.md` | No |

---

## What is collected

One beacon per visit, carrying at most twenty samples. This is the whole of it:

| Field | Shape | Notes |
|---|---|---|
| `v` | `1` | Schema version |
| `requestId` | `[A-Za-z0-9_-]{8,64}` | §18.1. One per beacon |
| `traceId` | 32 lower-case hex | §18.1. One per session |
| `spanId` | 16 lower-case hex | §18.1. One per beacon |
| `sessionId` | A v4 UUID | Random, per tab, gone when the tab closes |
| `route` | One of eleven Next route patterns, or `(unrecognised)` | Never a URL |
| `connection` | `slow-2g` \| `2g` \| `3g` \| `4g` \| `unknown` | |
| `device` | `mobile` \| `tablet` \| `desktop` \| `unknown` | Viewport width, at Tailwind's `md` and `lg` |
| `samples[].name` | One of the five metrics above | |
| `samples[].value` | A number, bounded per metric | |
| `samples[].navigationType` | One of seven | Separates a cold load from a bfcache restore |

Fewer than four hundred distinct attribution combinations exist across those
four dimensions. That is not a fingerprint, and every one of them points at
something to change.

## What is not collected, and why

- **No URL, ever.** A real pathname is `/projects/019432f1-…/back`. That
  identifier names a campaign, the campaign names a creator, and a run of them
  in timestamp order is a browsing history. Only the Next route pattern is sent,
  matched from a fixed whitelist — so a path this build does not recognise
  becomes `(unrecognised)` rather than being reported as itself.
- **No query string and no fragment.** `/discover?q=…` is whatever somebody
  typed into a search box. A pathname containing `?` or `#` is *refused* rather
  than trimmed, so a caller that passed a whole URL by mistake leaks nothing.
- **No user identifier, and no account of any kind.** The endpoint is
  unauthenticated and reads no session.
- **No IP address is stored.** The rate limiter keys on
  `hash(process-lifetime random salt + forwarded address)`. The hash is in
  memory for at most a minute; the address itself is read from the header and
  dropped, and nothing logs it. §17.4 lists an IP address as personal data and
  nulls it on anonymisation.
- **No user agent, no screen size, no `deviceMemory`, no
  `hardwareConcurrency`.** The first is high-entropy for an answer the viewport
  bucket already gives; the last two are among the strongest fingerprinting
  signals a browser exposes.
- **No free text anywhere.** There is no field on the wire a string can be typed
  into. This is the same discipline
  `az.ideanest.shared.observability.LogFields` applies on the service, where
  there is a method per safe shape and none that takes text.
- **No cookie, and nothing that outlives the tab.** The session identifier lives
  in `sessionStorage` and is never sent anywhere except in the beacon body.

Two locks, not one. The schema (`lib/rum/payload.ts`) validates every string
against a closed vocabulary or a strict pattern and **refuses unknown keys**;
then `lib/rum/redaction.ts` runs §17.4's shape rules — email, phone, JWT, bearer
credential, `otpauth://`, IBAN, card — over what is left. The second is
redundant today by construction, and exists for the afternoon somebody adds a
field: it is the test that fails.

The one exemption is the four correlation identifiers, which the schema has
already proved to be machine-minted hex or a v4 UUID. About one span identifier
in eighteen hundred comes out as sixteen digits, and a fraction of those satisfy
Luhn; left in the check, the card rule would silently reject roughly one beacon
in a hundred thousand for looking like a Visa, with no cause anybody could find.
A string proved to match `^[0-9a-f]{16}$` can contain none of the shapes above.

---

## Sampling

**Session-consistent, at a configurable rate, defaulting to 1.0.**

```
NEXT_PUBLIC_IDEANEST_RUM_SAMPLE_RATE=0.25   # a quarter of sessions
NEXT_PUBLIC_IDEANEST_RUM_SAMPLE_RATE=0      # collect nothing at all
```

The decision is a pure function of the session identifier, taken once, cached in
`sessionStorage`, and obeyed by every metric that session produces — including
after a reload, which is a continuation of the same visit.

**It has to be per session and not per metric.** A coin flip per metric looks
equivalent and destroys the number. Core Web Vitals ranks *visits*; flipping per
metric ranks metrics, so a session that reported LCP but was dropped for INP
appears in one distribution and not the other — and slow sessions, which emit
more samples because they are slow enough to be interacted with repeatedly, end
up over-represented in exactly the metric they are worst at. The result has the
shape of a p75 and is not one.

**Why the default is 1.0.** Because a percentile computed from too few samples
will be believed and should not be. The working rule is roughly **a thousand
samples per route per day** before a p75 is stable enough to notice a regression
in; below a few hundred it moves by more between two ordinary days than a real
regression would move it. That is the same argument `apps/web/performance/README.md`
makes for not gating a pull request on lab Core Web Vitals.

`docs/architecture.md` §11.4 states the platform's position plainly: it has "no
metrics, tracing, or alerting", and there is no production traffic to sample
down from. At this volume any rate below 1.0 buys nothing and costs the ability
to say anything. **The rule for turning it down is written above**: keep about a
thousand samples per route per day, and no fewer.

The value is `NEXT_PUBLIC_`, so it is inlined at build time and changing it means
rebuilding. Note that a rate of `0` also removes the `fetch` wrapper described
below, so an unsampled visitor pays one `sessionStorage` read and nothing else.

---

## Delivery

`navigator.sendBeacon`, falling back to `fetch(…, { keepalive: true })`.

The metrics that matter arrive last — LCP is not final until the page is hidden
or interacted with, INP not until interaction stops, CLS accumulates for the
whole visit — so the moment a beacon is worth sending is the moment the browser
cancels in-flight requests. `sendBeacon` exists for exactly that: the user agent
keeps the request alive after the document is gone, and it returns synchronously
so nothing blocks the unload.

The fallback runs when `sendBeacon` is absent (a few embedded browsers), returns
`false` (the user agent's queue is full, or the body is over its limit), or
throws (some privacy extensions replace it). `keepalive` gives the same
after-unload guarantee. A rejected `fetch` is swallowed: a monitoring feature
that throws into the application has become the incident.

**The cost to the page is the point.** Reporting a metric does no work beyond a
bounds check and an array push. Serialising and sending happens in a
`requestIdleCallback` (a `setTimeout(…, 0)` in Safari, which still ships none),
or synchronously during `pagehide` — synchronously, because an idle callback
scheduled while the page is unloading never runs and the whole visit would be
lost. Nothing touches the DOM or reads layout on any path a user is waiting for.

The flush is attached to `pagehide` and to `visibilitychange` → `hidden`, and
both are needed: `visibilitychange` is the only one mobile Safari reliably fires
when a user switches apps, and `pagehide` covers a desktop navigation away from
a page that was never hidden first. **`beforeunload` and `unload` are
deliberately not used** — either makes a page ineligible for the back-forward
cache, so listening for them to measure performance would slow every back button
on the site.

**Nothing is rendered.** `<WebVitals />` returns `null`. It has no element, so
there is nothing to animate, nothing to give an accessible name to, and no
surface for `prefers-reduced-motion` to have an opinion about — and, more to the
point, nothing that could shift the layout it is measuring.

---

## Correlation with the service

§18.1 puts `requestId`, `traceId` and `spanId` on every line the service logs,
and `CorrelationFilter` already accepts an inbound `X-Request-Id` and continues
the trace of an inbound W3C `traceparent`. **The field data uses those exact
names and those exact shapes** — `lib/rum/correlation.ts` copies the patterns
from `Correlation.java`, and `correlation.test.ts` reads that file and fails if
they drift.

Two halves:

1. **The beacon** carries the session's `traceId`. `sendBeacon` cannot set a
   request header, which is why the identifiers are fields of the payload; the
   `fetch` fallback sets `X-Request-Id` and `traceparent` as well, and the
   endpoint prefers the headers when it has them — the same precedence
   `CorrelationFilter` applies.
2. **`apps/web/instrumentation-client.ts`** wraps `window.fetch` for a sampled
   session and puts the same `traceId` on every same-origin `/v1` request, with
   a fresh span per request. That is what makes "this session's LCP was nine
   seconds" answerable with "and here is what the server was doing".

So: `rum.metric` lines and the service's request lines join on `traceId`.

Wrapping `fetch` is heavy-handed and is a stopgap. It is done in
`instrumentation-client.ts` because that file runs **before React hydrates**,
which is the only point at which a wrapper can be in place before the first API
call a component makes; a React effect runs too late. It only ever touches
same-origin `/v1` requests, it never overwrites a header a caller already set —
so the day `lib/api/client.ts` propagates the trace itself, this stops doing it
rather than conflicting with it — and every failure path returns the original
call unchanged.

---

## The endpoint

`POST /api/rum`, same-origin, unauthenticated. It is a public write, and it is
treated as one.

| Condition | Answer |
|---|---|
| Not `POST` | `405`, with `Allow` |
| Not `application/json` | `415` |
| Over 8 KiB, declared or actual | `413` |
| Over the per-caller or the global rate limit | `429`, `Retry-After`, `X-RateLimit-*` |
| Anything the schema refuses | `400`, naming a reason from a closed set |
| Accepted | `204`, with `X-Request-Id` and `X-Trace-Id` |

Cheapest first, and the rate limit **before** the parse — a caller being refused
for volume should not be costing a JSON parse per refusal.

The refusal reason is one of nine fixed strings and never quotes the input back.
A validator that echoes what was wrong with a payload is an oracle.

### Rate limiting, and what it does not do

Two sliding windows in the process's heap: **30 requests a minute per caller**
and **600 a minute in total**.

Like `az.ideanest.shared.ratelimit.InMemoryRateLimiter`, which it is shaped
after, this is **correct for one instance and wrong for two** — two replicas
enforce two separate limits. The shared counter belongs in shared storage.

The per-caller bucket is also **spoofable, and known to be**. A Next route
handler cannot see the socket's peer address, so `X-Forwarded-For` is the only
candidate, and the service refuses to trust that header for precisely the right
reason: with no proxy in front, a client picks its own bucket by inventing one.
Behind the proxy the bucket is the header's **last** hop (#587), the one Coolify's
Traefik appends — a client can only write to the left of it — then `X-Real-IP`.
That is the hop the API's `RemoteIpValve` settles on too (`ops/deploy/README.md`).
The global limiter is what actually holds — the worst a caller rotating a
thousand fake addresses achieves is to spend the endpoint's own budget, which is
a denial of monitoring rather than of the product, and shows up as a flood of
429s rather than as a quiet gigabyte of forged samples. The durable fix is the
edge WAF of §14.4 and a shared counter.

Forged *content* is bounded separately: values outside a plausible range are
refused, so one payload claiming an LCP of `1e308` cannot move a percentile.
Ratings and timestamps are derived server-side rather than read off the wire.

---

## Where the data goes

**One structured JSON line per sample, to stdout.** That is the whole sink.

```json
{"event":"rum.metric","at":"2026-08-18T09:00:00.000Z","requestId":"…","traceId":"…","spanId":"…","sessionId":"…","route":"/discover","metric":"LCP","value":1822,"rating":"good","navigationType":"navigate","connection":"4g","device":"mobile"}
```

### There is no analytics vendor, and that is a decision

The obvious thing to do with field data is to post it to a third party who draws
the graphs. Doing that would route every visitor's page views through somebody
else's servers, add a processor to whatever §17.4 and §22 have to say about it,
and commit the platform to a contract — **none of which is a frontend
implementation detail to be settled inside a pull request about
instrumentation.** `docs/architecture.md` §14.2 lists "Analytics — product
analytics with feature flags" as a choice not yet made. It stays not yet made.

### What a production sink needs to be

§14.4 already names the monitoring stack the platform expects: **Prometheus,
Grafana, Loki**. In a deployed environment the `rum.metric` line is collected by
whatever collects the application's other lines — Loki — and the p75 is a query
rather than a product. Concretely, a production sink needs:

- **Log collection from the web application's stdout.** Not a new pipeline; the
  same one the service uses.
- **A nearest-rank p75 per `route` × `metric`, over a rolling 28-day window.**
  Twenty-eight days is what CrUX reports over, so the number stays comparable
  with the one Search Console shows for the same site.
- **Sample counts published beside every percentile**, so a figure computed from
  forty sessions can be disbelieved on sight.
- **Retention measured in weeks, not years.** Nothing here identifies anybody,
  and a series of aggregates is what the question needs.

Alerting on those percentiles is **not** built here. §18.3's alert table is
entirely server-side, and a field alert wants a stable baseline first — which,
per §11.4, this platform does not have.

### Locally

The endpoint keeps the last 5,000 records in memory and will print the table:

```bash
pnpm --filter @ideanest/web dev
# …use the app…
curl http://localhost:3000/api/rum
```

```
| Route | Metric | Samples | p75 |
|---|---|---:|---:|
| `/discover` | CLS | 12 | 0.041 (good) |
| `/discover` | LCP | 12 | 2310 ms (good) |
```

The buffer is per process and empty after a restart. It is **off in production
by default** — a public endpoint returning aggregated performance data is
something to turn on deliberately, not to discover — and `GET` then answers
`404` rather than `403`, because a public endpoint should not confirm there is
something there to be enabled.

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_IDEANEST_RUM_SAMPLE_RATE` | `1` | Fraction of sessions measured. `0` disables collection entirely. Inlined at build time |
| `IDEANEST_RUM_LOCAL_SINK` | on outside production | The in-memory buffer and `GET /api/rum`. Set `true` to keep it under `next start`, which runs as production on a laptop too |

---

## Named gaps

- **No alerting on field percentiles.** See above: a baseline is needed first,
  and #138 owns the platform's metrics and alerting.
- **The rate limiter and the local buffer are per process.** Both are correct
  for the single-instance deployment and wrong for two.
- **`lib/api/client.ts` does not propagate the trace itself.** The `fetch`
  wrapper in `instrumentation-client.ts` does it from outside, which works and
  is not where it belongs. Moving it into the client is a change to a file this
  work did not own.
- **A 404 reports as `(unrecognised)`.** A 404's pathname is the one the visitor
  asked for, so `/_not-found` cannot be told apart from a mistyped campaign URL
  without reading the path — which is the thing the route mapper refuses to do.
- **A new route reports as `(unrecognised)` until it is added to
  `ROUTE_PATTERNS`.** That is deliberate: unmeasured is visible in the summary,
  whereas a fallback that reported the raw path would be a leak nobody would
  notice. A test asserts every declared pattern also has a bundle budget.
