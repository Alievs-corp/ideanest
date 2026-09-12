package az.ideanest.subscription;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.Identifiers;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.user.infrastructure.UserRepository;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The subscription revenue report over HTTP — #23.
 *
 * <p><strong>The tests that carry the design are {@link #reversalsNetAndAreShownSeparately()},
 * {@link #aRenamedPlanIsTwoRowsUnderOneCode()} and
 * {@link #aPaymentFromAClosedAccountStillCounts()}.</strong> The first is what makes a total
 * reconcilable against a bank statement; the second is V73's snapshot argument reaching the
 * screen; the third is the missing foreign key doing the job it was left out for.
 *
 * <p><strong>No cleanup, and none is possible</strong> — V73 refuses DELETE and TRUNCATE.
 * Every test invents a plan code of its own and, where it needs a quiet window, a period in
 * a year nothing else writes to. Every assertion is scoped to those, which is how any reader
 * of an append-only table has to work.
 */
class SubscriptionRevenueApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** The address {@code application-test.yml} bootstraps as an administrator. */
    private static final String ADMIN_EMAIL = "moderator@ideanest.test";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private AccessTokenIssuer tokens;

    private String adminToken;

    private UUID adminId;

    @Test
    @DisplayName("a reversal nets against the total, and is still shown as a reversal")
    void reversalsNetAndAreShownSeparately() {
        String plan = planCode();
        Window window = quietWindow();
        UUID paid = insert(plan, "Growth", "49.00", window.at(1), null, UUID.randomUUID(), "BANK_TRANSFER", null);
        insert(plan, "Growth", "49.00", window.at(2), null, UUID.randomUUID(), "BANK_TRANSFER", null);
        insert(plan, "Growth", "-49.00", window.at(3), paid, UUID.randomUUID(), "BANK_TRANSFER", null);

        Map<String, Object> report = get(window.query("/v1/admin/subscription/revenue") + "&planCode=" + plan).getBody();

        Map<String, Object> azn = only(report.get("currencies"));
        // Three figures, so that `gross + reversed = net` is arithmetic somebody can check
        // on the screen against a statement rather than one number they have to trust.
        assertThat(azn.get("gross")).isEqualTo("98.00");
        assertThat(azn.get("reversed")).isEqualTo("-49.00");
        assertThat(azn.get("net")).isEqualTo("49.00");
        assertThat(azn.get("payments")).isEqualTo(2);
        assertThat(azn.get("reversals")).isEqualTo(1);
        assertThat(azn.get("currency")).isEqualTo("AZN");
    }

    @Test
    @DisplayName("a plan renamed mid-period is two rows under one code, not one row retitled")
    void aRenamedPlanIsTwoRowsUnderOneCode() {
        String plan = planCode();
        Window window = quietWindow();
        insert(plan, "Growth", "49.00", window.at(1), null, UUID.randomUUID(), "BANK_TRANSFER", null);
        insert(plan, "Studio", "49.00", window.at(2), null, UUID.randomUUID(), "BANK_TRANSFER", null);

        List<Map<String, Object>> plans =
                list(get(window.query("/v1/admin/subscription/revenue") + "&planCode=" + plan).getBody().get("plans"));

        // Both names were true when that money arrived. Choosing one for the group would
        // retitle the other month's figure, which is what V73 exists to prevent.
        assertThat(plans).extracting(row -> row.get("planName")).containsExactly("Growth", "Studio");
        assertThat(plans).allSatisfy(row -> {
            assertThat(row.get("planCode")).isEqualTo(plan);
            assertThat(row.get("net")).isEqualTo("49.00");
        });
    }

    @Test
    @DisplayName("the period is half-open: its start is in it and its end is not")
    void theWindowIsHalfOpen() {
        String plan = planCode();
        Window window = quietWindow();
        insert(plan, "Starter", "19.00", window.from(), null, UUID.randomUUID(), "BANK_TRANSFER", null);
        insert(plan, "Starter", "23.00", window.to(), null, UUID.randomUUID(), "BANK_TRANSFER", null);

        Map<String, Object> azn =
                only(get(window.query("/v1/admin/subscription/revenue") + "&planCode=" + plan).getBody().get("currencies"));

        // Consecutive months then add up to the year: a payment at midnight is in exactly
        // one of them.
        assertThat(azn.get("net")).isEqualTo("19.00");
    }

    @Test
    @DisplayName("the list pages by cursor, without repeating or skipping rows that share a date")
    void pagingSurvivesTiesOnTheDate() {
        String plan = planCode();
        Window window = quietWindow();
        // One sitting entering last month's transfers: the same received_at on every row,
        // which is the normal case on this table rather than the edge one.
        Instant sameDay = window.at(1);
        List<UUID> inserted = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            inserted.add(insert(plan, "Starter", "19.00", sameDay, null, UUID.randomUUID(), "BANK_TRANSFER", null));
        }

        List<Object> seen = new ArrayList<>();
        String cursor = null;
        int pages = 0;
        do {
            String url = window.query("/v1/admin/subscription/payments") + "&planCode=" + plan + "&limit=2"
                    + (cursor == null ? "" : "&after=" + cursor);
            Map<String, Object> page = get(url).getBody();
            list(page.get("payments")).forEach(row -> seen.add(row.get("id")));
            cursor = (String) page.get("nextCursor");
            pages++;
        } while (cursor != null && pages < 10);

        assertThat(pages).isEqualTo(3);
        assertThat(seen).hasSize(5).doesNotHaveDuplicates();
        assertThat(seen).containsExactlyInAnyOrderElementsOf(inserted.stream().map(UUID::toString).toList());
    }

    @Test
    @DisplayName("the last page says there is nothing after it, rather than handing out a cursor to an empty page")
    void theEndIsStated() {
        String plan = planCode();
        Window window = quietWindow();
        insert(plan, "Starter", "19.00", window.at(1), null, UUID.randomUUID(), "BANK_TRANSFER", null);
        insert(plan, "Starter", "19.00", window.at(2), null, UUID.randomUUID(), "BANK_TRANSFER", null);

        Map<String, Object> page =
                get(window.query("/v1/admin/subscription/payments") + "&planCode=" + plan + "&limit=2").getBody();

        assertThat(list(page.get("payments"))).hasSize(2);
        assertThat(page.get("nextCursor")).isNull();
    }

    @Test
    @DisplayName("a cursor this endpoint did not issue is refused, not answered with the first page")
    void aForgedCursorIsRefused() {
        ResponseEntity<Map<String, Object>> refused = get("/v1/admin/subscription/payments?after=not-a-cursor");

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("code")).isEqualTo("INVALID_CURSOR");
    }

    @Test
    @DisplayName("a period that ends before it begins is refused")
    void aBackwardsPeriodIsRefused() {
        ResponseEntity<Map<String, Object>> refused = get(
                "/v1/admin/subscription/revenue?from=2026-05-02T00:00:00Z&to=2026-05-01T00:00:00Z");

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("code")).isEqualTo("INVALID_REVENUE_PERIOD");
    }

    @Test
    @DisplayName("a payment from a closed account still counts, with nothing to name the payer")
    void aPaymentFromAClosedAccountStillCounts() {
        String plan = planCode();
        Window window = quietWindow();
        // An account identifier that names no row: the account was closed and V62
        // cascaded its subscription away. The receipt stays, because V73 has no key to
        // cascade through — and a report that dropped it would under-report revenue by
        // everybody who has since left.
        UUID gone = Identifiers.newIdentifier();
        insert(plan, "Pro", "149.00", window.at(1), null, gone, "BANK_TRANSFER", null);

        Map<String, Object> payment =
                only(get(window.query("/v1/admin/subscription/payments") + "&planCode=" + plan).getBody().get("payments"));
        assertThat(payment.get("accountId")).isEqualTo(gone.toString());
        assertThat(payment.get("accountEmail")).isNull();
        assertThat(payment.get("amount")).isEqualTo("149.00");

        assertThat(only(get(window.query("/v1/admin/subscription/revenue") + "&planCode=" + plan)
                                .getBody()
                                .get("currencies"))
                        .get("net"))
                .isEqualTo("149.00");
    }

    @Test
    @DisplayName("filters combine: one account, one method")
    void filtersCombine() {
        String plan = planCode();
        Window window = quietWindow();
        UUID account = UUID.randomUUID();
        insert(plan, "Starter", "19.00", window.at(1), null, account, "BANK_TRANSFER", null);
        insert(plan, "Starter", "19.00", window.at(2), null, account, "CASH", null);
        insert(plan, "Starter", "19.00", window.at(3), null, UUID.randomUUID(), "CASH", null);

        Map<String, Object> report = get(window.query("/v1/admin/subscription/revenue")
                        + "&planCode=" + plan + "&accountId=" + account + "&method=CASH")
                .getBody();

        assertThat(only(report.get("currencies")).get("net")).isEqualTo("19.00");
        assertThat(only(report.get("methods")).get("method")).isEqualTo("CASH");
        // The filter comes back with the figures, so the screen can say what it is showing.
        assertThat(((Map<?, ?>) report.get("filter")).get("accountId")).isEqualTo(account.toString());
    }

    @Test
    @DisplayName("a plan code filter matches however it is cased, in an Azerbaijani locale too")
    void planCodeFilterFoldsInTheRootLocale() {
        // `i` upper-cases to `İ` under Azerbaijani and Turkish rules. A filter folded in the
        // default locale would match nothing for any plan code containing one.
        Locale previous = Locale.getDefault();
        String plan = "REVI" + suffix();
        Window window = quietWindow();
        insert(plan, "Mini", "9.00", window.at(1), null, UUID.randomUUID(), "BANK_TRANSFER", null);
        try {
            Locale.setDefault(Locale.forLanguageTag("az"));
            Map<String, Object> report = get(window.query("/v1/admin/subscription/revenue")
                            + "&planCode=" + plan.toLowerCase(Locale.ROOT))
                    .getBody();

            assertThat(only(report.get("currencies")).get("net")).isEqualTo("9.00");
        } finally {
            Locale.setDefault(previous);
        }
    }

    @Test
    @DisplayName("the export is a CSV a spreadsheet can sum, and it says how many rows it holds")
    void theExportIsASpreadsheetThatAddsUp() {
        String plan = planCode();
        Window window = quietWindow();
        UUID paid = insert(plan, "Growth", "49.00", window.at(1), null, UUID.randomUUID(), "BANK_TRANSFER", "=cmd|' /C calc'!A0");
        insert(plan, "Growth", "-49.00", window.at(2), paid, UUID.randomUUID(), "BANK_TRANSFER", null);

        ResponseEntity<byte[]> export = rest.exchange(
                window.query("/v1/admin/subscription/payments/export") + "&planCode=" + plan,
                HttpMethod.GET,
                new HttpEntity<>(authorised(admin())),
                byte[].class);

        assertThat(export.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(export.getHeaders().getContentType().toString()).startsWith("text/csv");
        assertThat(export.getHeaders().getFirst("X-Export-Rows")).isEqualTo("2");
        assertThat(export.getHeaders().getFirst("X-Export-Truncated")).isEqualTo("false");
        assertThat(export.getHeaders().getFirst("Content-Disposition")).contains("subscription-revenue-");

        String csv = new String(export.getBody(), StandardCharsets.UTF_8);
        // The byte order mark, without which Excel on Windows opens every Azerbaijani name
        // as mojibake.
        assertThat(csv).startsWith("﻿received_at,");
        List<String> lines = csv.lines().toList();
        assertThat(lines).hasSize(3);

        // The reversal's amount is a number a spreadsheet can sum, not text. Routed through
        // the formula defence it would be `'-49.00`, and the column would total 49 higher
        // than the platform kept.
        assertThat(lines.get(1)).contains(",-49.00,AZN,");
        assertThat(lines.get(1)).doesNotContain("'-49.00");
        // And the reference somebody typed is defused.
        assertThat(lines.get(2)).contains("'=cmd");

        // The export is the one read that is audited: it takes the subscriber list off the
        // platform.
        assertThat(new JdbcTemplate(dataSource)
                        .queryForObject(
                                "SELECT count(*) FROM audit_logs WHERE action = 'subscription.revenue_exported'"
                                        + " AND actor_id = ? AND detail LIKE ?",
                                Integer.class,
                                adminId,
                                "%plan=" + plan + ";%"))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("money travels as strings")
    void amountsAreStrings() {
        String plan = planCode();
        Window window = quietWindow();
        insert(plan, "Starter", "19.90", window.at(1), null, UUID.randomUUID(), "BANK_TRANSFER", null);

        Map<String, Object> report = get(window.query("/v1/admin/subscription/revenue") + "&planCode=" + plan).getBody();

        assertThat(only(report.get("currencies")).get("net")).isInstanceOf(String.class).isEqualTo("19.90");
        assertThat(only(report.get("plans")).get("net")).isInstanceOf(String.class);
    }

    @Test
    @DisplayName("the report is not open to somebody without CONFIGURE_PLATFORM")
    void theReportIsStaffOnly() {
        String creator = signIn(EmailAddress.of("revenue-reader" + SEQUENCE.incrementAndGet() + "@example.com"));

        for (String path : List.of(
                "/v1/admin/subscription/revenue",
                "/v1/admin/subscription/payments",
                "/v1/admin/subscription/payments/export")) {
            ResponseEntity<String> refused =
                    rest.exchange(path, HttpMethod.GET, new HttpEntity<>(authorised(creator)), String.class);
            assertThat(refused.getStatusCode()).as(path).isEqualTo(HttpStatus.FORBIDDEN);
        }
    }

    /* ------------------------------------------------------------------
     * Fixtures
     * --------------------------------------------------------------- */

    /**
     * A week in a year nothing else in the build writes payments to, so a test that reads
     * a whole window is not reading another test's rows. Random within 1990s so that two
     * tests in one run do not share one either.
     */
    private record Window(Instant from, Instant to) {

        Instant at(int hours) {
            return from.plusSeconds(hours * 3600L);
        }

        String query(String path) {
            return path + "?from=" + from + "&to=" + to;
        }
    }

    private static Window quietWindow() {
        long day = ThreadLocalRandom.current().nextLong(0, 3000);
        Instant from = Instant.parse("1991-01-01T00:00:00Z").plusSeconds(day * 86_400L);
        return new Window(from, from.plusSeconds(7 * 86_400L));
    }

    private static String planCode() {
        return "REV" + suffix();
    }

    private static String suffix() {
        return Long.toString(ThreadLocalRandom.current().nextLong(1L << 40), 36).toUpperCase(Locale.ROOT)
                + SEQUENCE.incrementAndGet();
    }

    /** One journal row, written straight to V73's table: there is no endpoint that writes a backdated reversal. */
    private UUID insert(
            String planCode,
            String planName,
            String amount,
            Instant receivedAt,
            UUID reverses,
            UUID accountId,
            String method,
            String reference) {

        UUID id = Identifiers.newIdentifier();
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO subscription_payments (
                            id, subscription_id, account_id, plan_id, plan_code, plan_name,
                            amount, currency, billing_period, method, reference, received_at, reverses)
                        VALUES (?, ?, ?, ?, ?, ?, ?::numeric, 'AZN', 'MONTHLY', ?, ?, ?, ?)
                        """,
                        id,
                        Identifiers.newIdentifier(),
                        accountId,
                        Identifiers.newIdentifier(),
                        planCode,
                        planName,
                        amount,
                        method,
                        reference,
                        Timestamp.from(receivedAt),
                        reverses);
        return id;
    }

    private ResponseEntity<Map<String, Object>> get(String path) {
        return rest.exchange(path, HttpMethod.GET, new HttpEntity<>(authorised(admin())), mapType());
    }

    /**
     * The bootstrapped administrator, with a token issued rather than signed in for —
     * {@code SubscriptionApiTests}' arrangement and its reason: a dozen suites use this
     * address, and a suite that spent sign-ins on it would exhaust the limiter for the next.
     */
    private String admin() {
        if (adminToken != null) {
            return adminToken;
        }
        EmailAddress email = EmailAddress.of(ADMIN_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Administrator"),
                    String.class);
        }
        adminId = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        adminToken = tokens.issue(
                        adminId,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();
        return adminToken;
    }

    private String signIn(EmailAddress email) {
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Revenue Reader"),
                String.class);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), headers),
                mapType());
        return (String) signedIn.getBody().get("accessToken");
    }

    private static HttpHeaders authorised(String accessToken) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        headers.setAccept(List.of(MediaType.APPLICATION_JSON, MediaType.valueOf("text/csv")));
        return headers;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> list(Object value) {
        return (List<Map<String, Object>>) value;
    }

    private static Map<String, Object> only(Object value) {
        List<Map<String, Object>> rows = list(value);
        assertThat(rows).hasSize(1);
        return rows.get(0);
    }

    private static ParameterizedTypeReference<Map<String, Object>> mapType() {
        return new ParameterizedTypeReference<>() {};
    }
}
