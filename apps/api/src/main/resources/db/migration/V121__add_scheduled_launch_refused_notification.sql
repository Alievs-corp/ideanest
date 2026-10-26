-- A creator is told when their campaign did not open at its launch time because
-- their plan does not cover it. Issue #587.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   once no notification has the type
--   (SELECT count(*) FROM notifications WHERE type = 'SCHEDULED_LAUNCH_REFUSED'),
--   restore V103's notifications_type_known without it.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. One widened CHECK whose old list the new one contains.
-- ---------------------------------------------------------------------------
--
-- The scheduled launch has refused a campaign over its creator's plan since
-- #587 and cleared its launch time, so nothing opens it on its own again. That
-- used to reach a log line and nobody else; it now reaches the creator through
-- `project.scheduled_launch_refused`, and the row needs a type the table knows.

ALTER TABLE notifications
    DROP CONSTRAINT notifications_type_known;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_type_known CHECK (
        type IN (
            'PLEDGE_CONFIRMED', 'PLEDGE_EDITED',
            'GOAL_REACHED', 'DEADLINE_48H', 'DEADLINE_24H',
            'CAMPAIGN_SUCCEEDED', 'CAMPAIGN_UNSUCCESSFUL', 'CAMPAIGN_EXTENDED', 'PROJECT_APPROVED',
            'SCHEDULED_LAUNCH_REFUSED',
            'UPDATE_DUE_SOON',
            'PAYMENT_COLLECTED', 'PAYMENT_FAILED', 'FINAL_PAYMENT_WARNING', 'PAYOUT_SENT',
            'WITHDRAWAL_REQUESTED', 'PAYOUT_DETAILS_NEEDED', 'REFUND_NEEDS_BANK_DETAILS',
            'REFUND_SENT_BY_BANK',
            'SUBSCRIPTION_RENEWAL_DUE', 'SUBSCRIPTION_LAPSED', 'SUBSCRIPTION_RENEWED',
            'NEW_UPDATE_PUBLISHED', 'COMMENT_REPLY', 'DIRECT_MESSAGE',
            'SURVEY_AVAILABLE', 'SURVEY_OVERDUE', 'REWARD_SHIPPED',
            'FOLLOWED_CREATOR_LAUNCHED', 'LAUNCH_REMINDER', 'SAVED_PROJECT_ENDING_SOON',
            'NEW_DEVICE_SIGN_IN'));
