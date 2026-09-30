package az.ideanest.dashboard;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
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
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The console's front page over HTTP and the real database — #222.
 *
 * <p>What each group of tests is for:
 * <ul>
 *   <li><strong>Who sees what.</strong> A section is present only for a caller who holds one of
 *       its capabilities, so a moderator's page has no revenue and a partner's page has nothing.
 *       Checked per role, because "the money is hidden from the moderator" is exactly the kind of
 *       rule that holds until somebody adds a section without a capability.
 *   <li><strong>The figures are the data's.</strong> Counts are read before and after rows are
 *       written, so they do not depend on whatever the rest of the suite left behind.
 *   <li><strong>Nothing widens the answer</strong>: the request has no parameter that matters, so
 *       hostile ones change nothing.
 * </ul>
 */
class DashboardApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";
    private static final String FIXTURE_NOTE = "dashboard fixture";

    private static final ParameterizedTypeReference<Map<String, Object>> OBJECT =
            new ParameterizedTypeReference<Map<String, Object>>() {};

    private static Account moderator;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clear() {
        // The role grants reference users with ON DELETE RESTRICT, so one left behind makes the
        // next suite's DELETE FROM users fail with a foreign key violation nobody can trace here.
        new JdbcTemplate(dataSource).update("DELETE FROM staff_role_grants WHERE note = ?", FIXTURE_NOTE);
        Campaigns.clear(dataSource);
    }

    // ------------------------------------------------------------------
    // Who sees what
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a super admin gets every section, in page order")
    void aSuperAdminGetsEverySection() {
        Account admin = staff("dash-admin", StaffRole.SUPER_ADMIN);

        Map<String, Object> page = dashboard(admin).getBody();

        assertThat(keys(page)).containsExactly("figures", "campaigns", "reports", "support", "accounts");
        assertThat(sections(page)).allSatisfy(section -> assertThat(section).containsEntry("status", "READY"));
    }

    @Test
    @DisplayName("a moderator's page has the queues and no revenue")
    void aModeratorSeesNoMoney() {
        Account moderator = staff("dash-moderator", StaffRole.MODERATOR);

        Map<String, Object> page = dashboard(moderator).getBody();

        // MODERATOR holds MODERATE_CONTENT, ADMINISTER_ACCOUNTS and HANDLE_SUPPORT, and not
        // VIEW_FINANCE: so the money section does not exist for them rather than existing empty.
        assertThat(keys(page)).containsExactly("campaigns", "reports", "support", "accounts");
        assertThat(keys(page)).doesNotContain("figures");
    }

    @Test
    @DisplayName("finance sees the money and the support queue, and not the moderation queues")
    void financeSeesTheMoney() {
        Account finance = staff("dash-finance", StaffRole.FINANCE);

        assertThat(keys(dashboard(finance).getBody())).containsExactly("figures", "support");
    }

    @Test
    @DisplayName("a curator, who holds none of the capabilities any section wants, gets an empty page")
    void aCuratorGetsAnEmptyPage() {
        Account curator = staff("dash-curator", StaffRole.CURATOR);

        ResponseEntity<Map<String, Object>> response = dashboard(curator);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(sections(response.getBody())).isEmpty();
    }

    @Test
    @DisplayName("a partner gets an empty page: no real platform figure can reach them through here")
    void aPartnerGetsNoRealFigures() {
        // The whole point of the front page for a partner: their landing is their own statistics
        // screen, scaled there. This endpoint must never be a way round it.
        Account partner = staff("dash-partner", StaffRole.PARTNER);

        ResponseEntity<Map<String, Object>> response = dashboard(partner);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(sections(response.getBody())).isEmpty();
        assertThat(String.valueOf(response.getBody())).doesNotContain("pledgeVolume");
    }

    @Test
    @DisplayName("somebody who does not work here is refused")
    void aStrangerIsRefused() {
        ResponseEntity<Map<String, Object>> response = dashboard(account("dash-stranger"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(response.getBody()).containsEntry("code", "NOT_A_MODERATOR");
    }

    @Test
    @DisplayName("no parameter widens what a caller receives")
    void parametersCannotWidenTheAnswer() {
        Account partner = staff("dash-partner-hostile", StaffRole.PARTNER);

        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/v1/admin/dashboard?sections=figures&view=REAL&role=SUPER_ADMIN&accountId=" + partner.id()
                        + "&capability=VIEW_FINANCE",
                HttpMethod.GET,
                new HttpEntity<>(bearer(partner)),
                OBJECT);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(sections(response.getBody())).isEmpty();
    }

    // ------------------------------------------------------------------
    // The figures
    // ------------------------------------------------------------------

    @Test
    @DisplayName("every value is a decimal string or null, never a number a browser could round")
    void valuesAreStrings() {
        Account admin = staff("dash-admin-strings", StaffRole.SUPER_ADMIN);

        for (Map<String, Object> section : sections(dashboard(admin).getBody())) {
            for (Map<String, Object> figure : figures(section)) {
                Object value = figure.get("value");
                assertThat(value == null || value instanceof String)
                        .as("%s.%s", section.get("key"), figure.get("key"))
                        .isTrue();
                if (value != null) {
                    assertThat((String) value).matches("-?\\d+(\\.\\d+)?");
                }
            }
        }
    }

    @Test
    @DisplayName("money figures carry a currency and the rest do not")
    void moneyCarriesItsCurrency() {
        Account admin = staff("dash-admin-money", StaffRole.SUPER_ADMIN);

        Map<String, Object> figures = section(dashboard(admin).getBody(), "figures");

        for (Map<String, Object> figure : figures(figures)) {
            if ("MONEY".equals(figure.get("kind"))) {
                assertThat(figure.get("currency")).as(String.valueOf(figure.get("key"))).isEqualTo("AZN");
            } else {
                assertThat(figure.get("currency")).as(String.valueOf(figure.get("key"))).isNull();
            }
        }
        assertThat(figureKeys(figures))
                .contains("pledgeVolume", "pledgeCount", "backerCount", "averagePledge", "successRate");
    }

    @Test
    @DisplayName("campaigns running and waiting are counted from the real table")
    void campaignCountsFollowTheData() {
        Account admin = staff("dash-admin-campaigns", StaffRole.SUPER_ADMIN);
        long runningBefore = count(section(dashboard(admin).getBody(), "campaigns"), "running");
        long waitingBefore = count(section(dashboard(admin).getBody(), "campaigns"), "awaitingModeration");

        UUID creator = Campaigns.creator(dataSource, "dash-creator-" + SEQUENCE.incrementAndGet());
        Campaigns.seed(dataSource, creator, "dash-live-" + SEQUENCE.incrementAndGet()).state("LIVE").insert();
        Campaigns.seed(dataSource, creator, "dash-closing-" + SEQUENCE.incrementAndGet())
                .state("CLOSING_WINDOW")
                .insert();
        Campaigns.seed(dataSource, creator, "dash-submitted-" + SEQUENCE.incrementAndGet())
                .state("SUBMITTED")
                .insert();
        Campaigns.seed(dataSource, creator, "dash-draft-" + SEQUENCE.incrementAndGet()).state("DRAFT").insert();

        Map<String, Object> campaigns = section(dashboard(admin).getBody(), "campaigns");

        // Running is three states: a campaign in its closing window still takes pledges, and one
        // counted as LIVE alone would drop out of "running" on the day it reaches its deadline.
        assertThat(count(campaigns, "running")).isEqualTo(runningBefore + 2);
        assertThat(count(campaigns, "awaitingModeration")).isEqualTo(waitingBefore + 1);
        assertThat(figureKeys(campaigns)).contains("state.LIVE", "state.DRAFT", "state.SUBMITTED", "state.COMPLETED");
    }

    @Test
    @DisplayName("a campaign created in the window is counted as created")
    void newCampaignsAreCounted() {
        Account admin = staff("dash-admin-created", StaffRole.SUPER_ADMIN);
        long before = count(section(dashboard(admin).getBody(), "campaigns"), "createdInPeriod");

        UUID creator = Campaigns.creator(dataSource, "dash-creator-" + SEQUENCE.incrementAndGet());
        Campaigns.seed(dataSource, creator, "dash-new-" + SEQUENCE.incrementAndGet()).insert();

        assertThat(count(section(dashboard(admin).getBody(), "campaigns"), "createdInPeriod")).isEqualTo(before + 1);
    }

    // ------------------------------------------------------------------
    // The window
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the window defaults to thirty days and says which calendar it is in")
    void theDefaultWindow() {
        Account admin = staff("dash-admin-window", StaffRole.SUPER_ADMIN);

        Map<String, Object> page = dashboard(admin).getBody();

        assertThat(page).containsEntry("timeZone", "Asia/Baku");
        assertThat(java.time.LocalDate.parse((String) page.get("to")).toEpochDay()
                        - java.time.LocalDate.parse((String) page.get("from")).toEpochDay())
                .isEqualTo(29);
    }

    @Test
    @DisplayName("a window that runs backwards or covers more than a year is refused with a code")
    void badWindows() {
        Account admin = staff("dash-admin-range", StaffRole.SUPER_ADMIN);

        ResponseEntity<Map<String, Object>> backwards = get("/v1/admin/dashboard?from=2026-06-10&to=2026-06-01", admin);
        assertThat(backwards.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(backwards.getBody()).containsEntry("code", "INVALID_DASHBOARD_RANGE");

        ResponseEntity<Map<String, Object>> tooLong = get("/v1/admin/dashboard?from=2024-01-01&to=2026-06-01", admin);
        assertThat(tooLong.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(tooLong.getBody()).containsEntry("code", "INVALID_DASHBOARD_RANGE");
    }

    // ------------------------------------------------------------------
    // The record
    // ------------------------------------------------------------------

    @Test
    @DisplayName("every read is audited with the window and the sections served")
    void everyReadIsAudited() {
        Account admin = staff("dash-audit-admin-" + SEQUENCE.incrementAndGet(), StaffRole.SUPER_ADMIN);

        dashboard(admin);

        List<String> details = new JdbcTemplate(dataSource)
                .queryForList(
                        "SELECT detail FROM audit_logs WHERE action = 'dashboard.read' AND entity_id = ?",
                        String.class,
                        admin.id());
        assertThat(details).hasSize(1);
        assertThat(details.get(0)).contains("sections=[figures, campaigns, reports, support, accounts]", "unavailable=[]");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {}

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

    private ResponseEntity<Map<String, Object>> dashboard(Account as) {
        return get("/v1/admin/dashboard", as);
    }

    private ResponseEntity<Map<String, Object>> get(String path, Account as) {
        return rest.exchange(path, HttpMethod.GET, new HttpEntity<>(bearer(as)), OBJECT);
    }

    private static HttpHeaders bearer(Account as) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(as.accessToken());
        return headers;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> sections(Map<String, Object> page) {
        return (List<Map<String, Object>>) page.get("sections");
    }

    private static List<String> keys(Map<String, Object> page) {
        return sections(page).stream().map(section -> (String) section.get("key")).toList();
    }

    private static Map<String, Object> section(Map<String, Object> page, String key) {
        return sections(page).stream()
                .filter(section -> key.equals(section.get("key")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("No section " + key + " in " + keys(page)));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> figures(Map<String, Object> section) {
        return (List<Map<String, Object>>) section.get("figures");
    }

    private static Set<String> figureKeys(Map<String, Object> section) {
        return figures(section).stream().map(figure -> (String) figure.get("key")).collect(java.util.stream.Collectors.toSet());
    }

    private static long count(Map<String, Object> section, String key) {
        return figures(section).stream()
                .filter(figure -> key.equals(figure.get("key")))
                .mapToLong(figure -> Long.parseLong((String) figure.get("value")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("No figure " + key));
    }
}
