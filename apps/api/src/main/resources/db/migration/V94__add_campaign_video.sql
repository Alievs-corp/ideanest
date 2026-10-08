-- A campaign video: one clip of up to sixty seconds, uploaded and transcoded
-- through the same `media` table as a cover image — issue #331.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   ALTER TABLE projects
--       DROP CONSTRAINT IF EXISTS projects_video_media_id_fkey,
--       DROP COLUMN IF EXISTS video_media_id;
--   ALTER TABLE media
--       DROP CONSTRAINT IF EXISTS media_kind_known,
--       DROP CONSTRAINT IF EXISTS media_duration_positive,
--       DROP CONSTRAINT IF EXISTS media_video_ready_is_playable,
--       DROP CONSTRAINT IF EXISTS media_image_has_no_video_facts,
--       DROP COLUMN IF EXISTS kind,
--       DROP COLUMN IF EXISTS duration_ms,
--       DROP COLUMN IF EXISTS poster_storage_key;
--
--   Delete the VIDEO rows first: once `kind` is gone the previous release would
--   read an MP4 as an image. Safe under a rolling deployment in the forward
--   direction -- every column is nullable or defaulted, and an instance of the
--   previous release inserts media rows without naming `kind`, which the
--   default makes IMAGE, which is what that release uploads.
-- ---------------------------------------------------------------------------
--
-- WHY THE SAME TABLE AND NOT `videos`. Everything about an upload is the
-- same: an owner, a presigned address, a state machine the sweep moves, a
-- derived object, a reason when it fails. What differs is two facts a video has
-- and an image does not -- how long it is and where its poster is -- and a
-- second table would duplicate the five states and every constraint that
-- guards them for the sake of two columns.

ALTER TABLE media
    ADD COLUMN kind text NOT NULL DEFAULT 'IMAGE',

    -- Measured by ffprobe on the transcoded file, never reported by a client.
    -- Milliseconds, so a 59.6-second clip is not rounded into the 60-second
    -- ceiling's refusal by whoever reads it.
    ADD COLUMN duration_ms int,

    -- The still a player shows before it plays. A JPEG through the same libvips
    -- path as a cover, so it is stripped of metadata the same way and its blur
    -- placeholder goes in `blur_data_url` exactly as an image's does.
    ADD COLUMN poster_storage_key text;

ALTER TABLE media
    ADD CONSTRAINT media_kind_known
        CHECK (kind IN ('IMAGE', 'VIDEO')),
    ADD CONSTRAINT media_duration_positive
        CHECK (duration_ms IS NULL OR duration_ms > 0),
    -- A ready video can be played and has something to show before it is.
    -- `media_ready_is_servable` already holds the key, the type, the size, the
    -- extent and the placeholder for both kinds.
    ADD CONSTRAINT media_video_ready_is_playable
        CHECK (kind <> 'VIDEO' OR status <> 'READY'
               OR (duration_ms IS NOT NULL AND poster_storage_key IS NOT NULL)),
    ADD CONSTRAINT media_image_has_no_video_facts
        CHECK (kind <> 'IMAGE' OR (duration_ms IS NULL AND poster_storage_key IS NULL));

-- The expand half, as V61 did for the cover: nullable, no default, nothing
-- joins on it. `SET NULL` for the reason V61 gives -- a campaign losing its
-- video renders without one, and a campaign must never disappear because a
-- media row did.
ALTER TABLE projects
    ADD COLUMN video_media_id uuid REFERENCES media (id) ON DELETE SET NULL;

CREATE INDEX projects_video_media_idx
    ON projects (video_media_id)
    WHERE video_media_id IS NOT NULL;
