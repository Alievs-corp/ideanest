-- The index behind "the campaigns for this country" (#533).
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DROP INDEX IF EXISTS projects_discovery_countries_idx;
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. One index; both releases are served correctly with or
-- without it.
-- ---------------------------------------------------------------------------
--
-- A visitor now browses for one country, and every campaign list the public
-- reads (`/v1/discover`, its facets, `/v1/search`, the suggestions and the
-- collections) narrows to `countries @> ARRAY[:market]`. Containment on an array
-- is what GIN answers, and the default `array_ops` operator class supports `@>`.
--
-- Partial over the nine publicly visible states, as V12's discovery indexes are,
-- because a draft is never in any of those lists. Not CONCURRENTLY, for V109's
-- reason: Flyway's lock transaction makes a concurrent build wait on itself.

CREATE INDEX projects_discovery_countries_idx
    ON projects USING gin (countries)
    WHERE state IN (
        'PRELAUNCH', 'LIVE', 'CANCELED', 'SUCCESSFUL', 'UNSUCCESSFUL',
        'COLLECTING', 'LATE_PLEDGE', 'FULFILLING', 'COMPLETED'
    );
