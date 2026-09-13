-- IDN-EXT-01 (#41): two notifications of withdrawal.
--
-- WITHDRAWAL_REQUESTED tells every backer of a campaign that its creator's payout was requested and
-- until when they may dispute their payment. PAYOUT_DETAILS_NEEDED reminds the creator, weekly, that
-- the payout waits for their VÖEN and business card. V69 and V75 widened this check the same way.
--
-- -- Contract: none. Only widens a CHECK; the previous release never writes the two new types.
--
-- Reverse: check no row has either type, then restore V75's list.

ALTER TABLE notifications
    DROP CONSTRAINT notifications_type_known;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_type_known CHECK (
        type IN (
            'PLEDGE_CONFIRMED', 'PLEDGE_EDITED',
            'GOAL_REACHED', 'DEADLINE_48H', 'DEADLINE_24H',
            'CAMPAIGN_SUCCEEDED', 'CAMPAIGN_UNSUCCESSFUL', 'CAMPAIGN_EXTENDED', 'PROJECT_APPROVED',
            'UPDATE_DUE_SOON',
            'PAYMENT_COLLECTED', 'PAYMENT_FAILED', 'FINAL_PAYMENT_WARNING', 'PAYOUT_SENT',
            'WITHDRAWAL_REQUESTED', 'PAYOUT_DETAILS_NEEDED',
            'NEW_UPDATE_PUBLISHED', 'COMMENT_REPLY', 'DIRECT_MESSAGE',
            'SURVEY_AVAILABLE', 'SURVEY_OVERDUE', 'REWARD_SHIPPED',
            'FOLLOWED_CREATOR_LAUNCHED', 'LAUNCH_REMINDER', 'SAVED_PROJECT_ENDING_SOON',
            'NEW_DEVICE_SIGN_IN'));
