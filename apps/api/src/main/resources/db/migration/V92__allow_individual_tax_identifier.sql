-- An individual may record a VÖEN. Issue #239.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   UPDATE creator_legal_subjects SET tax_id = NULL WHERE subject_kind = 'INDIVIDUAL';
--   ALTER TABLE creator_legal_subjects DROP CONSTRAINT creator_legal_subjects_individual_is_bare;
--   ALTER TABLE creator_legal_subjects ADD CONSTRAINT creator_legal_subjects_individual_is_bare CHECK (
--       subject_kind <> 'INDIVIDUAL'
--           OR (tax_id IS NULL AND registered_address IS NULL AND registration_number IS NULL));
--
--   Lossy: every VÖEN an individual entered is erased, and with it their payout's
--   one route past §6.3's approval. Export those rows before reversing.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none in the expand-then-contract sense. The constraint is replaced by a
-- weaker one -- every row the old one accepted, the new one accepts -- so nothing a
-- running release writes is refused. A release that predates this one still clears an
-- individual's VÖEN on save, which is today's behaviour, and the next save under the new
-- release puts it back.
-- ---------------------------------------------------------------------------
--
-- WHY
-- ---------------------------------------------------------------------------
--
-- V70 held that an individual has a name and nothing else, and refused a VÖEN on one in
-- the schema. IDN-EXT-01 (§6.3) then made a VÖEN a condition of every payout: one is
-- approved only when the "VÖEN is real and the business card belongs to the VÖEN's
-- holder". An individual entrepreneur in Azerbaijan -- a fərdi sahibkar -- has a VÖEN and
-- a business card in their own name, so under V70 an individual creator could never be
-- paid, and the settings form, which showed them the field, said "Saved" while the
-- service threw the number away.
--
-- The registered address and the registration number stay company-only. They describe a
-- registered entity, and an individual's address is their identity document's, which
-- #431's review already reads.

ALTER TABLE creator_legal_subjects DROP CONSTRAINT creator_legal_subjects_individual_is_bare;

ALTER TABLE creator_legal_subjects ADD CONSTRAINT creator_legal_subjects_individual_is_bare CHECK (
    subject_kind <> 'INDIVIDUAL'
        OR (registered_address IS NULL AND registration_number IS NULL));

COMMENT ON COLUMN creator_legal_subjects.tax_id IS
    'VÖEN, ten digits, shape-validated only. A company''s, or an individual entrepreneur''s (#239). Whether it is real is answered by a human reading a registration extract.';
