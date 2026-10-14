package az.ideanest.analytics.application;

import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * The platform's own figures — §4.11's AD-13, issue #313.
 *
 * <p>#313 was blocked on "#95 aggregates one campaign, not the platform", and that is
 * exactly right: {@code ProjectAnalytics} answers a creator asking how their campaign is
 * doing, and every query behind it is filtered by {@code project_id}. What this answers is
 * a different question with the same nouns — how the platform is doing — and the rows it
 * reads are the same daily rollups, summed the other way.
 *
 * <p><strong>Every figure here is derived from rollups that already exist.</strong> That is
 * what made this unblockable without new tables: V27 writes one row per campaign per day,
 * and "volume across the platform" is that table grouped by day instead of by campaign.
 *
 * @param from the first day counted, inclusive
 * @param to the last, inclusive
 * @param computedAt when this was read, so a stale tab is not mistaken for a live figure
 * @param totals the headline numbers over the whole window
 * @param daily one point per day, for the chart
 * @param outcomes how campaigns that closed in the window ended — §4.11's "success rate"
 */
public record PlatformAnalytics(
        LocalDate from,
        LocalDate to,
        Instant computedAt,
        Totals totals,
        List<DailyPoint> daily,
        Outcomes outcomes) {

    /**
     * The headline figures.
     *
     * @param pledgeCount how many pledges were made in the window
     * @param volume what they came to. §21.2 gives nothing to convert with, so this is
     *     denominated in the platform currency and campaigns in another are counted in
     *     {@link #otherCurrencyPledges} rather than converted — a total that silently
     *     added two currencies would be a number nobody could reconcile
     * @param averagePledge {@code volume / pledgeCount}, or zero when nothing was pledged.
     *     Computed here rather than in the browser because dividing money is exactly what
     *     {@link Money} refuses to let callers do carelessly
     * @param backerCount distinct accounts that pledged. Not the same as
     *     {@code pledgeCount}: a backer who pledges to three campaigns is three pledges and
     *     one person, and conflating them overstates reach by whatever the platform's
     *     repeat rate is
     * @param liveProjects campaigns that were {@code LIVE} at the end of the window
     * @param otherCurrencyPledges pledges excluded from {@link #volume} because they were
     *     in another currency. Reported rather than dropped: a figure with a silent
     *     exclusion is worse than one with a stated gap
     * @param planRevenue what creators paid for plans in the window, net of reversals, in the
     *     platform currency (#478). The platform's own income, unlike {@link #volume}, which is
     *     the backers' money held for campaigns
     * @param planPayments how many plan payments came in
     */
    public record Totals(
            long pledgeCount,
            Money volume,
            Money averagePledge,
            long backerCount,
            long liveProjects,
            long otherCurrencyPledges,
            Money planRevenue,
            long planPayments) {
    }

    /**
     * One day.
     *
     * @param day the calendar day, in the platform's reporting time zone. V27 stores the
     *     zone on the row for the same reason: a day is not a fixed number of hours from
     *     anybody's point of view except the one that named it
     */
    public record DailyPoint(LocalDate day, long pledgeCount, Money volume) {
    }

    /**
     * How campaigns that closed in the window ended.
     *
     * <p>§4.11 asks for a "success rate", and this is the honest form of it: the two counts
     * and the campaigns still running, rather than one percentage. A single rate would have
     * to decide what to do with campaigns that are neither — and every choice it could make
     * is wrong in a month where a lot of campaigns launched.
     *
     * @param succeeded reached the goal by the deadline
     * @param failed did not
     * @param successRate the fraction, or null when nothing closed in the window. Null
     *     rather than zero, because "no campaigns closed" and "none of them succeeded" are
     *     different facts and a zero on a dashboard reads as the second
     */
    public record Outcomes(long succeeded, long failed, Double successRate) {

        /** The two counts and the rate they imply. */
        public static Outcomes of(long succeeded, long failed) {
            long closed = succeeded + failed;
            return new Outcomes(succeeded, failed, closed == 0 ? null : (double) succeeded / closed);
        }
    }
}
