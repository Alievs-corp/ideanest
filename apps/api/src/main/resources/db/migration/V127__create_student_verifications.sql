-- The student plan and the check behind it (#655): a creator sends their
-- institution, student card number, a photograph of the card and a selfie; a
-- member of staff approves or refuses; an approval counts for a year; a plan
-- marked student-only is sold only to an account holding one.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DELETE FROM subscription_plans
--    WHERE id = '7c0d4f8e-6a1b-4c2d-9e3f-1a2b3c4d5e04'
--      AND NOT EXISTS (SELECT 1 FROM subscriptions
--                       WHERE plan_id = '7c0d4f8e-6a1b-4c2d-9e3f-1a2b3c4d5e04');
--   DROP TABLE student_verification_documents;
--   DROP TABLE student_verifications;
--   ALTER TABLE subscription_plans DROP COLUMN student_only;
--   ALTER TABLE subscriptions DROP COLUMN student_rate;
--
--   Dropping the column re-lists STUDENT for everybody if it was bought and so
--   could not be deleted: unlist it first.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. A new column with a default and two new tables. The previous
-- release does not map `student_only`, so during a rolling deployment it would
-- sell STUDENT to anybody; the row below is therefore written by this migration
-- and becomes reachable only through the catalogue this release serves.
-- ---------------------------------------------------------------------------

ALTER TABLE subscription_plans
    ADD COLUMN student_only boolean NOT NULL DEFAULT false;

-- Whether a subscription was bought at a student rate: the plan's
-- `student_only`, copied at purchase like the price. Paying its first period
-- and renewing it ask for an approved student check on the strength of this,
-- never of the plan's flag today -- an operator marking a plan student-only
-- later must not stop everybody already on it from renewing what they bought.
ALTER TABLE subscriptions
    ADD COLUMN student_rate boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- THE SUBMISSIONS
-- ---------------------------------------------------------------------------
--
-- One row per submission, not one per account: a refused or expired check is
-- followed by a new submission, and the old row is what "this card was used on
-- another account before" is answered from. The account's current check is its
-- newest row.

CREATE TABLE student_verifications (
    id uuid PRIMARY KEY,

    -- Cascades, as every new reference to `users` must (the test suites
    -- truncate users). In production `users` rows are anonymised rather than
    -- deleted, and anonymisation deletes these rows itself -- see
    -- `AccountStudentVerifications`.
    account_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    institution text NOT NULL
        CONSTRAINT student_verifications_institution_length CHECK (
            length(btrim(institution)) BETWEEN 1 AND 200),

    -- Normalised by `StudentCardNumber`: upper case, letters and digits only,
    -- so "ab-12 345" and "AB12345" are one card and the rule below is about
    -- cards. Only the length is checked here: what counts as a letter is
    -- Java's to decide, and a second, collation-dependent opinion in a CHECK
    -- would be a 500 waiting for the first unusual character.
    card_number text NOT NULL
        CONSTRAINT student_verifications_card_number_length CHECK (
            length(card_number) BETWEEN 3 AND 40),

    -- EXPIRED is stored, not only computed. An approval runs out at
    -- `valid_until`, which readers compare with the clock; the row is moved to
    -- EXPIRED when it stands in the way of a new submission, and by the daily
    -- retention sweep. That move is what keeps the indexes below from holding a
    -- card for ever -- see them.
    state text NOT NULL
        CONSTRAINT student_verifications_state_known CHECK (
            state IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),

    submitted_at timestamptz NOT NULL,

    decided_at timestamptz,
    decided_by uuid REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT student_verifications_decided_has_a_time CHECK (
        state = 'PENDING' OR decided_at IS NOT NULL),

    -- A year from the approval. Kept on an EXPIRED row, which is what it
    -- expired at; cleared by a revocation, which turns the row into a refusal.
    valid_until timestamptz,
    CONSTRAINT student_verifications_validity_needs_approval CHECK (
        (state IN ('APPROVED', 'EXPIRED')) = (valid_until IS NOT NULL)),

    -- Staff's words, shown to the creator. Free text, unlike identity
    -- verification's closed set: the owner asked for a reason, and a card can
    -- be wrong in more ways than a passport.
    rejection_reason text
        CONSTRAINT student_verifications_rejection_reason_length CHECK (
            rejection_reason IS NULL OR length(btrim(rejection_reason)) BETWEEN 1 AND 2000),
    CONSTRAINT student_verifications_rejection_matches_state CHECK (
        (state = 'REJECTED') = (rejection_reason IS NOT NULL)),

    -- When the photographs were destroyed: at the decision, or by the sweep
    -- for a submission nobody decided.
    documents_erased_at timestamptz,

    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ONE CARD, ONE ACCOUNT. At most one row per card number is PENDING or
-- APPROVED, whoever holds it -- so two accounts racing to submit the same card
-- cannot both succeed: the second insert waits for the first and then fails,
-- and the service reads that failure as STUDENT_CARD_IN_USE.
--
-- The index cannot consult a clock, and an approval stops counting at
-- `valid_until`. Leaving that to the index would hold the card for ever. So the
-- service retires an expired approval -- moves it to EXPIRED -- in the same
-- transaction, immediately before inserting the submission it was in the way
-- of; the daily sweep does the same for the rest. V62 does exactly this for
-- `subscriptions`, for the same reason.
CREATE UNIQUE INDEX student_verifications_one_open_per_card
    ON student_verifications (card_number)
    WHERE state IN ('PENDING', 'APPROVED');

-- And one open check per account, so a double-submitted form is one row.
CREATE UNIQUE INDEX student_verifications_one_open_per_account
    ON student_verifications (account_id)
    WHERE state IN ('PENDING', 'APPROVED');

-- An account's newest row, and every account that ever used a card.
CREATE INDEX student_verifications_account_idx ON student_verifications (account_id, submitted_at DESC);
CREATE INDEX student_verifications_card_idx ON student_verifications (card_number);

-- The review queue, oldest first.
CREATE INDEX student_verifications_queue_idx
    ON student_verifications (submitted_at)
    WHERE state = 'PENDING';

-- ---------------------------------------------------------------------------
-- THE PHOTOGRAPHS
-- ---------------------------------------------------------------------------
--
-- V58's envelope, unchanged: AES-GCM under `ideanest.verification.documents`'
-- keys, through the same `DocumentCipher`. A second scheme for the same kind of
-- secret is the one nobody reviews.

CREATE TABLE student_verification_documents (
    id uuid PRIMARY KEY,
    verification_id uuid NOT NULL REFERENCES student_verifications (id) ON DELETE CASCADE,
    kind text NOT NULL
        CONSTRAINT student_verification_documents_kind_known CHECK (kind IN ('STUDENT_CARD', 'SELFIE')),
    content_type text NOT NULL
        CONSTRAINT student_verification_documents_content_type_known CHECK (
            content_type IN ('image/jpeg', 'image/png', 'application/pdf')),
    -- A selfie is a photograph. A PDF of somebody's face is not something a
    -- reviewer should have to open in a document viewer.
    CONSTRAINT student_verification_documents_selfie_is_a_photo CHECK (
        kind <> 'SELFIE' OR content_type IN ('image/jpeg', 'image/png')),
    byte_length integer NOT NULL
        CONSTRAINT student_verification_documents_length_is_positive CHECK (byte_length > 0),
    ciphertext bytea NOT NULL,
    nonce bytea NOT NULL
        CONSTRAINT student_verification_documents_nonce_is_twelve_bytes CHECK (length(nonce) = 12),
    key_id text NOT NULL
        CONSTRAINT student_verification_documents_key_id_shape CHECK (key_id ~ '^[a-z0-9._-]{1,64}$'),
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT student_verification_documents_one_per_kind UNIQUE (verification_id, kind)
);

CREATE INDEX student_verification_documents_uploaded_idx ON student_verification_documents (uploaded_at);

-- ---------------------------------------------------------------------------
-- THE PLAN
-- ---------------------------------------------------------------------------
--
-- Starter's limits at 10 AZN a month, for verified students, drawn just before
-- Starter. Azerbaijani is the primary language (V113); the others are in
-- `translations`. Skipped if an operator has already added a plan called
-- STUDENT: theirs wins, and they can mark it student-only from the console.
INSERT INTO subscription_plans
    (id, code, name, description, translations, price, currency, billing_period,
     max_active_campaigns, goal_ceiling, listed, sort_order, student_only)
SELECT '7c0d4f8e-6a1b-4c2d-9e3f-1a2b3c4d5e04',
       'STUDENT',
       'Tələbə',
       'Təsdiqlənmiş tələbələr üçün: eyni anda bir kampaniya, hədəf 10 000 AZN-ə qədər.',
       '{"en": {"name": "Student", "description": "For verified students: one campaign at a time, up to a 10,000 AZN goal."},
         "ru": {"name": "Студент", "description": "Для подтверждённых студентов: одна кампания одновременно, цель до 10 000 AZN."},
         "tr": {"name": "Öğrenci", "description": "Doğrulanmış öğrenciler için: aynı anda bir kampanya, 10.000 AZN''ye kadar hedef."}}'::jsonb,
       10.00, 'AZN', 'MONTHLY',
       1, 10000.00, true,
       COALESCE((SELECT sort_order FROM subscription_plans WHERE code = 'STARTER'), 10) - 1,
       true
 WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE code = 'STUDENT');

INSERT INTO subscription_plan_prices (plan_id, billing_period, price)
SELECT p.id, v.billing_period, v.price
  FROM subscription_plans p
 CROSS JOIN (VALUES ('MONTHLY', 10.00), ('SEMIANNUAL', 60.00), ('YEARLY', 120.00)) AS v (billing_period, price)
 WHERE p.id = '7c0d4f8e-6a1b-4c2d-9e3f-1a2b3c4d5e04'
ON CONFLICT DO NOTHING;
