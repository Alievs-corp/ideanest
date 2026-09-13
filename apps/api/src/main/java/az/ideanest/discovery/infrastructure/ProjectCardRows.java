package az.ideanest.discovery.infrastructure;

import az.ideanest.discovery.domain.DiscoveryStatus;
import az.ideanest.discovery.domain.ProjectCard;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One projection of {@code projects} into a {@link ProjectCard}, shared by every
 * query in this module that returns cards.
 *
 * <p><strong>Extracted when the collection landing page arrived (#48).</strong> D-08's
 * page is a second feed of the same cards in a different order, and the alternative
 * was a second column list and a second row mapper — two chances for one of them to
 * project a column the other does not, and a card that renders differently depending
 * on which endpoint served it. §20's budget is decided by what a card costs, and it
 * is decided here for both.
 */
final class ProjectCardRows {

    /**
     * The columns a card needs, and nothing else.
     *
     * <p>{@code users} is joined rather than looked up per row: D-05 puts the creator
     * on the card, and one query per card is the N+1 that a feed cannot afford. The
     * join is inner because {@code projects.creator_id} is {@code NOT NULL} with no
     * {@code ON DELETE} clause — §17.4 anonymises a departing account in place, so the
     * row is always there, and an outer join would only hide a foreign key violation.
     */
    static final String COLUMNS =
            """
            p.id, p.slug, p.title, p.state, p.currency,
            p.goal_amount, p.pledged_amount, p.backers_count,
            p.launched_at, p.deadline, p.extended_until,
            p.cover_image_url, p.cover_image_width, p.cover_image_height,
            u.name AS creator_name, u.slug AS creator_slug, u.avatar_url AS creator_avatar_url
            """;

    /** The {@code FROM} both feeds share, so the join condition has one spelling. */
    static final String FROM = " FROM projects p JOIN users u ON u.id = p.creator_id";

    private ProjectCardRows() {
    }

    /**
     * @param asOf the instant {@code daysLeft} is measured against — the same one the
     *     sort scored from, so a page is internally consistent and the ETag over it is
     *     stable for the length of the cache window
     */
    static ProjectCard card(ResultSet resultSet, Instant asOf) throws SQLException {
        String currency = resultSet.getString("currency");
        BigDecimal goalAmount = resultSet.getBigDecimal("goal_amount");
        BigDecimal pledgedAmount = resultSet.getBigDecimal("pledged_amount");
        Instant launchedAt = instantOf(resultSet, "launched_at");
        Instant deadline = instantOf(resultSet, "deadline");
        Instant extendedUntil = instantOf(resultSet, "extended_until");
        String state = resultSet.getString("state");

        String coverUrl = resultSet.getString("cover_image_url");
        // The three cover columns are written together or not at all —
        // projects_cover_image_is_complete — so one check answers for all three.
        ProjectCard.CoverImage cover = coverUrl == null
                ? null
                : new ProjectCard.CoverImage(
                        coverUrl, resultSet.getInt("cover_image_width"), resultSet.getInt("cover_image_height"));

        return new ProjectCard(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("slug"),
                resultSet.getString("creator_slug"),
                resultSet.getString("title"),
                new ProjectCard.Creator(
                        resultSet.getString("creator_name"),
                        resultSet.getString("creator_slug"),
                        resultSet.getString("creator_avatar_url")),
                cover,
                Money.orNull(goalAmount, currency),
                Money.of(pledgedAmount, currency),
                ProjectCard.completionPercent(pledgedAmount, goalAmount),
                resultSet.getInt("backers_count"),
                // An extended campaign counts down to its extension's end, which is when it
                // stops taking pledges; `deadline` stays the first one (V74).
                ProjectCard.daysLeft("EXTENDED".equals(state) && extendedUntil != null ? extendedUntil : deadline, asOf),
                DiscoveryStatus.badgeFor(state).orElse(null),
                state,
                launchedAt,
                deadline,
                ProjectCard.closingSoon(state, deadline, extendedUntil, asOf),
                "EXTENDED".equals(state));
    }

    /**
     * A {@code timestamptz} as an instant.
     *
     * <p>Through {@code OffsetDateTime} rather than {@code getTimestamp}, which
     * reinterprets the value in the JVM's default zone and would make a deadline move
     * when the server's zone did.
     */
    static Instant instantOf(ResultSet resultSet, String column) throws SQLException {
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
