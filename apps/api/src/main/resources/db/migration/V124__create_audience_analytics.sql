-- Audience analytics (#633, epic #632): how many people visit the site, open a campaign
-- and click a campaign card, per Asia/Baku day -- without a cookie, without a consent
-- banner, and without storing anybody's address.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DROP TABLE IF EXISTS audience_hourly;
--   DROP TABLE IF EXISTS audience_seen;
--   DROP TABLE IF EXISTS audience_day_salts;
--
--   Safe under a rolling deployment in the forward direction: three new tables the
--   previous release neither reads nor writes. A reverse loses the figures, and
--   nothing else is derived from them. `projects.view_count` (V125) is a separate
--   step and outlives these tables if only this is reversed.
-- ---------------------------------------------------------------------------
--
-- WHO A "PERSON" IS. The owner's decision of 2026-11-07: no cookie and no stored
-- address. A visitor is HMAC-SHA256(day salt, client address "|" user agent),
-- computed per request and kept only as long as the day it identifies. The salt is
-- random, one per Baku day, and is deleted with the day's markers once the day and
-- one more have passed -- after which nothing on the platform can recompute a
-- visitor key from an address, which is the property that makes this an aggregate
-- rather than a tracking table. The consequence is stated on every screen that shows
-- it: a multi-day figure is daily visitors summed, so somebody who came on two days
-- counts twice.
--
-- THREE TABLES, AND ONLY ONE OF THEM IS KEPT.
--
--   audience_day_salts  the day's random key. Two rows at most outlive a cleanup
--                       pass: today's and yesterday's (the grace for an event
--                       recorded across midnight).
--   audience_seen       "this visitor has already been counted for this, today".
--                       The INSERT ... ON CONFLICT DO NOTHING that writes a marker
--                       is what decides whether an event is a person's first of the
--                       day; an inserted row says yes. Deleted with the salts.
--   audience_hourly     the figures: counts per Baku hour, campaign, country,
--                       platform and card surface. No visitor key, no address, no
--                       user agent -- nothing personal, so it is kept.
--
-- The marker's kind is a smallint (1 VISIT, 2 VIEW, 3 CLICK) because the table's
-- whole working set is rewritten daily and a text column would triple its key.
-- A site visit has no campaign and every other kind has one, and the CHECK says so.
--
-- `project_id` on the markers is not a foreign key. They live for two days at most
-- and nothing ever follows the reference; a marker that outlives its campaign by a
-- day is harmless and gone at the next pass. The figures are different -- they are
-- kept, so `audience_hourly` cascades with its campaign.

CREATE TABLE audience_day_salts (
    day   date  PRIMARY KEY,
    salt  bytea NOT NULL,

    CONSTRAINT audience_day_salts_salt_length CHECK (octet_length(salt) = 32)
);

CREATE TABLE audience_seen (
    day           date     NOT NULL,
    visitor_hash  bytea    NOT NULL,
    kind          smallint NOT NULL,
    project_id    uuid,

    CONSTRAINT audience_seen_hash_length CHECK (octet_length(visitor_hash) = 32),
    CONSTRAINT audience_seen_kind_known CHECK (kind IN (1, 2, 3)),
    CONSTRAINT audience_seen_campaign_matches_kind CHECK ((kind = 1) = (project_id IS NULL))
);

-- One marker per visitor, kind and campaign a day. The COALESCE folds the site
-- scope's NULL into a value so that two site visits by one visitor conflict, which a
-- plain unique constraint would not do: NULLs are distinct there.
CREATE UNIQUE INDEX audience_seen_key ON audience_seen (
    day, visitor_hash, kind, (COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)));

CREATE TABLE audience_hourly (
    -- The start of a Baku hour, as an instant. Asia/Baku is a whole-hour offset, so
    -- this is also the start of a UTC hour; the writer truncates in the zone anyway.
    hour        timestamptz NOT NULL,
    -- NULL for the site as a whole (VISIT); a campaign for VIEW and CLICK.
    project_id  uuid        REFERENCES projects (id) ON DELETE CASCADE,
    -- ISO 3166-1 alpha-2, or ZZ (unknown), which is ISO's own user-assigned code for it.
    country     char(2)     NOT NULL,
    platform    varchar(8)  NOT NULL,
    -- Where a card was clicked. NONE on every row that is not a click, so that the
    -- unique key below has no NULL in it.
    surface     varchar(16) NOT NULL DEFAULT 'NONE',
    visitors    integer     NOT NULL DEFAULT 0,
    page_views  integer     NOT NULL DEFAULT 0,
    views       integer     NOT NULL DEFAULT 0,
    clicks      integer     NOT NULL DEFAULT 0,

    CONSTRAINT audience_hourly_country_shape CHECK (country ~ '^[A-Z]{2}$'),
    CONSTRAINT audience_hourly_platform_known CHECK (platform IN ('WEB', 'IOS', 'ANDROID')),
    CONSTRAINT audience_hourly_surface_known CHECK (surface IN (
        'NONE', 'HOME', 'DISCOVER', 'SEARCH', 'CATEGORY', 'COLLECTION', 'PROFILE', 'SAVED', 'OTHER')),
    CONSTRAINT audience_hourly_counts_not_negative CHECK (
        visitors >= 0 AND page_views >= 0 AND views >= 0 AND clicks >= 0),
    -- Site rows count visits; campaign rows count views and clicks. Never both.
    CONSTRAINT audience_hourly_site_counts CHECK (
        project_id IS NOT NULL OR (views = 0 AND clicks = 0 AND surface = 'NONE')),
    CONSTRAINT audience_hourly_campaign_counts CHECK (
        project_id IS NULL OR (visitors = 0 AND page_views = 0))
);

-- The upsert's target: one row per hour, scope, country, platform and surface.
-- Leading on the hour, it also serves the platform-wide series.
CREATE UNIQUE INDEX audience_hourly_key ON audience_hourly (
    hour,
    (COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    country,
    platform,
    surface);

-- The site's own reads: visitors, page views, countries, platforms over a window.
CREATE INDEX audience_hourly_site_idx ON audience_hourly (hour) WHERE project_id IS NULL;

-- One campaign's reads, and the cascade when a campaign is deleted.
CREATE INDEX audience_hourly_project_idx ON audience_hourly (project_id, hour) WHERE project_id IS NOT NULL;

COMMENT ON TABLE audience_day_salts IS
    'One random HMAC key per Asia/Baku day for audience visitor keys. Deleted by audience-cleanup once older than yesterday, after which a visitor key cannot be recomputed from an address.';
COMMENT ON TABLE audience_seen IS
    'First-of-the-day markers: an inserted row means the event was the visitor''s first of its kind (and campaign) that day. No address or user agent, only the day-salted HMAC. Deleted with the salts.';
COMMENT ON TABLE audience_hourly IS
    'Audience counts per Asia/Baku hour, campaign (NULL = site), country, platform and card surface. Aggregate only; kept.';
