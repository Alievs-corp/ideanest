-- A super admin decides what each staff role may do, from the console.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DROP TABLE staff_role_capability_overrides;
--
-- Every role then confers exactly what StaffRole says in code, which is what
-- it conferred before this table existed.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. A new table the previous release does not read: while both
-- run, the old one serves the code defaults and this one serves them adjusted.
-- ---------------------------------------------------------------------------
--
-- Overrides, not the whole matrix. StaffRole keeps each role's default set in
-- code, and a row here says one capability is added to or taken from it:
-- `granted = true` adds, `granted = false` removes. An empty table is the
-- platform as it was, and "reset to the default" is deleting a role's rows.
--
-- The alternative -- copying every role's full set in here -- would freeze the
-- defaults at the moment this ran. A capability added to MODERATOR in a later
-- release would then reach nobody until somebody remembered a migration for it,
-- and the failure would be a moderator refused a screen the code says is theirs.
--
-- Four roles only. SUPER_ADMIN holds everything by construction, and a super
-- admin who could narrow their own role could lock every administrator out of
-- the screen that would undo it. PARTNER is shaped per account, in
-- partner_section_grants (#204), and has no shared set to adjust.
--
-- `capability` is not constrained. The service parses it against
-- StaffCapability and ignores a value it does not know, so a capability removed
-- from the code in a later release leaves a harmless row rather than a failed
-- deployment; and a CHECK listing them would be a third copy of the list after
-- the enum and the console's.

CREATE TABLE staff_role_capability_overrides (
    role        text        NOT NULL,
    capability  text        NOT NULL,
    granted     boolean     NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    -- SET NULL rather than RESTRICT: a staff account erased under §17.4 must not
    -- be blocked by a setting it once changed. Who changed it is in the audit
    -- trail, `staff.role_capabilities_changed`, which does not cascade.
    updated_by  uuid        REFERENCES users (id) ON DELETE SET NULL,

    PRIMARY KEY (role, capability),
    CONSTRAINT staff_role_capability_overrides_role_known CHECK (
        role IN ('MODERATOR', 'CURATOR', 'FINANCE', 'COMPLIANCE')),
    CONSTRAINT staff_role_capability_overrides_capability_shape CHECK (
        capability ~ '^[A-Z][A-Z_]{1,63}$')
);

COMMENT ON TABLE staff_role_capability_overrides IS
    'Adjustments to StaffRole''s default capabilities, made by a super admin in the console. granted=true adds a capability to the role, false removes it. Read on every request, so a change applies on the next call.';
