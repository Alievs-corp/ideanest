-- #148: slugs that collide with the web's static route segments.
--
-- The public campaign page is /projects/{creatorSlug}/{projectSlug}, and /projects/[id]/ also has
-- static children that take a project id: back, dashboard, edit and prelaunch. Next.js matches the
-- static segment first, so a campaign slugged "back" had the checkout as its public address. "new"
-- is the same problem one level up: /projects/new is the new-campaign page. Slugs.RESERVED now keeps
-- the allocators off these words; this moves the rows that already have one.
--
-- Each row takes the first free numbered suffix, as the allocator would have given it. The platform
-- keeps no slug history, so the old address is not redirected: it never showed the campaign anyway.
--
-- Reverse: none needed. The old slugs pointed at a route rather than at the row, so restoring them
-- would restore a broken address.

UPDATE projects AS p
   SET slug = p.slug || '-' || (
           SELECT min(n)
             FROM generate_series(2, 1000) AS n
            WHERE NOT EXISTS (
                      SELECT 1 FROM projects AS q
                       WHERE q.creator_id = p.creator_id
                         AND q.slug = p.slug || '-' || n))
 WHERE p.slug IN ('back', 'dashboard', 'edit', 'new', 'prelaunch');

UPDATE users AS u
   SET slug = u.slug || '-' || (
           SELECT min(n)
             FROM generate_series(2, 1000) AS n
            WHERE NOT EXISTS (
                      SELECT 1 FROM users AS v
                       WHERE v.slug = u.slug || '-' || n))
 WHERE u.slug IN ('back', 'dashboard', 'edit', 'new', 'prelaunch');
