-- A partner's agreed percentage, and the console sections opened to them. Issue #204, part of #202.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DROP TRIGGER IF EXISTS partner_profiles_total_within_100 ON partner_profiles;
--   DROP FUNCTION IF EXISTS partner_profiles_check_total();
--   DROP TABLE IF EXISTS partner_section_grants;
--   DROP TABLE IF EXISTS partner_profiles;
--
--   Lossy in the obvious way: every partner's percentage and opened sections are gone,
--   and a PARTNER grant in staff_role_grants is left holding a role with no profile,
--   which opens nothing (the statistics endpoint refuses an account without one). Export
--   `partner_profiles` first if the percentages are needed again. The audit rows written
--   by `partner.profile_saved` and `partner.profile_removed` survive and record every
--   percentage that was ever set.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. This migration only adds; nothing existing is altered or removed, so
-- it is safe under rolling deployment in both directions. An old instance never reads
-- these tables, and a new one that finds them empty treats every PARTNER as having no
-- profile, which is the fail-closed answer.
-- ---------------------------------------------------------------------------
--
-- WHY A PERCENTAGE IS A ROW AND NOT A COLUMN ON users
-- ---------------------------------------------------------------------------
--
-- Almost no account is a partner, and what makes somebody one is a decision made by a
-- super admin about a business relationship, with its own author and its own history.
-- A nullable column on `users` would put that relationship in the table every request
-- loads, and would have no place for who agreed it or when it last changed. The row does.
--
-- WHY THE PERCENTAGE IS numeric(5,2) AND NOT AN INTEGER
-- ---------------------------------------------------------------------------
--
-- 33.33 is an honest way for three partners to divide a platform, and forcing whole
-- numbers would push somebody to 34/33/33 and call it equal. Money is never float on
-- this platform (CLAUDE.md), and neither is a fraction of money.
--
-- WHY THE 100 TOTAL IS ENFORCED HERE AS WELL AS IN THE SERVICE
-- ---------------------------------------------------------------------------
--
-- "The partners' shares may not add up to more than the whole" is a rule about the data,
-- not about one endpoint, for V21's reason: a rule only the application knows is a rule
-- that holds until somebody writes an UPDATE by hand during an incident. The service
-- checks first so it can say how much is left. This trigger is the last line and the
-- only one that holds against two concurrent writers: it takes the same advisory lock
-- the service takes, so the second transaction waits for the first to commit and then
-- sums a table that includes it.
--
-- WHY THE SECTIONS ARE A CLOSED, SHORT LIST
-- ---------------------------------------------------------------------------
--
-- A partner's extra access is computed from these rows into capabilities at request
-- time (StaffDirectory), so the API, and not the browser, is what refuses a section that
-- was not opened. Only sections whose screens show no individual transaction and no
-- unscaled platform figure may be opened to a partner, and the list is a CHECK so that
-- widening it is a migration somebody reads. AD-05 (payments and ledger), AD-06, AD-07,
-- AD-11 (fees, plans and revenue), AD-13 (platform analytics) and AD-14 (audit trail)
-- are not on it and cannot be added by an API call.

CREATE TABLE partner_profiles (
    account_id uuid PRIMARY KEY
        REFERENCES users (id) ON DELETE CASCADE,

    percentage numeric(5, 2) NOT NULL
        CONSTRAINT partner_profiles_percentage_range CHECK (percentage > 0 AND percentage <= 100),

    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NOT NULL
        REFERENCES users (id) ON DELETE RESTRICT,

    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid NOT NULL
        REFERENCES users (id) ON DELETE RESTRICT
);

COMMENT ON TABLE partner_profiles IS
    'The share of the platform''s financial statistics a PARTNER sees (#204). The real figures are never split or copied; the percentage is applied when a partner''s statistics are produced.';

CREATE TABLE partner_section_grants (
    account_id uuid NOT NULL
        REFERENCES partner_profiles (account_id) ON DELETE CASCADE,

    section text NOT NULL
        CONSTRAINT partner_section_grants_known CHECK (section IN ('CURATION', 'HEALTH')),

    CONSTRAINT partner_section_grants_pkey PRIMARY KEY (account_id, section)
);

COMMENT ON TABLE partner_section_grants IS
    'Console sections opened to a partner beyond their statistics (#204). Each maps to one capability in PartnerSection; only sections that show no individual transaction and no unscaled figure are allowed.';

CREATE FUNCTION partner_profiles_check_total() RETURNS trigger AS $$
BEGIN
    -- The same lock the service takes, so two concurrent writers are serialised and the
    -- second one sums a table that already contains the first.
    PERFORM pg_advisory_xact_lock(hashtext('partner_profiles_total'));

    IF (SELECT COALESCE(SUM(percentage), 0) FROM partner_profiles) > 100 THEN
        RAISE EXCEPTION 'partner percentages add up to more than 100'
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'partner_profiles_total_within_100';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER partner_profiles_total_within_100
    AFTER INSERT OR UPDATE OF percentage ON partner_profiles
    DEFERRABLE INITIALLY IMMEDIATE
    FOR EACH ROW
    EXECUTE FUNCTION partner_profiles_check_total();
