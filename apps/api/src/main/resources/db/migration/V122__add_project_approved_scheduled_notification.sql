-- A creator whose campaign was approved with a launch time still to come is told
-- when it opens, rather than that it is live. Issue #595.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   once no notification has the type
--   (SELECT count(*) FROM notifications WHERE type = 'PROJECT_APPROVED_SCHEDULED'),
--   restore V121's notifications_type_known without it.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. One widened CHECK whose old list the new one contains.
-- ---------------------------------------------------------------------------
--
-- Since #552 an approval publishes the campaign unless its launch time is still
-- to come, and then it waits in APPROVED for campaign-launcher. Both told the
-- creator PROJECT_APPROVED, whose copy says the campaign is live. The second now
-- has a type of its own that carries the launch time.

ALTER TABLE notifications
    DROP CONSTRAINT notifications_type_known;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_type_known CHECK (
        type IN (
            'PLEDGE_CONFIRMED', 'PLEDGE_EDITED',
            'GOAL_REACHED', 'DEADLINE_48H', 'DEADLINE_24H',
            'CAMPAIGN_SUCCEEDED', 'CAMPAIGN_UNSUCCESSFUL', 'CAMPAIGN_EXTENDED', 'PROJECT_APPROVED',
            'PROJECT_APPROVED_SCHEDULED', 'SCHEDULED_LAUNCH_REFUSED',
            'UPDATE_DUE_SOON',
            'PAYMENT_COLLECTED', 'PAYMENT_FAILED', 'FINAL_PAYMENT_WARNING', 'PAYOUT_SENT',
            'WITHDRAWAL_REQUESTED', 'PAYOUT_DETAILS_NEEDED', 'REFUND_NEEDS_BANK_DETAILS',
            'REFUND_SENT_BY_BANK',
            'SUBSCRIPTION_RENEWAL_DUE', 'SUBSCRIPTION_LAPSED', 'SUBSCRIPTION_RENEWED',
            'NEW_UPDATE_PUBLISHED', 'COMMENT_REPLY', 'DIRECT_MESSAGE',
            'SURVEY_AVAILABLE', 'SURVEY_OVERDUE', 'REWARD_SHIPPED',
            'FOLLOWED_CREATOR_LAUNCHED', 'LAUNCH_REMINDER', 'SAVED_PROJECT_ENDING_SOON',
            'NEW_DEVICE_SIGN_IN'));
