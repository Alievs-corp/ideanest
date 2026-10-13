-- A creator is told their plan is due for renewal, that it lapsed, and that a
-- payment for it was collected. Issue #450, epic #448.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DROP TABLE IF EXISTS subscription_reminders;
--   and, once no notification has the types
--   (SELECT count(*) FROM notifications WHERE type IN
--     ('SUBSCRIPTION_RENEWAL_DUE', 'SUBSCRIPTION_LAPSED', 'SUBSCRIPTION_RENEWED')),
--   restore V100's notifications_type_known without them.
--   Dropping the table with the sweep running re-arms every reminder it
--   protects: each priced plan inside a lead is reminded again on the next
--   pass, and each lapse inside the look-back is announced again. Reverse it
--   with `subscription-renewal-reminders` stopped.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. A new table the previous release does not read, and one
-- widened CHECK whose old list the new one contains.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- WHY A TABLE OF CLAIMS
-- ---------------------------------------------------------------------------
--
-- The sweep's question -- "which priced plans end within three days" -- stays
-- true for three days, and "which ended in the last week" for a week. A pass
-- that acted on the answer would remind the same creator every morning. So a
-- reminder is *claimed* by inserting its row, in the transaction that records
-- the outbox event the row authorises, and the database decides the conflict:
-- two replicas sweeping together, or a job run twice, send nothing twice. A
-- read-then-write in Java loses that race. It is V33's `deadline_notices`
-- arrangement, keyed to the period rather than to the campaign.
--
-- The key carries `period_end` because a reminder is about one period. When a
-- renewal extends the row (#449) the period end moves, and the next period's
-- reminders are new keys that need nothing cleared first. When it does not,
-- the old key is what stops the lapse being announced daily for a week.
--
-- `lead_hours` is which reminder before the end it was: 72 and 24 by default
-- (`ideanest.subscription.reminders.leads`). An integer of hours, as V33's
-- `threshold_hours` is, because the leads are configurable and a key over a
-- free interval would compare '3 days' and '72 hours' by a rule nobody reads.
-- A lapse has no lead and is 0, which the CHECK below ties to its kind.
--
-- No personal data: a subscription, an instant, a word and a number. Kept for
-- the life of the subscription and cascaded with it, for V33's reason -- a
-- claim about a subscription that no longer exists protects nothing.

CREATE TABLE subscription_reminders (
    subscription_id uuid        NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
    period_end      timestamptz NOT NULL,
    kind            text        NOT NULL,
    lead_hours      integer     NOT NULL,
    -- When the sweep claimed it, which is when the outbox event was recorded.
    sent_at         timestamptz NOT NULL DEFAULT now(),

    -- The claim. One reminder per subscription, per period, per lead.
    CONSTRAINT subscription_reminders_pkey PRIMARY KEY (subscription_id, period_end, kind, lead_hours),

    CONSTRAINT subscription_reminders_kind_known CHECK (kind IN ('RENEWAL_DUE', 'LAPSED')),

    -- A reminder before the end has a lead; the notice after it has none.
    CONSTRAINT subscription_reminders_lead_fits_kind CHECK (
        (kind = 'RENEWAL_DUE' AND lead_hours > 0) OR (kind = 'LAPSED' AND lead_hours = 0))
);

-- The sweep's anti-join runs on the primary key above, which leads on the
-- subscription, and needs no index of its own.

COMMENT ON TABLE subscription_reminders IS
    'Which renewal reminders and lapse notices a subscription period has been sent. The row is the claim: it is inserted in the same transaction as the outbox event it authorises.';
COMMENT ON COLUMN subscription_reminders.lead_hours IS
    'Hours before period_end the RENEWAL_DUE reminder was for (72, 24 by default); 0 for LAPSED.';

-- SUBSCRIPTION_RENEWAL_DUE and SUBSCRIPTION_LAPSED are the sweep's;
-- SUBSCRIPTION_RENEWED is the receipt for `subscription.paid` (#449).
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
            'WITHDRAWAL_REQUESTED', 'PAYOUT_DETAILS_NEEDED', 'REFUND_NEEDS_BANK_DETAILS',
            'REFUND_SENT_BY_BANK',
            'SUBSCRIPTION_RENEWAL_DUE', 'SUBSCRIPTION_LAPSED', 'SUBSCRIPTION_RENEWED',
            'NEW_UPDATE_PUBLISHED', 'COMMENT_REPLY', 'DIRECT_MESSAGE',
            'SURVEY_AVAILABLE', 'SURVEY_OVERDUE', 'REWARD_SHIPPED',
            'FOLLOWED_CREATOR_LAUNCHED', 'LAUNCH_REMINDER', 'SAVED_PROJECT_ENDING_SOON',
            'NEW_DEVICE_SIGN_IN'));
