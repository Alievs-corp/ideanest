-- IdeyaNest local demo seed. Development only.
--
-- Nothing here is production data and none of it should ever run against a
-- deployed database: the accounts share one password, the payment records
-- reference no real provider, and the identifiers are derived from readable
-- keys rather than generated. It exists so that a developer starting the stack
-- for the first time sees a populated platform instead of fifteen empty rails.
--
-- Run: ops/seed/run.sh  (or psql -f each file in order)

-- Readable, stable identifiers. `sid('project:tumar')` is the same uuid on
-- every machine and in every file, so the parts of this seed can reference each
-- other without a lookup table and re-running it is idempotent.
CREATE OR REPLACE FUNCTION seed_id(key text) RETURNS uuid
    LANGUAGE sql IMMUTABLE AS $$ SELECT md5('ideanest-demo-seed:' || key)::uuid $$;

-- Argon2id encoding of the shared demo password. Produced by registering one
-- account through /v1/auth/register, so it is a hash this service's own
-- verifier accepts rather than one assembled by hand.
CREATE OR REPLACE FUNCTION seed_password() RETURNS text
    LANGUAGE sql IMMUTABLE AS $$
    SELECT '$argon2id$v=19$m=19456,t=2,p=1$NCC7lUv9QryZ4DAJg94yrg$OC0sjlI4mCs5mxCfBDrsuF9mzm8jcKzK3a/NNDwYYQ0'
$$;

-- Category and subcategory ids by slug, so the project rows read as taxonomy
-- rather than as uuids.
CREATE OR REPLACE FUNCTION seed_category(slug text) RETURNS uuid
    LANGUAGE sql STABLE AS $$ SELECT id FROM categories WHERE categories.slug = $1 $$;

CREATE OR REPLACE FUNCTION seed_subcategory(category_slug text, nth int) RETURNS uuid
    LANGUAGE sql STABLE AS $$
    SELECT s.id FROM subcategories s JOIN categories c ON c.id = s.parent_id
    WHERE c.slug = $1 ORDER BY s.sort_order OFFSET $2 LIMIT 1
$$;

CREATE OR REPLACE FUNCTION seed_location(slug text) RETURNS uuid
    LANGUAGE sql STABLE AS $$ SELECT id FROM locations WHERE locations.slug = $1 $$;

-- Unsplash delivers an exact crop when width and height are both given, so the
-- dimensions stored alongside a cover are the dimensions the browser receives.
-- projects.cover_image_* is all-or-nothing by constraint, and a guessed height
-- is what makes a card jump once the picture arrives.
CREATE OR REPLACE FUNCTION seed_photo(photo text, w int, h int) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$
    SELECT 'https://images.unsplash.com/' || photo || '?w=' || w || '&h=' || h || '&fit=crop&q=80'
$$;

-- A story document in the shape StoryDocuments.validate accepts: version 1, a
-- list of blocks, spans carrying their own marks array. Built here rather than
-- written out per project so that twenty campaigns do not become twenty
-- opportunities to mistype the schema.
CREATE OR REPLACE FUNCTION seed_story(
    lead text,
    heading_one text, body_one text,
    image_photo text, image_alt text,
    heading_two text, body_two text,
    bullets text[]
) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
SELECT jsonb_build_object(
    'version', 1,
    'blocks', jsonb_build_array(
        jsonb_build_object('type', 'paragraph', 'spans',
            jsonb_build_array(jsonb_build_object('text', lead, 'marks', jsonb_build_array()))),
        jsonb_build_object('type', 'heading', 'level', 2, 'id', 'layihe-haqqinda', 'text', heading_one),
        jsonb_build_object('type', 'paragraph', 'spans',
            jsonb_build_array(jsonb_build_object('text', body_one, 'marks', jsonb_build_array()))),
        jsonb_build_object('type', 'image',
            'url', seed_photo(image_photo, 1600, 1067), 'width', 1600, 'height', 1067, 'alt', image_alt),
        jsonb_build_object('type', 'heading', 'level', 2, 'id', 'plan-ve-buque', 'text', heading_two),
        jsonb_build_object('type', 'paragraph', 'spans',
            jsonb_build_array(jsonb_build_object('text', body_two, 'marks', jsonb_build_array()))),
        jsonb_build_object('type', 'list', 'ordered', false, 'items',
            (SELECT jsonb_agg(jsonb_build_array(jsonb_build_object('text', b, 'marks', jsonb_build_array())))
             FROM unnest(bullets) AS b)),
        jsonb_build_object('type', 'rule')
    ))
$$;

-- Deterministic pseudo-randomness. The seed has to be repeatable: the same key
-- must pick the same reward tier and the same backer on every machine, or two
-- developers comparing a screenshot are looking at different data. 28 bits so
-- the cast lands inside a signed integer without a sign to strip.
CREATE OR REPLACE FUNCTION seed_rand(key text) RETURNS double precision
    LANGUAGE sql IMMUTABLE AS $$
    SELECT (('x' || substr(md5('rand:' || key), 1, 7))::bit(28)::int)::double precision / 268435456.0
$$;
