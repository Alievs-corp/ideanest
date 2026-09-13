-- IDN-EXT-01 (#40): refunds the platform issues on its own.
--
-- Every backer of a campaign that ends below its threshold, or is suspended or
-- cancelled, is refunded in full -- and nobody on the staff asked for each of
-- those refunds. V53 required `requested_by` to name an account, because a
-- refund with no author is one nobody can be asked about. A system refund does
-- have an author: the rule that required it, recorded in `reason`. So the column
-- may be null exactly when the reason is one the platform acts on by itself --
-- V6's `project_state_transitions` answers "who moved this campaign" the same way
-- for the finaliser.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   Check first: SELECT count(*) FROM refunds WHERE requested_by IS NULL;
--   If that is zero:
--     ALTER TABLE refunds DROP CONSTRAINT refunds_system_refunds_are_campaign_refunds;
--     ALTER TABLE refunds ALTER COLUMN requested_by SET NOT NULL;
--   If it is not, those refunds were issued and settled with real money; they need
--   an author assigned before the column can be tightened.
-- ---------------------------------------------------------------------------
--
-- Expand only: loosening NOT NULL is safe under rolling deployment -- a node on
-- the previous release always writes an author, and this constraint admits it.

ALTER TABLE refunds ALTER COLUMN requested_by DROP NOT NULL;

ALTER TABLE refunds ADD CONSTRAINT refunds_system_refunds_are_campaign_refunds CHECK (
    requested_by IS NOT NULL OR reason IN ('CAMPAIGN_FAILED', 'CAMPAIGN_HALTED')
);

COMMENT ON COLUMN refunds.requested_by IS
    'The staff account that issued the refund, or null for a refund the platform issued itself '
    'because the campaign failed or was halted (IDN-EXT-01, #40).';
