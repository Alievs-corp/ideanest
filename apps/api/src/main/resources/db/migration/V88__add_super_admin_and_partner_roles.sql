-- SUPER_ADMIN and PARTNER join the staff roles. Issue #203, part of #202.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DELETE FROM staff_role_grants WHERE role IN ('SUPER_ADMIN', 'PARTNER');
--   ALTER TABLE staff_role_grants DROP CONSTRAINT staff_role_grants_known;
--   ALTER TABLE staff_role_grants ADD CONSTRAINT staff_role_grants_known CHECK (
--       role IN ('MODERATOR', 'CURATOR', 'FINANCE', 'COMPLIANCE', 'ADMINISTRATOR'));
--
--   The DELETE is not optional: the narrowed constraint cannot be satisfied while
--   a grant of either new role exists, so a reversal that leaves the rows fails
--   at the ALTER and leaves the table half-changed. What it costs is that every
--   account that held SUPER_ADMIN holds nothing, which is the fail-closed
--   direction. Re-grant ADMINISTRATOR to those accounts afterwards if they should
--   keep their access; the two roles carry the same capabilities.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none, and the `DROP CONSTRAINT` below is not one -- V47's argument,
-- unchanged, and V66 made it for the same constraint.
--
-- Nothing is removed. No table, no column, and no value any row currently holds:
-- the constraint on `staff_role_grants.role` is widened from five names to seven,
-- and every row that satisfied the old one satisfies the new one.
--
-- This is the EXPAND half of renaming ADMINISTRATOR to SUPER_ADMIN. The rename is
-- two releases on purpose. The role's name is stored in this column and read by
-- whichever application version is running, so during a rolling deployment an old
-- instance must never meet a role name it does not know. This release teaches the
-- application both names (same capabilities), and a later one converts the rows
-- and removes ADMINISTRATOR.
-- ---------------------------------------------------------------------------
--
-- WHY PARTNER IS A ROLE AND NOT A FLAG ON AN ACCOUNT
-- ---------------------------------------------------------------------------
--
-- A partner sees an agreed share of the platform's financial statistics and
-- nothing else. That is exactly the shape a role already has: a named set of
-- capabilities held by an account, granted and withdrawn by somebody with
-- ADMINISTER_STAFF, and audited under their name. A separate "is partner" column
-- would be a second place to decide who is staff, and a rule only one of the two
-- places knows is the rule that fails open.
--
-- The percentage and the modules a partner may open are not in this migration.
-- They arrive with the partner profile in #204, and until they do a PARTNER grant
-- opens nothing: the role holds one capability, VIEW_PARTNER_STATISTICS, and the
-- endpoint behind it refuses an account that has no profile.

ALTER TABLE staff_role_grants
    DROP CONSTRAINT staff_role_grants_known;

ALTER TABLE staff_role_grants
    ADD CONSTRAINT staff_role_grants_known CHECK (
        role IN ('MODERATOR', 'CURATOR', 'FINANCE', 'COMPLIANCE', 'ADMINISTRATOR', 'SUPER_ADMIN', 'PARTNER'));

COMMENT ON COLUMN staff_role_grants.role IS
    'One of StaffRole''s seven. SUPER_ADMIN (#203) replaces ADMINISTRATOR and carries the same capabilities until the contract release removes the old name. PARTNER (#203) holds only VIEW_PARTNER_STATISTICS.';
