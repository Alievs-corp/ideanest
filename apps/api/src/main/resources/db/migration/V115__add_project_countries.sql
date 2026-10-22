-- The countries a campaign is for, and so the countries its creator delivers
-- rewards to.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   ALTER TABLE projects
--       DROP CONSTRAINT IF EXISTS projects_countries_check,
--       DROP COLUMN IF EXISTS countries;
--
--   Safe under a rolling deployment in the forward direction: the column has a
--   default, so an instance of the previous release, which neither maps nor
--   writes it, still inserts a valid row. A reverse loses every creator's
--   choice; existing campaigns come back as Azerbaijan only when it is re-run.
-- ---------------------------------------------------------------------------
--
-- A visitor will be able to choose a country the way they choose a language and
-- see the campaigns that are for it. That browsing is a later change; this one
-- lets a creator say which countries their campaign is for, so the data exists
-- before anything filters on it.
--
-- `text[]` of ISO 3166-1 alpha-2 codes rather than a join table: the list is
-- short, always read whole with its campaign, and written whole by the editor.
-- The filter that comes later is `countries @> ARRAY[:country]`, which a GIN
-- index answers; it arrives with that query rather than before it.
--
-- Never empty. A campaign for no country is one nobody can back, so the editor
-- refuses to remove the last one and this refuses what the editor might miss.
-- Every campaign that exists today was made for Azerbaijan, which is also what a
-- new campaign starts with.

ALTER TABLE projects
    ADD COLUMN countries text[] NOT NULL DEFAULT ARRAY['AZ']::text[];

ALTER TABLE projects
    ADD CONSTRAINT projects_countries_check CHECK (
        cardinality(countries) BETWEEN 1 AND 300
        AND array_position(countries, NULL) IS NULL
        AND array_to_string(countries, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'
    );
