-- How many people have opened a campaign, all time (#633): the number on its card.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DROP TRIGGER projects_set_updated_at ON projects;
--   CREATE TRIGGER projects_set_updated_at
--       BEFORE UPDATE ON projects
--       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--   ALTER TABLE projects
--       DROP CONSTRAINT IF EXISTS projects_view_count_not_negative,
--       DROP COLUMN IF EXISTS view_count;
--
--   Safe under a rolling deployment in the forward direction: the column has a
--   default, so an instance of the previous release, which neither maps nor writes
--   it, still inserts a valid row, and the trigger behaves exactly as before for
--   every statement that does not change the new column. A reverse loses the
--   counts; `audience_hourly` (V124) still holds the views they were summed from.
-- ---------------------------------------------------------------------------
--
-- The sum of daily unique viewers, which is what a card can honestly say: a person
-- who opened a campaign on three days is three, the same rule every audience figure
-- follows. Denormalised for the reason `backers_count` is: a feed renders it on
-- every card, and summing `audience_hourly` per card per page is the scan that
-- column exists to avoid. Incremented in the transaction that records a first view
-- of the day, so it never drifts from the figures it is a total of.
--
-- THE TRIGGER, AND WHY IT IS REPLACED. `projects_set_updated_at` (V6) stamps
-- `updated_at` on every UPDATE of the row, and the editor shows that column as
-- "last saved". A view is not an edit: without the WHEN below, the first visitor of
-- the day would move a campaign's "last saved" to the moment somebody read it. Only
-- the counter's own statement changes `view_count`, so a statement that changes it
-- is exactly the one that must not stamp the row.

ALTER TABLE projects
    ADD COLUMN view_count bigint NOT NULL DEFAULT 0;

ALTER TABLE projects
    ADD CONSTRAINT projects_view_count_not_negative CHECK (view_count >= 0);

DROP TRIGGER projects_set_updated_at ON projects;

CREATE TRIGGER projects_set_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    WHEN (OLD.view_count IS NOT DISTINCT FROM NEW.view_count)
    EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN projects.view_count IS
    'Daily unique viewers summed, all time (#633). Incremented with a first-of-the-day view in audience_hourly; does not move updated_at.';
