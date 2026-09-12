package az.ideanest.subscription.api;

import az.ideanest.subscription.application.PaymentPage;
import az.ideanest.subscription.application.RevenueExport;
import az.ideanest.subscription.application.RevenueFilter;
import az.ideanest.subscription.application.RevenuePeriod;
import az.ideanest.subscription.application.RevenueReport;
import az.ideanest.subscription.application.SubscriptionRevenue;
import az.ideanest.subscription.domain.PaymentMethod;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * AD-11's third screen: what the subscriptions actually brought in — #23.
 *
 * <h2>Three endpoints, one question</h2>
 *
 * <p>{@code /revenue} is the totals, {@code /payments} is the list behind them, and
 * {@code /payments/export} is that list as a file. Separate rather than one response
 * carrying all three, because the totals are what the screen opens on and the list is
 * paged: folding them together would make every page of the table recompute the month's
 * figures, and a total that flickered while somebody paged would be a total nobody trusts.
 *
 * <p>They take the <strong>same period and the same filters</strong>, which is what makes
 * the screen coherent — the table is the rows behind the figure above it, and the export is
 * what is on screen rather than a different question with a similar name.
 *
 * <h2>The period is half-open and defaults to this month</h2>
 *
 * <p>{@link RevenuePeriod} argues both, and the second at length: an unbounded report is
 * every payment the platform has ever taken, one absent parameter away. The month is
 * Baku's rather than UTC's, for the reason {@code project_analytics_daily} gives — the last
 * four hours of a local month would otherwise fall into the next one and the figure would
 * disagree with the bank statement it is checked against.
 *
 * <h2>{@code no-store}, and staff-only</h2>
 *
 * <p>Like everything under this prefix. One more reason here: these responses carry every
 * paying creator's address beside what they paid, so a cached copy is a subscriber list in
 * an intermediary. {@code CONFIGURE_PLATFORM} is checked in the service —
 * {@link SubscriptionRevenue} says why there, and why it is the same capability that
 * administers the plans rather than a narrower one of its own.
 */
@RestController
@RequestMapping("/v1/admin/subscription")
public class SubscriptionRevenueController {

    private final SubscriptionRevenue revenue;
    private final Clock clock;

    public SubscriptionRevenueController(SubscriptionRevenue revenue, Clock clock) {
        this.revenue = revenue;
        this.clock = clock;
    }

    /**
     * The totals for a period: per currency, per plan, per method.
     *
     * @param from inclusive. Absent with {@code to} means this month; absent with a
     *     {@code to} means the month {@code to} falls in
     * @param to exclusive
     * @param planCode one plan, by the code its payments carry. The code rather than the
     *     identifier because it is the handle that cannot be edited
     * @param accountId one account, which is the per-account history this and the console's
     *     account page share
     * @param method one way of being paid
     */
    @GetMapping("/revenue")
    public ResponseEntity<SubscriptionRevenueResponses.SubscriptionRevenueReport> report(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to,
            @RequestParam(required = false) String planCode,
            @RequestParam(required = false) UUID accountId,
            @RequestParam(required = false) PaymentMethod method) {

        RevenueReport report = revenue.report(
                staffOf(accessToken),
                RevenuePeriod.of(from, to, clock),
                new RevenueFilter(planCode, accountId, method));

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(SubscriptionRevenueResponses.SubscriptionRevenueReport.of(report));
    }

    /**
     * One page of payments, newest first by when the money arrived.
     *
     * @param after the previous page's {@code nextCursor}. Opaque, and a value this
     *     endpoint did not issue is a 400 rather than the first page again — serving the
     *     top of the list to somebody paging through it is how a reconciliation counts a
     *     page twice
     * @param limit clamped rather than refused, following every other console list
     */
    @GetMapping("/payments")
    public ResponseEntity<SubscriptionRevenueResponses.SubscriptionPaymentList> payments(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to,
            @RequestParam(required = false) String planCode,
            @RequestParam(required = false) UUID accountId,
            @RequestParam(required = false) PaymentMethod method,
            @RequestParam(required = false) String after,
            @RequestParam(required = false) Integer limit) {

        PaymentPage page = revenue.payments(
                staffOf(accessToken),
                RevenuePeriod.of(from, to, clock),
                new RevenueFilter(planCode, accountId, method),
                after,
                limit);

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(SubscriptionRevenueResponses.SubscriptionPaymentList.of(page));
    }

    /**
     * The same list as a CSV file.
     *
     * <p>{@code text/csv} rather than JSON carrying a string, so a browser saves it and a
     * spreadsheet opens it without a client in between — {@code BackerReportController}'s
     * arrangement, including the two headers that say what the body cannot say about
     * itself:
     *
     * <ul>
     *   <li>{@code Content-Disposition} names the file, with the period and the day it was
     *       taken.
     *   <li><strong>{@code X-Export-Truncated}</strong> and {@code X-Export-Rows} report
     *       whether the cap was reached. A revenue export missing its tail looks exactly
     *       like a complete one and it will be added up. Headers rather than fields because
     *       the body is a file, and a CSV with a status line in it is a CSV that breaks
     *       every importer.
     * </ul>
     *
     * <p>A {@code GET} rather than a {@code POST}, unlike the backer export: that one takes
     * a filter body big enough to need one, and this is four query parameters — so the link
     * on the screen is an ordinary link, and the file somebody was looking at is the file
     * they get. It is audited on the way out regardless of the method.
     */
    @GetMapping("/payments/export")
    public ResponseEntity<byte[]> export(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to,
            @RequestParam(required = false) String planCode,
            @RequestParam(required = false) UUID accountId,
            @RequestParam(required = false) PaymentMethod method) {

        RevenueExport export = revenue.export(
                staffOf(accessToken),
                RevenuePeriod.of(from, to, clock),
                new RevenueFilter(planCode, accountId, method));

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(
                        "Content-Disposition",
                        ContentDisposition.attachment()
                                .filename(export.filename(), StandardCharsets.UTF_8)
                                .build()
                                .toString())
                .header("X-Export-Rows", String.valueOf(export.rows()))
                .header("X-Export-Truncated", String.valueOf(export.truncated()))
                // The charset is on the content type as well as in the byte order mark: the
                // mark is for the spreadsheet that opens the saved file, and this is for the
                // client that receives it.
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(export.csv().getBytes(StandardCharsets.UTF_8));
    }

    private static UUID staffOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
