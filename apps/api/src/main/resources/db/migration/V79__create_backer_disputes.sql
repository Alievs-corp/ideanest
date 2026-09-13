-- IDN-EXT-01 (#43): a backer disputes their payment while the creator's payout is held.
--
-- Every withdrawal tells every backer "until DATE you may dispute your payment" (#41). This is where
-- that dispute is recorded. It is not V54's `disputes`, which is a card scheme's chargeback arriving
-- from the provider with the provider's case identifier; a backer disputing through the platform has
-- no provider case, and folding the two together would make every backer dispute invent one.
--
-- An administrator decides it. Upheld, the backer is refunded in full and the payout is recalculated
-- without them; the campaign stays successful whatever the remainder is (§5.1). Rejected, nothing
-- moves. After the payout is sent, no dispute can be opened: nothing is refunded through the platform
-- after payout.
--
-- Reverse: DROP TABLE backer_disputes; -- once no row is worth keeping. Not a contract half.

CREATE TABLE backer_disputes (
    id uuid PRIMARY KEY,

    pledge_id uuid NOT NULL REFERENCES pledges (id) ON DELETE NO ACTION,
    project_id uuid NOT NULL REFERENCES projects (id) ON DELETE NO ACTION,
    backer_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,

    -- The payout that was held when the dispute was opened. The window is that payout's.
    payout_id uuid NOT NULL REFERENCES payouts (id) ON DELETE NO ACTION,

    reason text NOT NULL
        CONSTRAINT backer_disputes_reason_present CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),

    state text NOT NULL DEFAULT 'OPEN'
        CONSTRAINT backer_disputes_state_known CHECK (state IN ('OPEN', 'UPHELD', 'REJECTED')),

    decided_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    decision_note text
        CONSTRAINT backer_disputes_note_length CHECK (decision_note IS NULL OR length(decision_note) <= 2000),
    decided_at timestamptz,

    -- The refund an upheld dispute issued.
    refund_id uuid REFERENCES refunds (id) ON DELETE NO ACTION,

    opened_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT backer_disputes_decided_together CHECK (
        (state = 'OPEN') = (decided_at IS NULL AND decided_by IS NULL)),
    CONSTRAINT backer_disputes_upheld_has_refund CHECK (state <> 'UPHELD' OR refund_id IS NOT NULL)
);

-- One open dispute per pledge: a second request while the first is undecided is the same dispute.
CREATE UNIQUE INDEX backer_disputes_one_open_per_pledge ON backer_disputes (pledge_id) WHERE state = 'OPEN';

-- The administrators' queue: what is undecided, oldest first.
CREATE INDEX backer_disputes_queue ON backer_disputes (opened_at ASC) WHERE state = 'OPEN';
