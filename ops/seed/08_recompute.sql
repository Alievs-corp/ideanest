-- Aggregates, derived from the rows underneath them.
--
-- Every figure here exists twice in the schema: once as the pledges themselves
-- and once as a counter on the project. That is a deliberate denormalisation —
-- a card cannot afford to sum three thousand pledges — but it means the seed
-- has exactly one honest way to set it, which is to compute it. A pledged
-- amount typed by hand is a number that disagrees with the backer list on the
-- creator dashboard, and there is no way to tell which one is wrong.

BEGIN;

-- ── Campaign totals ─────────────────────────────────────────────────────────
--
-- The states that count are the ones where the money is either committed or
-- already taken. An expired or cancelled pledge raised nothing.

UPDATE projects p SET
    pledged_amount = coalesce(agg.total, 0),
    backers_count = coalesce(agg.backers, 0)
FROM (
    SELECT pl.project_id,
           sum(pl.total_amount) AS total,
           count(DISTINCT pl.backer_id) AS backers
    FROM pledges pl
    WHERE pl.state IN ('COLLECTED', 'FULFILLED')
    GROUP BY pl.project_id
) agg
WHERE agg.project_id = p.id;

UPDATE projects SET pledged_amount = 0, backers_count = 0
WHERE id NOT IN (SELECT DISTINCT project_id FROM pledges
                 WHERE state IN ('COLLECTED', 'FULFILLED'))
  AND (pledged_amount <> 0 OR backers_count <> 0);

-- ── The frozen outcome ──────────────────────────────────────────────────────
--
-- A finalised campaign keeps the figures it finished on, so that a later refund
-- or chargeback cannot retroactively turn a success into a failure on the page
-- that announced it. Frozen here means "computed once, from what was true at
-- the end" -- which for a seed is now.

UPDATE projects p SET
    outcome_goal_amount = p.goal_amount,
    outcome_pledged_amount = p.pledged_amount,
    outcome_backers_count = p.backers_count
WHERE p.finalized_at IS NOT NULL;

-- An unsuccessful campaign raised what its expired pledges promised, and the
-- page that says "did not reach its goal" has to say how close it came.
UPDATE projects p SET outcome_pledged_amount = agg.total, outcome_backers_count = agg.backers
FROM (SELECT project_id, sum(total_amount) AS total, count(DISTINCT backer_id) AS backers
      FROM pledges WHERE state = 'EXPIRED' GROUP BY project_id) agg
WHERE agg.project_id = p.id AND p.state = 'UNSUCCESSFUL';

-- ── Reward tier stock ───────────────────────────────────────────────────────
--
-- Capped at the limit rather than allowed past it. The tier chooser upstream
-- weights by price and knows nothing about stock, so a popular limited tier
-- attracts more pledges than it has units. Capping is what a sold-out tier
-- looks like, which is the state worth having in a demo; the alternative --
-- raising every limit until nothing sells out -- hides the case entirely.

UPDATE reward_tiers rt SET claimed_quantity = LEAST(agg.claimed, coalesce(rt.limit_quantity, agg.claimed))
FROM (
    SELECT pl.reward_tier_id, count(*)::int AS claimed
    FROM pledges pl
    WHERE pl.reward_tier_id IS NOT NULL
      AND pl.state IN ('COLLECTED', 'FULFILLED')
    GROUP BY pl.reward_tier_id
) agg
WHERE agg.reward_tier_id = rt.id;

-- A few units held by carts that have not been confirmed, so the "N left"
-- figure on a live campaign is not simply limit minus claimed.
UPDATE reward_tiers SET reserved_quantity = 2
WHERE limit_quantity IS NOT NULL
  AND claimed_quantity + 2 <= limit_quantity
  AND project_id IN (SELECT id FROM projects WHERE state = 'LIVE');

-- ── Tag usage ───────────────────────────────────────────────────────────────

UPDATE tags t SET usage_count = coalesce(agg.n, 0)
FROM (SELECT tag_id, count(*)::int AS n FROM project_tags GROUP BY tag_id) agg
WHERE agg.tag_id = t.id;

COMMIT;
