-- IDN-EXT-01 (#44): a creator registering the business card a payout goes to.
--
-- The spec has the card entered on the provider's page and never in an IdeaNest form: Epoint's
-- /card-registration with refund=1 answers a card identifier before anything is typed, and the card
-- is a payout destination only once the provider's callback says it registered. This table is the
-- card between those two moments, so a callback can be matched to the creator who began it and a
-- callback about a card nobody began moves nothing.
--
-- The destination itself stays V72's `payout_destinations`, verified by a person as before.
--
-- Reverse: DROP TABLE payout_card_registrations; -- once no registration is worth keeping. Not a
-- contract half.

CREATE TABLE payout_card_registrations (
    id uuid PRIMARY KEY,

    creator_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- The provider that issued the identifier, as a ProviderName constant.
    provider text NOT NULL
        CONSTRAINT payout_card_registrations_provider_present CHECK (length(btrim(provider)) > 0),
    card_id text NOT NULL
        CONSTRAINT payout_card_registrations_card_present CHECK (length(btrim(card_id)) BETWEEN 1 AND 200),

    state text NOT NULL DEFAULT 'PENDING'
        CONSTRAINT payout_card_registrations_state_known CHECK (state IN ('PENDING', 'REGISTERED', 'FAILED')),

    started_at timestamptz NOT NULL DEFAULT now(),
    settled_at timestamptz,

    CONSTRAINT payout_card_registrations_settled_together CHECK ((state = 'PENDING') = (settled_at IS NULL))
);

-- A provider names a card once; its callback finds the registration by that name.
CREATE UNIQUE INDEX payout_card_registrations_one_per_card ON payout_card_registrations (provider, card_id);
