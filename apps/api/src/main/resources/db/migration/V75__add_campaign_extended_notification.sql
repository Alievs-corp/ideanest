-- One more notification type: every backer is told when a campaign's deadline
-- is extended. IDN-EXT-01 (#34), §5.1: "the backer is only notified of the new
-- deadline" -- told, not asked.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DELETE FROM notifications WHERE type = 'CAMPAIGN_EXTENDED';
--   ALTER TABLE notifications DROP CONSTRAINT notifications_type_known;
--   ALTER TABLE notifications ADD CONSTRAINT notifications_type_known CHECK (
--       type IN (
--           'PLEDGE_CONFIRMED', 'PLEDGE_EDITED',
--           'GOAL_REACHED', 'DEADLINE_48H', 'DEADLINE_24H',
--           'CAMPAIGN_SUCCEEDED', 'CAMPAIGN_UNSUCCESSFUL', 'PROJECT_APPROVED',
--           'UPDATE_DUE_SOON',
--           'PAYMENT_COLLECTED', 'PAYMENT_FAILED', 'FINAL_PAYMENT_WARNING', 'PAYOUT_SENT',
--           'NEW_UPDATE_PUBLISHED', 'COMMENT_REPLY', 'DIRECT_MESSAGE',
--           'SURVEY_AVAILABLE', 'SURVEY_OVERDUE', 'REWARD_SHIPPED',
--           'FOLLOWED_CREATOR_LAUNCHED', 'LAUNCH_REMINDER', 'SAVED_PROJECT_ENDING_SOON',
--           'NEW_DEVICE_SIGN_IN'));
--
--   The DELETE is not optional, for V69's reason: the narrowed constraint is not
--   satisfiable while a row of this type exists. It costs backers the inbox line
--   telling them about a new deadline; the deadline itself stays on the campaign
--   (`projects.extended_until`) and its history row.
--
--   Order the release, not just the statements, as V69 says: the release that
--   stops writing CAMPAIGN_EXTENDED must be fully out before this is reversed.
-- ---------------------------------------------------------------------------
--
-- Contract: none. The vocabulary widens from twenty-three names to twenty-four;
-- every existing row still satisfies it, and a CHECK cannot be widened in place,
-- so the drop and the add are one transaction. This migration ships before, or
-- with, the code that writes the value -- the expand direction.
-- ---------------------------------------------------------------------------

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
            'NEW_UPDATE_PUBLISHED', 'COMMENT_REPLY', 'DIRECT_MESSAGE',
            'SURVEY_AVAILABLE', 'SURVEY_OVERDUE', 'REWARD_SHIPPED',
            'FOLLOWED_CREATOR_LAUNCHED', 'LAUNCH_REMINDER', 'SAVED_PROJECT_ENDING_SOON',
            'NEW_DEVICE_SIGN_IN'));
