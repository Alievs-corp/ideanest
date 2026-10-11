-- Which published version of a legal document readers are shown, when an
-- administrator chose one in the console rather than taking the latest.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DROP TABLE IF EXISTS legal_document_selections;
--
--   Safe under a rolling deployment in both directions: the previous release
--   neither reads nor writes it, and without a row the latest effective
--   version is in force, which is the behaviour before this table existed.
-- ---------------------------------------------------------------------------
--
-- One row per kind at most. It names the governing (Azerbaijani) row of the
-- chosen version; the other languages of that version follow from the kind
-- and the version number. Publishing a new version deletes the row, so a
-- publication always takes over.

CREATE TABLE legal_document_selections (
    kind        text        PRIMARY KEY,
    document_id uuid        NOT NULL REFERENCES legal_documents (id) ON DELETE CASCADE,
    selected_by uuid        NOT NULL,
    selected_at timestamptz NOT NULL
);
