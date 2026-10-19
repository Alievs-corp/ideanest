-- A reward tier's picture and its short clip, and a story section's title in
-- search.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   ALTER TABLE reward_tiers
--       DROP CONSTRAINT IF EXISTS reward_tiers_image_media_id_fkey,
--       DROP CONSTRAINT IF EXISTS reward_tiers_video_media_id_fkey,
--       DROP COLUMN IF EXISTS image_media_id,
--       DROP COLUMN IF EXISTS video_media_id;
--   CREATE OR REPLACE FUNCTION ideanest_story_text(document jsonb) with V13's
--   body, which differs from the one below only by the section-title path.
--
--   Safe under a rolling deployment in the forward direction: both columns are
--   nullable with no default, and an instance of the previous release neither
--   maps nor writes them. A reverse leaves the media rows in place; the sweep
--   does not delete a READY row, so they cost storage until removed by hand.
-- ---------------------------------------------------------------------------
--
-- Through `media`, as V61 did for the cover and V94 for the campaign video, so a
-- reward's picture and clip are measured, stripped and transcoded by the same
-- pipeline. `SET NULL` for V61's reason: a reward losing its picture renders
-- without one, and a reward must never disappear because a media row did.
--
-- The five-second limit on the clip is not a constraint here. It is a fact of
-- the row the reward points at (`media.duration_ms`), checked when the reward is
-- saved, and configured as `ideanest.media.video.reward-max-duration`.

ALTER TABLE reward_tiers
    ADD COLUMN image_media_id uuid REFERENCES media (id) ON DELETE SET NULL,
    ADD COLUMN video_media_id uuid REFERENCES media (id) ON DELETE SET NULL;

-- Without these a media delete scans every tier to apply the SET NULL.
CREATE INDEX reward_tiers_image_media_idx
    ON reward_tiers (image_media_id)
    WHERE image_media_id IS NOT NULL;

CREATE INDEX reward_tiers_video_media_idx
    ON reward_tiers (video_media_id)
    WHERE video_media_id IS NOT NULL;

-- A story `section` block (StoryDocuments) carries its own title. Its spans are
-- already reached by `$.blocks[*].spans[*].text`; the title is not, and
-- `$.blocks[*].title` would also index embed titles, which V13 excludes. So the
-- path is filtered to sections. Stored stories have no sections yet, so no row's
-- vector changes and there is nothing to backfill.
CREATE OR REPLACE FUNCTION ideanest_story_text(document jsonb) RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    STRICT
    AS $$
        SELECT coalesce(string_agg(prose, ' '), '')
          FROM jsonb_array_elements_text(
                   jsonb_path_query_array(document, '$.blocks[*].text')
                || jsonb_path_query_array(document, '$.blocks[*] ? (@.type == "section").title')
                || jsonb_path_query_array(document, '$.blocks[*].spans[*].text')
                || jsonb_path_query_array(document, '$.blocks[*].items[*][*].text')
               ) AS extracted(prose)
    $$;

COMMENT ON FUNCTION ideanest_story_text(jsonb) IS
    'The reader-visible prose of a story document: heading text, section titles, paragraph, '
    'quote and section spans, and list items. Matches StoryDocuments.characterCount, and '
    'excludes image alt text and embed titles for the same reason it does.';
