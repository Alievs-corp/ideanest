package az.ideanest.staff;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.Identifiers;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.AdjustableClock;
import az.ideanest.user.infrastructure.UserRepository;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
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
 * What a partner is shown, and what they cannot be shown — #205, part of #202.
 *
 * <p><strong>The platform's real journal for June 2050, and a clock standing in it.</strong>
 * Other suites write payments in the current month, so a test that read "this month" would be
 * reading their rows too. The journal is append-only and these rows live in a year nothing else
 * in the build writes to, so every figure below is the one this file put there:
 *
 * <pre>
 * 2050-05-20   2 payments of 49.00                               (last month)
 * 2050-06-03   4 payments of 100.00
 * 2050-06-04   1 reversal of -100.00
 * 2050-06-15   payments of 49.00, 49.00 and 102.00               (today, Baku)
 *
 * this month   net 500.00   7 payments   1 reversal
 * today        net 200.00   3 payments
 * </pre>
 *
 * <p>Each payment carries a recognisable reference, and the tests look for it, for the payer's
 * account and for every identifier in the response. A partner response that contained any of
 * them would be a transaction leaking, and "the field is not in the record" is weaker evidence
 * than "the string is not in the bytes".
 */
class PartnerStatisticsApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";
    private static final String FIXTURE_NOTE = "partner statistics fixture";
    private static final String PARTNER_GRANT_NOTE = "partner profile";

    /** 14:00 in Baku on 15 June 2050, so "today" there is the 15th. */
    private static final Instant NOW = Instant.parse("2050-06-15T10:00:00Z");

    private static final ParameterizedTypeReference<Map<String, Object>> OBJECT =
            new ParameterizedTypeReference<Map<String, Object>>() {};

    /** What this file's payments carry, so the tests can look for it in a response. */
    private static final String SECRET_REFERENCE = "SECRET-REF-";

    private static boolean journalSeeded;
    private static Account moderator;

    /** Every payer, so a test can assert that none of them appears in a response. */
    private static final List<UUID> PAYERS = new ArrayList<>();

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private AdjustableClock clock;

    @BeforeEach
    void standInJune2050() {
        seedTheJournal();
        clock.freeze();
        clock.advance(Duration.between(clock.instant(), NOW));
    }

    @AfterEach
    void clear() {
        clock.reset();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM partner_profiles");
        jdbc.update("DELETE FROM staff_role_grants WHERE note IN (?, ?)", FIXTURE_NOTE, PARTNER_GRANT_NOTE);
    }

    // ------------------------------------------------------------------
    // The owner's examples, end to end
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a super admin sees the real figures: view REAL, share 100.00")
    void aSuperAdminSeesTheRealFigures() {
        Account admin = staff("stats-admin", StaffRole.SUPER_ADMIN);

        Map<String, Object> statistics = statistics(admin).getBody();

        assertThat(statistics).containsEntry("view", "REAL").containsEntry("sharePercentage", "100.00");
        assertThat(only(section(statistics, "today").get("currencies")))
                .containsEntry("currency", "AZN")
                .containsEntry("revenue", "200.00")
                .containsEntry("subscriptions", "3.00")
                .containsEntry("reversals", "0.00");
        assertThat(only(section(statistics, "thisMonth").get("currencies")))
                .containsEntry("revenue", "500.00")
                .containsEntry("subscriptions", "7.00")
                .containsEntry("reversals", "1.00");
    }

    @Test
    @DisplayName("a 50% partner sees exactly half of every figure, money and counts alike")
    void aHalfPartnerSeesHalf() {
        Account admin = staff("stats-admin", StaffRole.SUPER_ADMIN);
        Account partner = partnerAt("50", admin);

        Map<String, Object> statistics = statistics(partner).getBody();

        assertThat(statistics).containsEntry("view", "PARTNER").containsEntry("sharePercentage", "50.00");
        assertThat(only(section(statistics, "today").get("currencies")))
                .containsEntry("revenue", "100.00")
                .containsEntry("subscriptions", "1.50")
                .containsEntry("reversals", "0.00");
        assertThat(only(section(statistics, "thisMonth").get("currencies")))
                .containsEntry("revenue", "250.00")
                .containsEntry("subscriptions", "3.50")
                .containsEntry("reversals", "0.50");
    }

    @Test
    @DisplayName("the percentage is the partner's own: 30% sees 30% and is not shown the 50% figure")
    void eachPartnerSeesTheirOwnShare() {
        Account admin = staff("stats-admin", StaffRole.SUPER_ADMIN);
        Account thirty = partnerAt("30", admin);

        Map<String, Object> statistics = statistics(thirty).getBody();

        assertThat(only(section(statistics, "thisMonth").get("currencies"))).containsEntry("revenue", "150.00");
        assertThat(statistics).containsEntry("sharePercentage", "30.00");
    }

    @Test
    @DisplayName("two partners at 50% between them see exactly what the super admin sees")
    void twoHalvesMakeTheWhole() {
        Account admin = staff("stats-admin", StaffRole.SUPER_ADMIN);
        Account first = partnerAt("50", admin);
        Account second = partnerAt("50", admin);

        BigDecimal real = revenueThisMonth(statistics(admin).getBody());
        BigDecimal one = revenueThisMonth(statistics(first).getBody());
        BigDecimal two = revenueThisMonth(statistics(second).getBody());

        assertThat(one.add(two)).isEqualByComparingTo(real);
    }

    @Test
    @DisplayName("the days, the last twelve months and the plans are scaled too, from the same journal")
    void everySectionIsScaled() {
        Account admin = staff("stats-admin", StaffRole.SUPER_ADMIN);
        Account partner = partnerAt("50", admin);

        Map<String, Object> real = statistics(admin).getBody();
        Map<String, Object> shared = statistics(partner).getBody();

        // Twelve months, oldest first, this one last and last month before it.
        List<Map<String, Object>> months = list(shared.get("monthly"));
        assertThat(months).hasSize(12);
        assertThat(months.get(0)).containsEntry("month", "2049-07");
        assertThat(months.get(11)).containsEntry("month", "2050-06");
        assertThat(only(months.get(10).get("currencies"))).containsEntry("revenue", "49.00");
        assertThat(only(list(real.get("monthly")).get(10).get("currencies"))).containsEntry("revenue", "98.00");
        assertThat(list(months.get(0).get("currencies"))).isEmpty();

        // The three days of June that had activity, oldest first.
        List<Map<String, Object>> days = list(shared.get("daily"));
        assertThat(days).extracting(day -> day.get("date")).containsExactly("2050-06-03", "2050-06-04", "2050-06-15");
        assertThat(only(days.get(0).get("currencies"))).containsEntry("revenue", "200.00");
        assertThat(only(days.get(1).get("currencies"))).containsEntry("revenue", "-50.00");

        // Plans, this month, each half of the real one.
        List<Map<String, Object>> plans = list(shared.get("byPlan"));
        assertThat(plans).extracting(plan -> plan.get("planCode")).containsExactly("GROWTH", "PRO");
        assertThat(plans.get(0)).containsEntry("revenue", "49.00").containsEntry("subscriptions", "1.00");
        assertThat(plans.get(1)).containsEntry("revenue", "201.00").containsEntry("subscriptions", "2.50");
    }

    // ------------------------------------------------------------------
    // What a partner cannot be shown
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a partner's response has no transaction in it: no id, no payer, no reference, no per-payment amount")
    void noTransactionCanBeInAPartnerResponse() {
        Account admin = staff("stats-admin", StaffRole.SUPER_ADMIN);
        Account partner = partnerAt("50", admin);

        ResponseEntity<String> raw = rest.exchange(
                "/v1/admin/partner-statistics", HttpMethod.GET, new HttpEntity<>(bearer(partner.accessToken())), String.class);
        String body = raw.getBody();

        assertThat(raw.getStatusCode()).isEqualTo(HttpStatus.OK);
        // The strings this file planted, in bytes rather than in a parsed record.
        assertThat(body).doesNotContain(SECRET_REFERENCE);
        for (UUID payer : PAYERS) {
            assertThat(body).doesNotContain(payer.toString());
        }
        // And no key that names a transaction, at any depth.
        Set<String> forbidden = Set.of(
                "id", "accountId", "accountEmail", "accountName", "email", "reference", "reverses", "subscriptionId",
                "planId", "method", "amount", "note", "recordedBy", "recordedAt", "receivedAt", "payer", "payments");
        assertThat(keysOf(statistics(partner).getBody())).doesNotContainAnyElementsOf(forbidden);
    }

    @Test
    @DisplayName("a parameter cannot widen what a partner receives: the request has none that mean anything")
    void noParameterWidensTheAnswer() {
        Account admin = staff("stats-admin", StaffRole.SUPER_ADMIN);
        Account partner = partnerAt("50", admin);

        String hostile = "?view=REAL&percentage=100&share=100&accountId=" + admin.id()
                + "&from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z&admin=true";
        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/v1/admin/partner-statistics" + hostile,
                HttpMethod.GET,
                new HttpEntity<>(bearer(partner.accessToken())),
                OBJECT);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).containsEntry("view", "PARTNER").containsEntry("sharePercentage", "50.00");
        assertThat(only(section(response.getBody(), "thisMonth").get("currencies"))).containsEntry("revenue", "250.00");
    }

    @Test
    @DisplayName("a partner is refused every endpoint that lists transactions, even with the statistics open")
    void aPartnerStillReadsNoTransaction() {
        Account admin = staff("stats-admin", StaffRole.SUPER_ADMIN);
        Account partner = partnerAt("50", admin);

        for (String path : List.of(
                "/v1/admin/subscription/payments",
                "/v1/admin/subscription/revenue",
                "/v1/admin/payments",
                "/v1/admin/ledger",
                "/v1/admin/audit")) {
            assertThat(get(path, partner).getStatusCode()).as(path).isEqualTo(HttpStatus.FORBIDDEN);
        }
    }

    @Test
    @DisplayName("a partner with no percentage is refused, and never shown the real figures")
    void aPartnerWithoutAPercentageGetsNothing() {
        // The role granted by hand, with no row in partner_profiles.
        Account orphan = staff("stats-orphan", StaffRole.PARTNER);

        ResponseEntity<Map<String, Object>> refused = statistics(orphan);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody()).containsEntry("code", "PARTNER_NOT_CONFIGURED");
        assertThat(refused.getBody()).doesNotContainKeys("view", "today", "thisMonth");
    }

    @Test
    @DisplayName("only super admins and partners read the statistics; other staff and strangers are refused")
    void otherStaffAreRefused() {
        for (StaffRole role : List.of(StaffRole.FINANCE, StaffRole.MODERATOR, StaffRole.CURATOR, StaffRole.COMPLIANCE)) {
            Account other = staff("stats-" + role.name().toLowerCase(java.util.Locale.ROOT), role);

            ResponseEntity<Map<String, Object>> refused = statistics(other);

            assertThat(refused.getStatusCode()).as(role.name()).isEqualTo(HttpStatus.FORBIDDEN);
            assertThat(refused.getBody()).as(role.name()).containsEntry("code", "INSUFFICIENT_STAFF_CAPABILITY");
        }

        ResponseEntity<Map<String, Object>> stranger = statistics(account("stats-stranger"));
        assertThat(stranger.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(stranger.getBody()).containsEntry("code", "NOT_A_MODERATOR");
    }

    @Test
    @DisplayName("ending a partnership stops the statistics on the next request")
    void endingThePartnershipStopsTheStatistics() {
        Account admin = staff("stats-admin", StaffRole.SUPER_ADMIN);
        Account partner = partnerAt("50", admin);
        assertThat(statistics(partner).getStatusCode()).isEqualTo(HttpStatus.OK);

        rest.exchange(
                "/v1/admin/partners/" + partner.id(),
                HttpMethod.DELETE,
                new HttpEntity<>(bearer(admin.accessToken())),
                OBJECT);

        assertThat(statistics(partner).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    // ------------------------------------------------------------------
    // The record
    // ------------------------------------------------------------------

    @Test
    @DisplayName("every read is audited with which view was returned and what percentage it was scaled by")
    void everyReadIsAudited() {
        // A super admin of this test's own. Audit rows cannot be deleted, so a shared account
        // would carry every earlier test's reads into the count.
        Account admin = staff("stats-audit-admin-" + SEQUENCE.incrementAndGet(), StaffRole.SUPER_ADMIN);
        Account partner = partnerAt("50", admin);

        statistics(partner);
        statistics(admin);

        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        List<String> seenByPartner = jdbc.queryForList(
                "SELECT detail FROM audit_logs WHERE action = 'partner.statistics_read' AND entity_id = ?",
                String.class,
                partner.id());
        List<String> seenByAdmin = jdbc.queryForList(
                "SELECT detail FROM audit_logs WHERE action = 'partner.statistics_read' AND entity_id = ?",
                String.class,
                admin.id());

        assertThat(seenByPartner).containsExactly("view=PARTNER; share=50.00");
        assertThat(seenByAdmin).containsExactly("view=REAL; share=100.00");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {}

    /** The real journal, written once for the whole class. */
    private synchronized void seedTheJournal() {
        if (journalSeeded) {
            return;
        }
        UUID payer = account("stats-payer").id();
        PAYERS.add(payer);

        insert("GROWTH", "Growth", "49.00", "2050-05-20T08:00:00Z", null, payer, "A");
        insert("GROWTH", "Growth", "49.00", "2050-05-20T09:00:00Z", null, payer, "B");

        UUID toReverse = insert("PRO", "Pro", "100.00", "2050-06-03T08:00:00Z", null, payer, "C");
        insert("PRO", "Pro", "100.00", "2050-06-03T09:00:00Z", null, payer, "D");
        insert("PRO", "Pro", "100.00", "2050-06-03T10:00:00Z", null, payer, "E");
        insert("PRO", "Pro", "100.00", "2050-06-03T11:00:00Z", null, payer, "F");
        insert("PRO", "Pro", "-100.00", "2050-06-04T08:00:00Z", toReverse, payer, "G");

        insert("GROWTH", "Growth", "49.00", "2050-06-15T05:00:00Z", null, payer, "H");
        insert("GROWTH", "Growth", "49.00", "2050-06-15T06:00:00Z", null, payer, "I");
        insert("PRO", "Pro", "102.00", "2050-06-15T07:00:00Z", null, payer, "J");

        journalSeeded = true;
    }

    private UUID insert(
            String planCode, String planName, String amount, String receivedAt, UUID reverses, UUID payer, String tag) {
        UUID id = Identifiers.newIdentifier();
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO subscription_payments (
                            id, subscription_id, account_id, plan_id, plan_code, plan_name,
                            amount, currency, billing_period, method, reference, received_at, reverses)
                        VALUES (?, ?, ?, ?, ?, ?, ?::numeric, 'AZN', 'MONTHLY', 'BANK_TRANSFER', ?, ?, ?)
                        """,
                        id,
                        Identifiers.newIdentifier(),
                        payer,
                        Identifiers.newIdentifier(),
                        planCode,
                        planName,
                        amount,
                        SECRET_REFERENCE + tag,
                        Timestamp.from(Instant.parse(receivedAt)),
                        reverses);
        return id;
    }

    /** An ordinary account made a partner through the real endpoint, so the whole path is exercised. */
    private Account partnerAt(String percentage, Account admin) {
        Account candidate = account("stats-partner");
        ResponseEntity<Map<String, Object>> saved = rest.exchange(
                "/v1/admin/partners/" + candidate.id(),
                HttpMethod.PUT,
                new HttpEntity<>(Map.of("percentage", percentage, "sections", List.of()), jsonHeaders(admin)),
                OBJECT);
        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.OK);
        return candidate;
    }

    private ResponseEntity<Map<String, Object>> statistics(Account as) {
        return get("/v1/admin/partner-statistics", as);
    }

    private ResponseEntity<Map<String, Object>> get(String path, Account as) {
        return rest.exchange(path, HttpMethod.GET, new HttpEntity<>(bearer(as.accessToken())), OBJECT);
    }

    private Account account(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + "-" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);
        return tokenFor(users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId());
    }

    private Account staff(String slug, StaffRole role) {
        EmailAddress email = EmailAddress.of(slug + "@ideanest.test");
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test " + role.name()),
                    String.class);
        }
        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO staff_role_grants (account_id, role, granted_by, note)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT DO NOTHING
                        """,
                        id,
                        role.name(),
                        moderator().id(),
                        FIXTURE_NOTE);
        return tokenFor(id);
    }

    private Account moderator() {
        if (moderator != null) {
            return moderator;
        }
        EmailAddress email = EmailAddress.of(MODERATOR_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Moderator"),
                    String.class);
        }
        moderator = tokenFor(users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId());
        return moderator;
    }

    /**
     * A token issued at the real time. The JWT decoder validates against the system clock, not
     * the application's, so the frozen 2050 clock does not expire it.
     */
    private Account tokenFor(UUID id) {
        String accessToken = tokens.issue(
                        id,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();
        return new Account(accessToken, id);
    }

    private static BigDecimal revenueThisMonth(Map<String, Object> statistics) {
        return new BigDecimal((String) only(section(statistics, "thisMonth").get("currencies")).get("revenue"));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> section(Map<String, Object> statistics, String name) {
        return (Map<String, Object>) statistics.get(name);
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

    /** Every key at every depth, so a forbidden one cannot hide inside a list. */
    @SuppressWarnings("unchecked")
    private static Set<String> keysOf(Object node) {
        Set<String> keys = new java.util.HashSet<>();
        if (node instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                keys.add(String.valueOf(entry.getKey()));
                keys.addAll(keysOf(entry.getValue()));
            }
        } else if (node instanceof List<?> items) {
            for (Object item : items) {
                keys.addAll(keysOf(item));
            }
        }
        return keys;
    }

    private static HttpHeaders jsonHeaders(Account as) {
        HttpHeaders headers = bearer(as.accessToken());
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    private static HttpHeaders bearer(String accessToken) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        return headers;
    }
}
