package az.ideanest.support;

import java.math.BigDecimal;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Puts a pledge into the state a test needs to start from, by writing the row.
 *
 * <p>{@code Campaigns}' argument, applied to the other side of the checkout. A suite whose
 * subject is not the checkout should not depend on the reservation TTL, the rate limiter
 * and an account per pledge to reach a state that is a precondition rather than a subject.
 *
 * <p><strong>{@code CONFIRMED} has no request left that produces it.</strong> It was the
 * stored-card model's commitment, which IDN-EXT-01 replaced with paying when the pledge is
 * made, and #45 removed the {@code confirm} route. Pledges confirmed before then can still
 * be in it, and the rules for them still hold — raised only, never cancelled — so the
 * suites that check those rules make one here.
 *
 * <p>What is written is what confirmation writes — the state, the instant, the amounts —
 * so the row that results is one the application could have produced, and every check
 * constraint on {@code pledges} still applies.
 *
 * <p><strong>There is no teardown helper here, deliberately.</strong> V41 makes
 * {@code transactions} and {@code ledger_entries} append-only in PostgreSQL and both
 * reference the pledge with {@code ON DELETE NO ACTION}, so a suite that has collected
 * anything <em>cannot</em> delete its pledges — the database refuses, which is the
 * property those triggers exist for. Such a suite mints a fresh campaign per test and
 * scopes its assertions to it, the way {@code AuditLogSchemaTests} and the four suites
 * that write audit rows already do.
 *
 * <p><strong>Each pledge needs its own backer.</strong>
 * {@code pledges_project_backer_active_key} allows one active pledge per backer per
 * campaign, so {@link #confirmed} mints an account per call rather than letting a caller
 * discover the index.
 */
public final class Pledges {

    private Pledges() {}

    /**
     * A confirmed pledge on a campaign, with its own backer.
     *
     * <p>The amount goes entirely into {@code base_amount}: the five components exist so
     * that a receipt can be itemised, and every collection charges {@code total_amount},
     * so a test about collection that split them would be asserting on the generated
     * column's arithmetic rather than on anything this feature does.
     *
     * @param handle a distinct prefix for the backer's account, so that a suite creating
     *     several does not collide on {@code users.handle}
     * @return the pledge's identifier
     */
    public static UUID confirmed(DataSource dataSource, UUID projectId, String handle, String amount) {
        UUID backerId = Campaigns.creator(dataSource, handle);
        return confirmedFor(dataSource, projectId, backerId, amount);
    }

    /** The same, for a backer the caller already has. */
    public static UUID confirmedFor(DataSource dataSource, UUID projectId, UUID backerId, String amount) {
        UUID pledgeId = UUID.randomUUID();
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO pledges (id, project_id, backer_id, state, base_amount, currency, confirmed_at)
                        VALUES (?, ?, ?, 'CONFIRMED', ?, 'AZN', now())
                        """,
                        pledgeId,
                        projectId,
                        backerId,
                        new BigDecimal(amount));
        return pledgeId;
    }

    /**
     * Confirms a backer's draft the way the stored-card model's {@code confirm} did, before #45
     * removed it: the places the draft holds go from reserved to claimed, and the pledge
     * becomes {@code CONFIRMED} with nothing charged.
     *
     * <p>For a test about a pledge confirmed before IDN-EXT-01. One statement per table, like
     * {@code RewardTierRepository#commitPlaces}: the sum of the two counters never moves.
     */
    public static void confirmDraft(DataSource dataSource, UUID pledgeId) {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update(
                """
                UPDATE reward_tiers t
                   SET reserved_quantity = t.reserved_quantity - held.places,
                       claimed_quantity = t.claimed_quantity + held.places
                  FROM (SELECT reward_tier_id AS tier, 1 AS places
                          FROM pledges
                         WHERE id = ? AND reward_tier_id IS NOT NULL
                        UNION ALL
                        SELECT reward_tier_id, quantity
                          FROM pledge_addons
                         WHERE pledge_id = ?) held
                 WHERE t.id = held.tier
                """,
                pledgeId,
                pledgeId);
        int updated = jdbc.update(
                "UPDATE pledges SET state = 'CONFIRMED', confirmed_at = now() WHERE id = ? AND state = 'DRAFT'",
                pledgeId);
        if (updated != 1) {
            throw new IllegalStateException("No draft " + pledgeId + " to confirm");
        }
    }
}
