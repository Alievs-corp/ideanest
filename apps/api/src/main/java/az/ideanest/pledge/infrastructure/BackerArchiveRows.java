package az.ideanest.pledge.infrastructure;

import az.ideanest.pledge.application.BackerCursor;
import az.ideanest.pledge.application.BackerPledge;
import az.ideanest.shared.money.Money;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * A backer's own pledges, and the campaigns their public archive may name.
 *
 * <p><strong>SQL rather than JPA, following {@code BackedPledgeFacts} and
 * {@code BackerListRepository}</strong> and for their reason: both questions are a
 * projection over a state filter with a keyset predicate on it, and loading entities to
 * build a record out of would fetch an idempotency key, a version, a collection schedule
 * and a retry count per row on a read whose whole purpose is to render a list.
 *
 * <h2>{@code projects} is not joined, and that is the point</h2>
 *
 * <p>Both of these lists render a campaign card beside every row, and neither query
 * mentions {@code projects}. That table belongs to the project module;
 * {@code SavedListResponse} names reading it from outside as the reason its own response
 * carries no cover image, no funding total and no deadline, and refuses to close the gap
 * that way. So these queries answer with identifiers and
 * {@code az.ideanest.project.application.ProfileCampaigns} turns them into cards — one
 * extra indexed read per page, bounded by the page size, which is what the boundary costs.
 *
 * <p>{@code reward_tiers} is not joined either, for the same reason and with a precedent
 * three files away: {@code BackerListRepository} says so about the creator's report, and
 * {@code RewardTitles} is the interface the reward module publishes instead.
 *
 * <h2>Two page queries rather than one with a nullable cursor</h2>
 *
 * <p>The first page and the pages after it are separate statements, as in
 * {@code ProfileCampaignRows}: PostgreSQL cannot infer the type of a bound {@code NULL} in
 * a row-value comparison, so the single-statement form needs a cast at every occurrence and
 * hands the planner a predicate it cannot use as a range scan. The comparison itself is
 * {@code (p.created_at, p.id) < (:at, :id)}, which expresses "strictly after this row in
 * this ordering" without spelling the tie-break out as a second disjunct — and a
 * hand-written disjunct is how a keyset page comes to drop the row on the boundary.
 */
@Repository
public class BackerArchiveRows {

    private static final String PLEDGE_COLUMNS =
            """
            p.id, p.project_id, p.state, p.reward_tier_id, p.currency,
            p.base_amount, p.addons_amount, p.bonus_amount, p.shipping_amount,
            p.tax_amount, p.total_amount,
            p.is_anonymous, p.is_late_pledge,
            p.confirmed_at, p.canceled_at, p.created_at,
            (SELECT SUM(r.amount) FROM refunds r
              WHERE r.pledge_id = p.id
                AND r.state IN ('AWAITING_BANK_DETAILS', 'AWAITING_TRANSFER')) AS refund_awaiting_bank_transfer
            """;

    /** Newest first, tie-broken on the identifier — the pair {@link BackerCursor} names. */
    private static final String NEWEST_FIRST = " ORDER BY p.created_at DESC, p.id DESC LIMIT :limit";

    private static final String AFTER_CURSOR = " AND (p.created_at, p.id) < (:cursorAt, :cursorId)";

    private static final String OWN_PLEDGES =
            "SELECT " + PLEDGE_COLUMNS + " FROM pledges p WHERE p.backer_id = :backerId";

    /**
     * The archive's rows, which are project identifiers and a paging key and nothing else.
     *
     * <p>Deliberately not the pledge: §4.2's P-04 says the backed archive carries no amounts
     * at all, and the way to guarantee that is for the query behind it to have no amount in
     * it — the same shape {@code PublicBacker} takes for PL-12, where the anonymous variant
     * has nowhere to put an identity rather than remembering not to fill one in.
     */
    private static final String BACKED_PROJECTS =
            """
            SELECT p.project_id, p.id, p.created_at
              FROM pledges p
             WHERE p.backer_id = :backerId
               AND p.state IN (:states)
               AND p.is_anonymous = FALSE
            """;

    private static final RowMapper<BackerPledge> PLEDGE = (row, index) -> pledge(row);

    private static final RowMapper<BackedProject> BACKED = (row, index) -> new BackedProject(
            row.getObject("project_id", UUID.class), row.getObject("id", UUID.class), instantOf(row, "created_at"));

    private final NamedParameterJdbcTemplate jdbc;

    public BackerArchiveRows(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * One page of this account's own pledges, newest first, in every state.
     *
     * <p>No state filter, unlike {@link #backedBy} beside it. A backer's own list has to
     * show the pledge they cancelled and the one whose card was refused — those are the
     * rows somebody opens this screen to find — and a filter here would hide exactly the
     * pledges that need explaining. {@code PledgeState} is §6.2's twelve and all twelve
     * appear.
     *
     * @param limit already clamped by the caller. This class does not decide page sizes
     */
    public List<BackerPledge> pledgesOf(UUID backerId, BackerCursor after, int limit) {
        MapSqlParameterSource parameters =
                new MapSqlParameterSource().addValue("backerId", backerId).addValue("limit", limit);

        if (after == null) {
            return jdbc.query(OWN_PLEDGES + NEWEST_FIRST, parameters, PLEDGE);
        }
        return jdbc.query(OWN_PLEDGES + AFTER_CURSOR + NEWEST_FIRST, withCursor(parameters, after), PLEDGE);
    }

    /**
     * One page of the campaigns this account has publicly backed, newest pledge first.
     *
     * <p><strong>{@code is_anonymous = FALSE} is in the statement rather than applied
     * afterwards.</strong> §4.5's PL-12 is the reason and the placement is the guarantee: a
     * row that must not be published is one the query never returns, so no later mapping
     * step can forget it and no exception path can leak it. That is also why the ordering
     * key and the identifier are all this projection carries.
     *
     * <p><strong>One row per campaign, without a {@code DISTINCT}.</strong>
     * {@code pledges_project_backer_active_key} is a partial unique index over exactly
     * §7.2's active states, and the states passed here are a subset of it — so a backer
     * cannot hold two counted pledges on one campaign, and a {@code DISTINCT} would be
     * defending against a row the database refuses.
     *
     * @param states which of §6.2's twelve count as having backed a campaign. Bound rather
     *     than inlined — unlike {@code BackedPledgeFacts}, which inlines its own list so the
     *     planner can use the partial index — because this predicate is served by
     *     {@code pledges_backer_idx} and the set is the caller's decision, which is where
     *     the rule belongs
     */
    public List<BackedProject> backedBy(UUID backerId, Set<String> states, BackerCursor after, int limit) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("backerId", backerId)
                .addValue("states", states)
                .addValue("limit", limit);

        if (after == null) {
            return jdbc.query(BACKED_PROJECTS + NEWEST_FIRST, parameters, BACKED);
        }
        return jdbc.query(BACKED_PROJECTS + AFTER_CURSOR + NEWEST_FIRST, withCursor(parameters, after), BACKED);
    }

    /**
     * A campaign somebody has backed, and where the next page starts.
     *
     * <p>Three values, none of them an amount and none of them a name. It is deliberately
     * not enough to render anything: what a client is shown comes from the project module,
     * which is the only place that may decide whether a campaign is publicly visible at all.
     *
     * @param pledgeId not published. It is the second half of the cursor, and a public
     *     archive that named somebody's pledge identifiers would hand out a key to
     *     {@code GET /v1/pledges/{id}}
     */
    public record BackedProject(UUID projectId, UUID pledgeId, Instant createdAt) {
    }

    private static MapSqlParameterSource withCursor(MapSqlParameterSource parameters, BackerCursor after) {
        return parameters
                .addValue("cursorAt", OffsetDateTime.ofInstant(after.at(), ZoneOffset.UTC))
                .addValue("cursorId", after.id());
    }

    private static BackerPledge pledge(ResultSet row) throws SQLException {
        String currency = row.getString("currency");
        return new BackerPledge(
                row.getObject("id", UUID.class),
                row.getObject("project_id", UUID.class),
                row.getString("state"),
                row.getObject("reward_tier_id", UUID.class),
                Money.of(row.getBigDecimal("base_amount"), currency),
                Money.of(row.getBigDecimal("addons_amount"), currency),
                Money.of(row.getBigDecimal("bonus_amount"), currency),
                Money.of(row.getBigDecimal("shipping_amount"), currency),
                Money.of(row.getBigDecimal("tax_amount"), currency),
                // The database's number, not a sum computed here. total_amount is a
                // generated column precisely so that the receipt cannot disagree with the
                // lines above it.
                Money.of(row.getBigDecimal("total_amount"), currency),
                row.getBoolean("is_anonymous"),
                row.getBoolean("is_late_pledge"),
                instantOf(row, "confirmed_at"),
                instantOf(row, "canceled_at"),
                instantOf(row, "created_at"),
                Money.orNull(row.getBigDecimal("refund_awaiting_bank_transfer"), currency));
    }

    /**
     * {@code timestamptz} as an instant, or null.
     *
     * <p>Read as {@link OffsetDateTime} rather than {@code java.sql.Timestamp}: the latter
     * is interpreted in the JVM's default zone, which makes the value depend on where the
     * service happens to run — and {@code created_at} is a cursor key as well as a date, so
     * a shifted value would page wrongly rather than merely display wrongly.
     */
    private static Instant instantOf(ResultSet row, String column) throws SQLException {
        OffsetDateTime value = row.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
