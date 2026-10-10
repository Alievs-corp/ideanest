# Observability

`docs/architecture.md` §18 and §8.4, issue #138. Two files, and both of them are
about the *service* rather than about the monitoring stack that reads them.

| File | What it is |
|---|---|
| `alerts.yml` | Prometheus alerting rules. All three of §8.4's conditions, plus the rule beside each one that catches the monitor having stopped |
| `prometheus.example.yml` | A scrape configuration to copy. The path, the credential and the rule file are what this repository owns; discovery and alert routing belong to the environment |

## Why the rules live here and not with Prometheus

Because a rule is a statement about this service. `LedgerImbalance` fires on a
series `PlatformMetrics` publishes, thresholded against what
`LedgerReconciliation` considers a finding, and describes what to do in terms of
`apps/api/README.md`. Kept in a monitoring repository, that rule drifts from the
code it describes and the drift is only discovered on the night it matters.

Keeping them here has one cost worth naming: deploying a rule change means
whatever syncs this directory to Prometheus has to run. That is a deployment
concern (#139) and it is a smaller problem than a rule nobody updated.

## What the service publishes

See "Metrics, tracing and alerting" in `apps/api/README.md` for the full table.
The short version:

- **`ideanest_ledger_reconciliation_*`** — whether the books balance, and when
  anybody last checked
- **`ideanest_payment_collection_attempts_total{outcome}`** — every collection
  attempt, by what came of it. A rate is not published; `alerts.yml` divides
  these, because the window is an operational decision
- **`ideanest_provider_available{provider}`** — the circuit breaker's own view.
  A provider that is not configured publishes no series at all
- **`ideanest_queue_waiting` / `ideanest_queue_dead`** — every queue on the
  platform, from the interface each owning module implements
- **`ideanest_payment_hosted_sweep_settled_total{outcome}`** and
  **`ideanest_payment_hosted_attention{reason}`** — payment pages settled
  without their callback, and the ones the sweep could not settle and left for
  somebody (#356)

Everything else — HTTP, JDBC, JVM, Hikari — comes from Spring Boot's own binders
and is not restated here.

## Getting a scrape working

1. Set `METRICS_SCRAPE_PASSWORD` on the service. **Without it there is no metrics
   endpoint** — not an unauthenticated one, none: the security chain that serves
   `/actuator/prometheus` is conditional on the credential, and the request falls
   through to the API's deny-by-default chain and gets a `401`.
2. Put the same value in a file Prometheus can read and point `password_file` at
   it. Not inline: this directory is checked in, and a secret in a checked-in
   file is in the history for ever even after the line is deleted.
3. Scrape over `https`. Basic sends the credential on every request, and a scrape
   is every fifteen seconds.

## Severity, and what it means to whoever is carrying the pager

`alerts.yml` uses two values and they are not a scale:

- **`page`** — somebody is woken up. Money is wrong, or is about to be.
- **`ticket`** — somebody looks during working hours. Something is degraded and
  is not losing anybody money while it waits.

Three rules page: the ledger not reconciling, more than a quarter of collections
failing, and a payment provider's breaker staying open. Everything else waits.

## Tracing

Off unless `TRACING_ENABLED=true` and `OTLP_TRACES_ENDPOINT` are set. There is no
collector configuration in this directory because there is nothing service-specific
to say about one: the exporter speaks OTLP over HTTP and any collector that
accepts it will do.

What is service-specific is already in the code: `CorrelationFilter` accepts and
mints W3C `traceparent`, so a request keeps its trace identifier in the log
stream whether or not spans are being exported. Turning tracing on adds the
spans, not the correlation.
