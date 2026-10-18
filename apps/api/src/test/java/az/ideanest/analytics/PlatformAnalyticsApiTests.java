package az.ideanest.analytics;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.PaymentRows;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * What {@code /v1/admin/analytics} counts, and when.
 *
 * <h2>One population</h2>
 *
 * <p>Volume, count, average and backers are the same pledges: collected in the window and still
 * collected, net of a partial refund that has settled. Before, the volume came from rollups that
 * never forgot a refund and the backers from a different table keyed on when the checkout began.
 *
 * <h2>Decisions, not deadlines</h2>
 *
 * <p>A campaign is decided at the end of its closing window, a week after the deadline, so the
 * outcome counts follow the transition that decided it.
 *
 * <h2>Each test has a month of its own, years ago</h2>
 *
 * <p>Collected pledges cannot be deleted — V41's append-only ledger refers to them — and other
 * suites write pledges and transitions "now". So every test names a month in the past that no
 * other suite touches, writes its rows with instants inside it, and reads exactly that window.
 * The windows are distinct per test so that the suite's own tests cannot see each other either.
 */
class PlatformAnalyticsApiTests extends AbstractIntegrationTest {

    private static final ZoneId BAKU = ZoneId.of("Asia/Baku");

    private static String accessToken;

    private static UUID analystId;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    private final List<UUID> made = new ArrayList<>();

    @Test
    @DisplayName("refunded and charged-back pledges are out, a partial refund comes off, and every figure counts the same set")
    void oneNetPopulation() {
        LocalDate first = LocalDate.of(2011, 3, 1);
        UUID project = campaign("net-population");
        UUID other = campaign("net-population-other");
        UUID repeat = account("net-repeat");

        pledge(project, account("net-a"), "AZN", "100.00", "COLLECTED", at(first, 10));
        pledge(project, repeat, "AZN", "50.00", "FULFILLED", at(first.plusDays(3), 12));
        // The same person again, on another campaign: two pledges and one backer.
        pledge(other, repeat, "AZN", "30.00", "COLLECTED", at(first.plusDays(4), 9));
        UUID partlyRefunded = pledge(project, account("net-b"), "AZN", "80.00", "COLLECTED", at(first.plusDays(5), 15));
        refundSettled(partlyRefunded, project, "20.00", "BACKER_REQUEST");
        // A raise that was never applied was refunded, and never reached the total either.
        refundSettled(partlyRefunded, project, "15.00", "RAISE_NOT_APPLIED");
        pledge(project, account("net-c"), "AZN", "500.00", "REFUNDED", at(first.plusDays(6), 11));
        pledge(project, account("net-d"), "AZN", "700.00", "CHARGEBACK", at(first.plusDays(7), 11));
        // Collected the day before the window and the day after it.
        pledge(project, account("net-e"), "AZN", "900.00", "COLLECTED", at(first.minusDays(1), 23));
        pledge(project, account("net-f"), "AZN", "900.00", "COLLECTED", at(first.plusDays(31), 0));

        Map<String, Object> totals = totals(read(first, first.plusDays(30)));

        // 100 + 50 + 30 + (80 - 20) = 240, over four pledges by three people.
        assertThat(money(totals, "volume")).isEqualByComparingTo("240.00");
        assertThat(number(totals, "pledgeCount")).isEqualTo(4);
        assertThat(number(totals, "backerCount")).isEqualTo(3);
        assertThat(money(totals, "averagePledge")).isEqualByComparingTo("60.00");
        assertThat(number(totals, "otherCurrencyPledges")).isZero();
    }

    @Test
    @DisplayName("a pledge in another currency is counted as left out and nowhere else")
    void anotherCurrencyIsStatedRatherThanAdded() {
        LocalDate first = LocalDate.of(2011, 5, 1);
        UUID project = campaign("two-currencies");
        pledge(project, account("cur-a"), "AZN", "40.00", "COLLECTED", at(first, 12));
        pledge(project, account("cur-b"), "USD", "1000.00", "COLLECTED", at(first.plusDays(1), 12));

        Map<String, Object> body = read(first, first.plusDays(9));
        Map<String, Object> totals = totals(body);

        assertThat(money(totals, "volume")).isEqualByComparingTo("40.00");
        assertThat(currency(totals, "volume")).isEqualTo("AZN");
        assertThat(number(totals, "pledgeCount")).isEqualTo(1);
        assertThat(number(totals, "backerCount")).isEqualTo(1);
        assertThat(number(totals, "otherCurrencyPledges")).isEqualTo(1);
        assertThat(daily(body).stream().map(point -> amountOf(point.get("volume"))).reduce(BigDecimal.ZERO, BigDecimal::add))
                .isEqualByComparingTo("40.00");
    }

    @Test
    @DisplayName("the daily series has a point for every day of the window, zero where nothing was collected")
    void everyDayIsAPoint() {
        LocalDate first = LocalDate.of(2011, 7, 1);
        UUID project = campaign("every-day");
        // 20:30 UTC on the 3rd is half past midnight on the 4th in Baku: the 4th's pledge.
        pledge(project, account("day-a"), "AZN", "25.00", "COLLECTED",
                LocalDateTime.of(2011, 7, 3, 20, 30).atZone(ZoneId.of("UTC")).toInstant());

        List<Map<String, Object>> days = daily(read(first, first.plusDays(29)));

        assertThat(days).hasSize(30);
        assertThat(days.getFirst().get("day")).isEqualTo("2011-07-01");
        assertThat(days.getLast().get("day")).isEqualTo("2011-07-30");
        Map<String, Object> fourth = days.get(3);
        assertThat(fourth.get("day")).isEqualTo("2011-07-04");
        assertThat(((Number) fourth.get("pledgeCount")).longValue()).isEqualTo(1);
        assertThat(amountOf(fourth.get("volume"))).isEqualByComparingTo("25.00");
        Map<String, Object> third = days.get(2);
        assertThat(((Number) third.get("pledgeCount")).longValue()).isZero();
        assertThat(amountOf(third.get("volume"))).isEqualByComparingTo("0");
    }

    @Test
    @DisplayName("outcomes count the campaigns decided in the window, whatever their deadline, and both edges hold")
    void outcomesFollowTheDecision() {
        LocalDate first = LocalDate.of(2011, 9, 1);
        LocalDate last = first.plusDays(29);
        Instant opens = first.atStartOfDay(BAKU).toInstant();
        Instant closes = last.plusDays(1).atStartOfDay(BAKU).toInstant();

        // Deadline before the window, decided inside it: this window's.
        decided(campaign("decided-in"), "SUCCESSFUL", opens.plusSeconds(3_600));
        // Decided at the window's first instant: in. At the instant after its last: out.
        decided(campaign("decided-at-open"), "UNSUCCESSFUL", opens);
        decided(campaign("decided-at-close"), "SUCCESSFUL", closes);
        // Deadline inside the window, decided a week after it ended: not this window's.
        decided(campaign("decided-after"), "UNSUCCESSFUL", closes.plusSeconds(7 * 86_400));

        Map<String, Object> outcomes = outcomes(read(first, last));

        assertThat(number(outcomes, "succeeded")).isEqualTo(1);
        assertThat(number(outcomes, "failed")).isEqualTo(1);
        assertThat(((Number) outcomes.get("successRate")).doubleValue()).isEqualTo(0.5);
    }

    @Test
    @DisplayName("a window with no decision omits the rate rather than calling it zero")
    void noDecisionHasNoRate() {
        LocalDate first = LocalDate.of(2011, 11, 1);
        Map<String, Object> outcomes = outcomes(read(first, first.plusDays(9)));

        assertThat(number(outcomes, "succeeded")).isZero();
        assertThat(number(outcomes, "failed")).isZero();
        assertThat(outcomes).doesNotContainKey("successRate");
    }

    @Test
    @DisplayName("a campaign in its closing window or extended is running, as the front page counts it")
    void runningIsThreeStates() {
        LocalDate first = LocalDate.of(2012, 1, 1);
        long before = number(totals(read(first, first)), "liveProjects");

        Campaigns.seed(dataSource, creator(), "running-closing").state("CLOSING_WINDOW").insert();
        Campaigns.seed(dataSource, creator(), "running-extended").state("EXTENDED")
                .launchedAt(Instant.now().minusSeconds(30 * 86_400))
                .deadline(Instant.now().minusSeconds(86_400))
                .extendedUntil(Instant.now().plusSeconds(7 * 86_400))
                .insert();
        Campaigns.seed(dataSource, creator(), "running-live").state("LIVE").insert();
        Campaigns.seed(dataSource, creator(), "running-not").state("UNSUCCESSFUL").insert();

        assertThat(number(totals(read(first, first)), "liveProjects") - before).isEqualTo(3);
    }

    @Test
    @DisplayName("every read of the screen is recorded with its window")
    void aReadIsAudited() {
        LocalDate first = LocalDate.of(2012, 3, 1);
        read(first, first.plusDays(6));

        List<String> details = new JdbcTemplate(dataSource).queryForList(
                "SELECT detail FROM audit_logs WHERE action = 'analytics.read' AND actor_id = ? ORDER BY occurred_at DESC",
                String.class,
                analystId);
        assertThat(details).contains("window=2012-03-01/2012-03-07");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static Instant at(LocalDate day, int hour) {
        return day.atTime(hour, 0).atZone(BAKU).toInstant();
    }

    private UUID campaign(String slug) {
        UUID id = Campaigns.seed(dataSource, creator(), slug + "-" + UUID.randomUUID().toString().substring(0, 8))
                .state("LIVE")
                .insert();
        made.add(id);
        return id;
    }

    /**
     * The refund fixtures write `transactions`, which V41 makes append-only and which refer to the
     * campaign, so a suite that later clears `projects` would be refused. Taken out again here.
     */
    @AfterEach
    void removeMoneyRows() {
        PaymentRows.clearProjects(dataSource, made);
        made.clear();
    }

    private UUID creator() {
        return account("analytics-creator");
    }

    private UUID account(String handle) {
        return Campaigns.creator(dataSource, handle + "-" + UUID.randomUUID().toString().substring(0, 8));
    }

    private UUID pledge(UUID project, UUID backer, String currency, String amount, String state, Instant collected) {
        UUID id = UUID.randomUUID();
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO pledges (id, project_id, backer_id, state, base_amount, currency,
                                             confirmed_at, collected_at, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        id,
                        project,
                        backer,
                        state,
                        new BigDecimal(amount),
                        currency,
                        Timestamp.from(collected),
                        Timestamp.from(collected),
                        Timestamp.from(collected));
        return id;
    }

    private void refundSettled(UUID pledge, UUID project, String amount, String reason) {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        UUID transaction = UUID.randomUUID();
        jdbc.update(
                """
                INSERT INTO transactions (id, pledge_id, project_id, type, status, amount, currency, provider,
                                          provider_transaction_id, attempt_number, idempotency_key)
                VALUES (?, ?, ?, 'REFUND', 'SUCCEEDED', ?, 'AZN', 'AZERICARD', ?, 1, ?)
                """,
                transaction,
                pledge,
                project,
                new BigDecimal(amount),
                "analytics-" + UUID.randomUUID(),
                "analytics-" + UUID.randomUUID());
        jdbc.update(
                """
                INSERT INTO refunds (id, pledge_id, project_id, refund_transaction_id, amount, currency, full_refund,
                                     reason, detail, state, requested_by, requested_at, settled_at, idempotency_key)
                VALUES (?, ?, ?, ?, ?, 'AZN', false, ?, 'Analytics fixture', 'SUCCEEDED', ?, now(), now(), ?)
                """,
                UUID.randomUUID(),
                pledge,
                project,
                transaction,
                new BigDecimal(amount),
                reason,
                "RAISE_NOT_APPLIED".equals(reason) ? null : analyst(),
                "analytics-" + UUID.randomUUID());
    }

    private void decided(UUID project, String outcome, Instant when) {
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO project_state_transitions (id, project_id, from_state, to_state, actor_role, created_at)
                        VALUES (?, ?, 'CLOSING_WINDOW', ?, 'SYSTEM', ?)
                        """,
                        UUID.randomUUID(),
                        project,
                        outcome,
                        Timestamp.from(when));
    }

    private Map<String, Object> read(LocalDate from, LocalDate to) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(staffToken());

        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/v1/admin/analytics?from=" + from + "&to=" + to,
                HttpMethod.GET,
                new HttpEntity<>(headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(response.getStatusCode().is2xxSuccessful())
                .as("%s %s", response.getStatusCode(), response.getBody())
                .isTrue();
        return response.getBody();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> totals(Map<String, Object> body) {
        return (Map<String, Object>) body.get("totals");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> outcomes(Map<String, Object> body) {
        return (Map<String, Object>) body.get("outcomes");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> daily(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("daily");
    }

    @SuppressWarnings("unchecked")
    private static BigDecimal amountOf(Object money) {
        return new BigDecimal((String) ((Map<String, Object>) money).get("amount"));
    }

    private static BigDecimal money(Map<String, Object> totals, String key) {
        return amountOf(totals.get(key));
    }

    @SuppressWarnings("unchecked")
    private static String currency(Map<String, Object> totals, String key) {
        return (String) ((Map<String, Object>) totals.get(key)).get("currency");
    }

    private static long number(Map<String, Object> values, String key) {
        return ((Number) values.get(key)).longValue();
    }

    private UUID analyst() {
        staffToken();
        return analystId;
    }

    private String staffToken() {
        if (accessToken != null) {
            return accessToken;
        }
        analystId = Campaigns.creator(dataSource, "platform-analyst");
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO staff_role_grants (account_id, role, granted_by, note)
                        VALUES (?, 'SUPER_ADMIN', ?, 'analytics fixture')
                        ON CONFLICT DO NOTHING
                        """,
                        analystId,
                        analystId);
        accessToken = tokens.issue(
                        analystId,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();
        return accessToken;
    }
}
