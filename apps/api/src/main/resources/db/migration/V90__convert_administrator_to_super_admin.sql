-- ADMINISTRATOR becomes SUPER_ADMIN for good. Issue #212, the contract half of #203, part of #202.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   ALTER TABLE staff_role_grants DROP CONSTRAINT staff_role_grants_known;
--   ALTER TABLE staff_role_grants ADD CONSTRAINT staff_role_grants_known CHECK (
--       role IN ('MODERATOR', 'CURATOR', 'FINANCE', 'COMPLIANCE', 'ADMINISTRATOR', 'SUPER_ADMIN', 'PARTNER'));
--   UPDATE staff_role_grants SET role = 'ADMINISTRATOR' WHERE role = 'SUPER_ADMIN';
--
--   The constraint is widened first so the UPDATE is allowed to write the old name. Deploy
--   the V88 release of the application before running it: the release this migration ships
--   with has no `ADMINISTRATOR` in `StaffRole` and would fail to read the rows.
--
--   Lossy in one way worth naming and harmless in practice: after the reversal every
--   SUPER_ADMIN row reads ADMINISTRATOR, including any granted as SUPER_ADMIN after V88. The
--   two carry exactly the same capabilities, so nobody's access changes. A row that was
--   removed because its account also held SUPER_ADMIN (see below) is not brought back; the
--   account still holds the highest role.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: this is the contract half of V88's expand, and the only place in the rename that
-- removes anything.
--
-- What is removed is the value `ADMINISTRATOR`: rows holding it are converted to
-- SUPER_ADMIN, and the CHECK no longer allows it. Nothing else is dropped, and no access
-- changes, because the two carried the same capabilities from V88 to here.
--
-- Safe under rolling deployment because of the order the two releases shipped in. V88's
-- release taught every instance both names before this migration existed, so while this
-- release rolls out an instance still running V88's code reads SUPER_ADMIN correctly. The one
-- thing an old instance cannot do after this runs is grant the name ADMINISTRATOR, and it
-- never does: since #203 the console offers SUPER_ADMIN for new grants, and the bootstrap
-- accounts are a configuration list and not rows.
-- ---------------------------------------------------------------------------
--
-- A person can hold two rows for the same account, so a plain UPDATE could collide on the
-- primary key (account_id, role) with a SUPER_ADMIN row granted after V88. Those accounts
-- already hold the highest role, so the old row is simply deleted; everybody else is
-- converted in place, which keeps `granted_at`, `granted_by` and `note`: who let this person
-- in, and why, is still the original answer.

DELETE FROM staff_role_grants old
 WHERE old.role = 'ADMINISTRATOR'
   AND EXISTS (
       SELECT 1
         FROM staff_role_grants current
        WHERE current.account_id = old.account_id
          AND current.role = 'SUPER_ADMIN');

UPDATE staff_role_grants
   SET role = 'SUPER_ADMIN'
 WHERE role = 'ADMINISTRATOR';

ALTER TABLE staff_role_grants
    DROP CONSTRAINT staff_role_grants_known;

ALTER TABLE staff_role_grants
    ADD CONSTRAINT staff_role_grants_known CHECK (
        role IN ('MODERATOR', 'CURATOR', 'FINANCE', 'COMPLIANCE', 'SUPER_ADMIN', 'PARTNER'));

COMMENT ON COLUMN staff_role_grants.role IS
    'One of StaffRole''s six: MODERATOR, CURATOR, FINANCE, COMPLIANCE, SUPER_ADMIN (#203, #212; formerly ADMINISTRATOR) and PARTNER (#203), which holds only VIEW_PARTNER_STATISTICS.';
