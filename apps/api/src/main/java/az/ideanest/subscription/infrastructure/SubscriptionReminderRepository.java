package az.ideanest.subscription.infrastructure;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * The statements {@code subscription-renewal-reminders} is made of — #450, V103.
 *
 * <p>Not a {@code JpaRepository}, for {@code DeadlineNoticeRepository}'s reason: a claim has no
 * behaviour and nothing loads one, the candidate reads are anti-joins against it, and the claim is an
 * {@code INSERT ... ON CONFLICT DO NOTHING}, which JPQL cannot say and which is the whole mechanism.
 *
 * <p><strong>Who is a candidate is decided twice.</strong> Here, to find a bounded list cheaply, and
 * again by {@code SubscriptionReminderSender} on the row it has just re-read inside the claiming
 * transaction — a creator may cancel, or renew, between the two.
 */
@Component
public class SubscriptionReminderRepository {

    /** The vocabulary of {@code subscription_reminders.kind}. */
    public static final String RENEWAL_DUE = "RENEWAL_DUE";

    public static final String LAPSED = "LAPSED";

    /**
     * Priced, running, not cancelled by the creator, and ending inside {@code (from, to]}, with no
     * reminder at this lead for this period yet.
     *
     * <p>The window's lower bound is the next smaller lead, so a subscription is inside exactly one
     * lead's window on any pass: a plan bought with twenty hours to run is reminded once, at the
     * one-day lead, rather than twice in the same morning. Soonest first, so a batch too small for
     * the backlog reminds the creator with the least time left.
     *
     * <p>Casts on every parameter, for {@code DeadlineNoticeRepository}'s reason: an untyped JDBC
     * parameter compared to a {@code timestamptz} is resolved by PostgreSQL in ways whose error
     * names the operator rather than the parameter.
     */
    private static final String DUE =
            """
            SELECT s.id
              FROM subscriptions s
             WHERE s.state = 'ACTIVE'
               AND NOT s.cancel_at_period_end
               AND s.price > 0
               AND s.current_period_end > CAST(:from AS timestamptz)
               AND s.current_period_end <= CAST(:to AS timestamptz)
               AND NOT EXISTS (
                     SELECT 1 FROM subscription_reminders r
                      WHERE r.subscription_id = s.id
                        AND r.period_end = s.current_period_end
                        AND r.kind = 'RENEWAL_DUE'
                        AND r.lead_hours = CAST(:leadHours AS integer))
             ORDER BY s.current_period_end, s.id
             LIMIT :batchSize
            """;

    /**
     * Priced, still {@code ACTIVE}, not cancelled by the creator, and ended inside
     * {@code (since, now]}, with no lapse notice for this period yet.
     *
     * <p>{@code ACTIVE} is the point: a period that ended leaves the row {@code ACTIVE} until its
     * creator buys again (V62 — nothing marks it {@code EXPIRED} on a schedule). A row staff ended is
     * {@code CANCELED} and is never told it lapsed; a creator who cancelled chose this and is not told
     * either. The lower bound is the look-back. Most recent first.
     */
    private static final String LAPSED_SINCE =
            """
            SELECT s.id
              FROM subscriptions s
             WHERE s.state = 'ACTIVE'
               AND NOT s.cancel_at_period_end
               AND s.price > 0
               AND s.current_period_end > CAST(:since AS timestamptz)
               AND s.current_period_end <= CAST(:now AS timestamptz)
               AND NOT EXISTS (
                     SELECT 1 FROM subscription_reminders r
                      WHERE r.subscription_id = s.id
                        AND r.period_end = s.current_period_end
                        AND r.kind = 'LAPSED')
             ORDER BY s.current_period_end DESC, s.id
             LIMIT :batchSize
            """;

    private static final String CLAIM =
            """
            INSERT INTO subscription_reminders (subscription_id, period_end, kind, lead_hours, sent_at)
            VALUES (:subscriptionId, :periodEnd, :kind, :leadHours, :at)
            ON CONFLICT DO NOTHING
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public SubscriptionReminderRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** The subscriptions owed a reminder at this lead, whose period ends inside {@code (from, to]}. */
    public List<UUID> due(int leadHours, Instant from, Instant to, int batchSize) {
        return jdbc.queryForList(
                DUE,
                new MapSqlParameterSource()
                        .addValue("from", Timestamp.from(from))
                        .addValue("to", Timestamp.from(to))
                        .addValue("leadHours", leadHours)
                        .addValue("batchSize", batchSize),
                UUID.class);
    }

    /** The subscriptions owed a lapse notice, whose period ended inside {@code (since, now]}. */
    public List<UUID> lapsed(Instant since, Instant now, int batchSize) {
        return jdbc.queryForList(
                LAPSED_SINCE,
                new MapSqlParameterSource()
                        .addValue("since", Timestamp.from(since))
                        .addValue("now", Timestamp.from(now))
                        .addValue("batchSize", batchSize),
                UUID.class);
    }

    /**
     * Claims one reminder, if nobody has.
     *
     * <p><strong>Call it inside the transaction that records the event.</strong> Separated, a crash
     * between the two either sends a reminder twice or claims one that never went.
     *
     * @param leadHours the lead for {@link #RENEWAL_DUE}, 0 for {@link #LAPSED} — V103 holds the pair
     * @return true when this call claimed it; false when another pass or replica already had
     */
    public boolean claim(UUID subscriptionId, Instant periodEnd, String kind, int leadHours, Instant at) {
        return jdbc.update(
                        CLAIM,
                        new MapSqlParameterSource()
                                .addValue("subscriptionId", subscriptionId)
                                .addValue("periodEnd", Timestamp.from(periodEnd))
                                .addValue("kind", kind)
                                .addValue("leadHours", leadHours)
                                .addValue("at", Timestamp.from(at)))
                == 1;
    }
}
