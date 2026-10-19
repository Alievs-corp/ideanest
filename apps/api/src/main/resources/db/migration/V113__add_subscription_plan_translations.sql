-- A plan carries its name and description in the platform's other languages.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   ALTER TABLE subscription_plans DROP CONSTRAINT subscription_plans_translations_shape;
--   ALTER TABLE subscription_plans DROP COLUMN translations;
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. One column with a default, which the previous release does
-- not map and never writes: a plan it saves keeps the translations it had.
-- ---------------------------------------------------------------------------
--
-- `name` and `description` stay the Azerbaijani text, which is §21.1's primary
-- language and what every reader falls back to. This column holds the others,
-- keyed by locale code: {"en": {"name": "...", "description": "..."}, ...}.
-- A language with no entry is read in Azerbaijani, so a plan added before this
-- column existed reads exactly as it did.

ALTER TABLE subscription_plans
    ADD COLUMN translations jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE subscription_plans
    ADD CONSTRAINT subscription_plans_translations_shape
        CHECK (jsonb_typeof(translations) = 'object');
