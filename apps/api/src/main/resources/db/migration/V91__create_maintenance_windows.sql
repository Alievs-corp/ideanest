-- Maintenance windows: when the platform is closed, and when readers are told so. Issue #214.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DROP TABLE IF EXISTS maintenance_windows;
--
--   Lossy only in history: every scheduled, running and past window is gone, and the
--   platform is open from the next snapshot refresh (at most ten seconds). The audit rows
--   written by `maintenance.window_*` survive and record every window that was ever set.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. This migration only adds a table; nothing existing is altered, so it is
-- safe under rolling deployment in both directions. An old instance never reads it, and a
-- new one that finds it empty answers "operational", which is today's behaviour.
-- ---------------------------------------------------------------------------
--
-- WHY A TABLE AND NOT A FEATURE FLAG
-- ---------------------------------------------------------------------------
--
-- A flag is on or off. Maintenance has a start, an end that may be unknown, and an
-- announcement period before the start, and it is scheduled ahead of time so that readers
-- are warned. Modelling that as a flag would mean an operator switching it on by hand at
-- 02:00 and nobody having been told. It keeps the flags' caching and audit discipline
-- (`MaintenanceWindows` holds the same ten-second snapshot and clears it on every edit)
-- but it is its own row.
--
-- ---------------------------------------------------------------------------
-- WHY AN EXCLUSION CONSTRAINT
-- ---------------------------------------------------------------------------
--
-- At most one window may be active or announced at a time: two overlapping windows would
-- give `GET /v1/status` two answers and a reader two banners. The service refuses an
-- overlap with a readable 409, and this constraint is what makes the refusal hold when two
-- administrators schedule at once on two instances. The span a window occupies is from
-- its announcement to its effective end -- `ended_at` when it was ended early, otherwise
-- `ends_at`, and open-ended when neither is set. A cancelled window occupies nothing.
-- Ranges need no extension: GiST supports `&&` on tstzrange natively.
-- ---------------------------------------------------------------------------

CREATE TABLE maintenance_windows (
    id uuid PRIMARY KEY,

    starts_at timestamptz NOT NULL,

    -- Null is "until further notice". Readers are then told no end, and clients retry on
    -- the contract's default interval.
    ends_at timestamptz,

    -- When the "planned maintenance" notice starts showing. The service defaults it to a
    -- day before the start and never sets it in the past, so a window scheduled now cannot
    -- claim a span that overlaps windows that already ended.
    announce_from timestamptz NOT NULL,

    -- Internal only: why, and who to ask. Never shown to readers and never in the public
    -- status response.
    note text
        CONSTRAINT maintenance_windows_note_bounded CHECK (note IS NULL OR length(note) <= 2000),

    -- The actor, not the subject: SET NULL so an erased account does not take the
    -- platform's maintenance history with it. The audit log names them regardless.
    created_by uuid REFERENCES users (id) ON DELETE SET NULL,

    created_at timestamptz NOT NULL DEFAULT now(),

    -- Set when an operator ends the window before its announced end.
    ended_at timestamptz,

    -- Set when an upcoming window is called off before it started.
    cancelled_at timestamptz,

    CONSTRAINT maintenance_windows_ends_after_start CHECK (ends_at IS NULL OR ends_at > starts_at),
    CONSTRAINT maintenance_windows_announced_before_start CHECK (announce_from <= starts_at),
    CONSTRAINT maintenance_windows_ended_after_start CHECK (ended_at IS NULL OR ended_at >= starts_at),
    CONSTRAINT maintenance_windows_ended_or_cancelled CHECK (ended_at IS NULL OR cancelled_at IS NULL),

    CONSTRAINT maintenance_windows_no_overlap EXCLUDE USING gist (
        tstzrange(announce_from, COALESCE(ended_at, ends_at), '[)') WITH &&
    ) WHERE (cancelled_at IS NULL)
);

-- The snapshot's read: every window that has not ended or been called off. A handful of
-- rows at most, read once per instance every ten seconds.
CREATE INDEX maintenance_windows_live ON maintenance_windows (starts_at)
    WHERE ended_at IS NULL AND cancelled_at IS NULL;

-- The console's "last twenty".
CREATE INDEX maintenance_windows_recent ON maintenance_windows (starts_at DESC);

COMMENT ON TABLE maintenance_windows IS
    'When the platform is closed for maintenance, and when readers are told (#214).';
