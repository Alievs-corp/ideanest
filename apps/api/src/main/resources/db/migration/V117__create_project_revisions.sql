-- Edits to a launched campaign that wait for a moderator (#558).
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DROP TABLE IF EXISTS project_revisions;
--
--   Safe under a rolling deployment in the forward direction: nothing reads the
--   table until the new release is serving, and the previous release neither
--   maps nor writes it. A reverse loses every edit still waiting for review and
--   the record of every decision; the live campaigns are untouched, because a
--   revision never writes `projects` until it is approved.
-- ---------------------------------------------------------------------------
--
-- Until now a creator's edit to a live campaign was public the moment it was
-- saved. A launched campaign now keeps what the public sees (`projects`) apart
-- from what its creator is working on (this table), and a moderator decides when
-- the second becomes the first.
--
-- One row is one proposal: `content` is the whole of the campaign's editable
-- writing as the creator wants it to be (title, blurb, category, story, risks,
-- cover, video, countries), not a diff. A whole document is what the editor
-- shows, what the moderator compares against `projects`, and what approval copies
-- across; a diff would have to be replayed against a campaign that could have
-- moved, and nothing else can move these fields while a revision is open.
--
-- Status:
--   DRAFT      the creator is still editing; a moderator does not see it
--   PENDING    submitted; waiting in the moderators' queue
--   APPROVED   applied to `projects`
--   REJECTED   refused with `reason`; `projects` untouched
--   WITHDRAWN  discarded by the creator
-- An edit to a PENDING revision moves it back to DRAFT, so a moderator never
-- approves a document that changed after they opened it.
--
-- At most one open (DRAFT or PENDING) revision per campaign: the partial unique
-- index. Closed rows stay as the history.

CREATE TABLE project_revisions (
    id           uuid        PRIMARY KEY,
    project_id   uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    status       text        NOT NULL,
    content      jsonb       NOT NULL,
    -- The account that saved last. Several collaborators can feed one revision.
    author_id    uuid        NOT NULL REFERENCES users (id),
    submitted_at timestamptz,
    decided_at   timestamptz,
    decided_by   uuid        REFERENCES users (id),
    -- A moderator's explanation. Required for a rejection, because the creator is
    -- shown it; optional for an approval.
    reason       text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT project_revisions_status_known
        CHECK (status IN ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
    CONSTRAINT project_revisions_pending_is_submitted
        CHECK (status <> 'PENDING' OR submitted_at IS NOT NULL),
    CONSTRAINT project_revisions_decision_is_complete
        CHECK ((status IN ('APPROVED', 'REJECTED')) = (decided_at IS NOT NULL AND decided_by IS NOT NULL)),
    CONSTRAINT project_revisions_rejection_has_reason
        CHECK (status <> 'REJECTED' OR (reason IS NOT NULL AND reason !~ '^\s*$'))
);

CREATE UNIQUE INDEX project_revisions_one_open_per_project
    ON project_revisions (project_id)
    WHERE status IN ('DRAFT', 'PENDING');

-- The moderators' queue: oldest submission first.
CREATE INDEX project_revisions_queue_idx
    ON project_revisions (submitted_at)
    WHERE status = 'PENDING';

CREATE INDEX project_revisions_project_idx
    ON project_revisions (project_id, created_at DESC);

CREATE TRIGGER project_revisions_set_updated_at
    BEFORE UPDATE ON project_revisions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE project_revisions IS
    'Edits to a launched campaign: the creator''s working copy until a moderator approves it. See V117.';
