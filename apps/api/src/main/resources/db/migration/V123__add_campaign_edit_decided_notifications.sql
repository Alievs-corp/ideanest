-- A creator is told when a moderator approves or refuses an edit to their launched
-- campaign. Issue #568.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   once no notification has either type
--   (SELECT count(*) FROM notifications
--     WHERE type IN ('CAMPAIGN_EDIT_APPROVED', 'CAMPAIGN_EDIT_REJECTED')),
--   restore V122's notifications_type_known without them.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. One widened CHECK whose old list the new one contains.
-- ---------------------------------------------------------------------------
--
-- `project.revision_decided` has been written to the outbox since #558 and
-- nothing read it, so a creator learned of a refused edit only by opening the
-- editor. It now reaches them, and the rows need types the table knows.

ALTER TABLE notifications
    DROP CONSTRAINT notifications_type_known;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_type_known CHECK (
        type IN (
            'PLEDGE_CONFIRMED', 'PLEDGE_EDITED',
            'GOAL_REACHED', 'DEADLINE_48H', 'DEADLINE_24H',
            'CAMPAIGN_SUCCEEDED', 'CAMPAIGN_UNSUCCESSFUL', 'CAMPAIGN_EXTENDED', 'PROJECT_APPROVED',
            'PROJECT_APPROVED_SCHEDULED', 'SCHEDULED_LAUNCH_REFUSED',
            'CAMPAIGN_EDIT_APPROVED', 'CAMPAIGN_EDIT_REJECTED',
            'UPDATE_DUE_SOON',
            'PAYMENT_COLLECTED', 'PAYMENT_FAILED', 'FINAL_PAYMENT_WARNING', 'PAYOUT_SENT',
            'WITHDRAWAL_REQUESTED', 'PAYOUT_DETAILS_NEEDED', 'REFUND_NEEDS_BANK_DETAILS',
            'REFUND_SENT_BY_BANK',
            'SUBSCRIPTION_RENEWAL_DUE', 'SUBSCRIPTION_LAPSED', 'SUBSCRIPTION_RENEWED',
            'NEW_UPDATE_PUBLISHED', 'COMMENT_REPLY', 'DIRECT_MESSAGE',
            'SURVEY_AVAILABLE', 'SURVEY_OVERDUE', 'REWARD_SHIPPED',
            'FOLLOWED_CREATOR_LAUNCHED', 'LAUNCH_REMINDER', 'SAVED_PROJECT_ENDING_SOON',
            'NEW_DEVICE_SIGN_IN'));
