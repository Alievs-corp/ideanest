package az.ideanest.discovery.domain;

import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/**
 * One campaign as a feed shows it — D-05: "image, title, creator, completion, days
 * left, badge".
 *
 * <p>Deliberately not the project page. A card carries what a grid renders and
 * nothing that costs a join nobody looks at: no story, no rewards, no tags, no
 * counts that would have to be aggregated per row. §20 asks for a thousand requests
 * a second at p99 under 300ms, and the shape of this record is most of what decides
 * whether that is achievable — a field added here is a field fetched for every card
 * on every page for everybody.
 *
 * <p><strong>Money is {@link Money}, and reaches the client as a string.</strong>
 * §10.3 and {@code CLAUDE.md}. {@link #completionPercent} is a {@code BigDecimal}
 * for the same reason: it is a ratio of two money values, and computing it as a
 * {@code double} would reintroduce the error the string exists to prevent, at the
 * one place a backer actually reads it.
 *
 * @param id the campaign
 * @param slug its half of {@code /projects/{creatorSlug}/{projectSlug}}
 * @param creatorSlug the other half
 * @param title as the creator wrote it
 * @param creator who is asking for the money
 * @param coverImage null while the campaign has none; §5.3 requires one to submit,
 *     and a {@code PRELAUNCH} teaser has not submitted
 * @param goal null on a campaign that has not set one — a {@code PRELAUNCH} row
 * @param pledged never null; the column defaults to zero
 * @param completionPercent null when there is no goal to be a percentage of
 * @param backersCount never null
 * @param daysLeft null when there is no deadline; zero once the deadline has passed
 * @param badge which of §4.3's five words describes this campaign, or null for a
 *     state no word covers — {@code CANCELED}
 * @param state the internal state, so a client can render something specific
 *     without this module having to invent a sixth word for it
 * @param closingSoon §4.3's "Closing soon" (IDN-EXT-01, #37) — see {@link #closingSoon}
 * @param extended §4.3's "Extended": the campaign is in {@code EXTENDED}. A card can carry
 *     both, and both beside its badge
 */
public record ProjectCard(
        UUID id,
        String slug,
        String creatorSlug,
        String title,
        Creator creator,
        CoverImage coverImage,
        Money goal,
        Money pledged,
        BigDecimal completionPercent,
        int backersCount,
        Integer daysLeft,
        DiscoveryStatus badge,
        String state,
        Instant launchedAt,
        Instant deadline,
        boolean closingSoon,
        boolean extended) {

    /** How near its end a funding campaign is badged "Closing soon" — IDN-EXT-01 (#37). */
    public static final Duration CLOSING_SOON = Duration.ofDays(14);

    /** @param avatarUrl null for an account that never uploaded one */
    public record Creator(String name, String slug, String avatarUrl) {
    }

    /**
     * The interim cover image of V6, as the client reported it.
     *
     * <p>The dimensions are what makes a grid able to reserve the right space before
     * the image loads, which is the difference between a feed that settles and one
     * that shifts under the reader's cursor.
     */
    public record CoverImage(String url, int width, int height) {
    }

    /**
     * How far along, as a percentage, to two decimal places.
     *
     * <p><strong>Rounded down.</strong> A campaign at 99.999% must not render as
     * "100.00%" beside a progress bar and a "back this project" button — the one
     * number a backer reads as "it made it" is the one number that must never be
     * generous. Truncation is the only rounding mode that cannot over-report.
     *
     * @return null when the campaign has no goal, because a percentage of nothing is
     *     not zero, it is undefined, and rendering "0%" would say the campaign has
     *     raised nothing rather than that it has not asked for anything yet
     */
    public static BigDecimal completionPercent(BigDecimal pledged, BigDecimal goal) {
        if (goal == null || goal.signum() <= 0 || pledged == null) {
            return null;
        }
        return pledged.multiply(new BigDecimal("100")).divide(goal, 2, RoundingMode.DOWN);
    }

    /**
     * Whether a card is badged "Closing soon" — IDN-EXT-01 (#37), §4.3.
     *
     * <p>Every campaign in the seven days after its first deadline, and a live or extended one
     * with {@link #CLOSING_SOON} or less to go — measured to the extension's end for an
     * extended campaign, so it can be extended and closing soon at once. A live campaign past
     * its deadline that the finaliser has not reached yet is closing soon too: it is.
     */
    public static boolean closingSoon(String state, Instant deadline, Instant extendedUntil, Instant now) {
        return switch (state) {
            case "CLOSING_WINDOW" -> true;
            case "LIVE" -> endsWithin(deadline, now);
            case "EXTENDED" -> endsWithin(extendedUntil, now);
            default -> false;
        };
    }

    private static boolean endsWithin(Instant end, Instant now) {
        return end != null && !Duration.between(now, end).minus(CLOSING_SOON).isPositive();
    }

    /**
     * Whole days remaining, never negative.
     *
     * <p>Rounded up, so that a campaign with eighteen hours left says "1 day" rather
     * than "0 days" while it is still taking pledges. Zero means the deadline has
     * passed, and is reached only through the round-up being unable to save it.
     *
     * @return null when the campaign has no deadline
     */
    public static Integer daysLeft(Instant deadline, Instant now) {
        if (deadline == null) {
            return null;
        }
        Duration remaining = Duration.between(now, deadline);
        if (remaining.isNegative() || remaining.isZero()) {
            return 0;
        }
        long days = remaining.toDays();
        return (int) (remaining.minusDays(days).isZero() ? days : days + 1);
    }
}
