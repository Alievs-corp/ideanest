package az.ideanest.staff;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Partner profiles over HTTP and the real database — #204, part of #202.
 *
 * <p>Over HTTP because the thing being checked is the whole path: a super admin's token, the
 * capability check in the service, V89's tables and trigger, and the status code each refusal
 * becomes. A unit test of the percentage parser would pass against an endpoint that stored
 * anything.
 *
 * <p>What each group of tests is for:
 * <ul>
 *   <li><strong>The total may not pass 100</strong>, including for two super admins editing at
 *       the same moment, and including for somebody who writes to the table by hand.
 *   <li><strong>Only a super admin manages partners</strong>, under either name of the role.
 *   <li><strong>A section that was not opened is refused by the server</strong>: the partner's
 *       capabilities come from the rows, on every request.
 * </ul>
 */
class PartnerAdministrationApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** The single address {@code application-test.yml} lists as platform staff. */
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";

    /** What this suite's own role grants carry, so teardown can find them. */
    private static final String FIXTURE_NOTE = "partner admin fixture";

    /** What {@code PartnerAdministrationService} writes as the note on the PARTNER grant. */
    private static final String PARTNER_GRANT_NOTE = "partner profile";

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

    /**
     * The partner rows and the role grants this suite made, gone.
     *
     * <p>{@code partner_profiles.created_by} and {@code staff_role_grants.granted_by} reference
     * {@code users} with {@code ON DELETE RESTRICT}, so a row left behind makes the next suite's
     * {@code DELETE FROM users} fail with a foreign key violation nobody can trace back here.
     * Audit rows stay: {@code audit_logs} refuses a DELETE, which is what it is for.
     */
    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM partner_profiles");
        jdbc.update("DELETE FROM staff_role_grants WHERE note IN (?, ?)", FIXTURE_NOTE, PARTNER_GRANT_NOTE);
    }

    // ------------------------------------------------------------------
    // Making somebody a partner
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a super admin makes an account a partner, and the account is then a partner and nothing more")
    void aSuperAdminMakesAPartner() {
        Account admin = staff("partner-admin", StaffRole.SUPER_ADMIN);
        Account candidate = account("partner-candidate");

        ResponseEntity<Map<String, Object>> saved = put(candidate.id(), "50", List.of(), admin);

        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(saved.getBody()).containsEntry("percentage", "50.00");
        assertThat(saved.getBody()).containsEntry("accountId", candidate.id().toString());
        assertThat(saved.getBody().get("sections")).isEqualTo(List.of());

        // What the console is told about them: the role, the one statistics capability, and
        // none of the capabilities that open a transaction or an account.
        ResponseEntity<Map<String, Object>> me = get("/v1/admin/me", candidate.accessToken());
        assertThat(me.getBody().get("roles")).isEqualTo(List.of("PARTNER"));
        assertThat(capabilities(me)).containsExactly("VIEW_PARTNER_STATISTICS");
    }

    @Test
    @DisplayName("saving again replaces the percentage and the sections, and keeps who created it")
    void savingAgainReplacesTheState() {
        Account admin = staff("partner-admin", StaffRole.SUPER_ADMIN);
        Account candidate = account("partner-candidate");

        ResponseEntity<Map<String, Object>> first = put(candidate.id(), "50", List.of("CURATION", "HEALTH"), admin);
        ResponseEntity<Map<String, Object>> second = put(candidate.id(), "30.5", List.of("HEALTH"), admin);

        assertThat(second.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(second.getBody()).containsEntry("percentage", "30.50");
        assertThat(second.getBody().get("sections")).isEqualTo(List.of("HEALTH"));
        assertThat(second.getBody().get("createdAt")).isEqualTo(first.getBody().get("createdAt"));
        assertThat(second.getBody().get("createdBy")).isEqualTo(admin.id().toString());
    }

    // ------------------------------------------------------------------
    // The percentage
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a percentage that is not a share is refused, and says why")
    void aPercentageThatIsNotAShareIsRefused() {
        Account admin = staff("partner-admin", StaffRole.SUPER_ADMIN);
        Account candidate = account("partner-candidate");

        for (String bad : List.of("0", "-5", "100.01", "abc", "33.333", "1e2x")) {
            ResponseEntity<Map<String, Object>> refused = put(candidate.id(), bad, List.of(), admin);

            assertThat(refused.getStatusCode()).as(bad).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
            assertThat(refused.getBody()).as(bad).containsEntry("code", "INVALID_PARTNER_SHARE");
        }

        // None of them left a partner behind.
        assertThat(roster(admin).getBody().get("partners")).isEqualTo(List.of());
    }

    @Test
    @DisplayName("a whole platform can go to one partner, and 33.33 is a share")
    void theBoundariesAreInclusive() {
        Account admin = staff("partner-admin", StaffRole.SUPER_ADMIN);
        Account candidate = account("partner-candidate");

        assertThat(put(candidate.id(), "100", List.of(), admin).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(put(candidate.id(), "33.33", List.of(), admin).getBody()).containsEntry("percentage", "33.33");
    }

    // ------------------------------------------------------------------
    // The total may not pass 100
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the partners' percentages may not add up to more than 100, and the refusal says what is left")
    void theTotalMayNotPassAHundred() {
        Account admin = staff("partner-admin", StaffRole.SUPER_ADMIN);
        Account first = account("partner-one");
        Account second = account("partner-two");
        Account third = account("partner-three");

        assertThat(put(first.id(), "50", List.of(), admin).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(put(second.id(), "50", List.of(), admin).getStatusCode()).isEqualTo(HttpStatus.OK);

        ResponseEntity<Map<String, Object>> refused = put(third.id(), "1", List.of(), admin);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "PARTNER_SHARE_EXCEEDED");
        assertThat(refused.getBody()).extracting("meta").hasToString("{available=0.00}");

        ResponseEntity<Map<String, Object>> overview = roster(admin);
        assertThat(overview.getBody()).containsEntry("allocated", "100.00").containsEntry("remaining", "0.00");
    }

    @Test
    @DisplayName("raising a partner's own share counts what the others already hold, not their old value")
    void anEditIsMeasuredAgainstTheOthers() {
        Account admin = staff("partner-admin", StaffRole.SUPER_ADMIN);
        Account first = account("partner-one");
        Account second = account("partner-two");

        put(first.id(), "50", List.of(), admin);
        put(second.id(), "30", List.of(), admin);

        // Next to a second partner at 30, the first may hold up to 70: the 50 it held before
        // is not counted against it, or the edit would be refused for crowding itself.
        assertThat(put(first.id(), "70", List.of(), admin).getStatusCode()).isEqualTo(HttpStatus.OK);
        ResponseEntity<Map<String, Object>> refused = put(first.id(), "70.01", List.of(), admin);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).extracting("meta").hasToString("{available=70.00}");
    }

    @Test
    @DisplayName("two super admins editing at the same moment cannot both take 60 of the whole")
    void twoWritersAtOnceCannotPassAHundred() throws Exception {
        Account admin = staff("partner-admin", StaffRole.SUPER_ADMIN);
        Account first = account("partner-one");
        Account second = account("partner-two");

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch go = new CountDownLatch(1);
            List<Future<HttpStatus>> results = new ArrayList<>();
            for (Account target : List.of(first, second)) {
                results.add(pool.submit(() -> {
                    go.await();
                    return HttpStatus.valueOf(
                            put(target.id(), "60", List.of(), admin).getStatusCode().value());
                }));
            }
            go.countDown();

            List<HttpStatus> statuses = new ArrayList<>();
            for (Future<HttpStatus> result : results) {
                statuses.add(result.get(30, TimeUnit.SECONDS));
            }
            Collections.sort(statuses);

            // Exactly one took its 60. A race that let both through would show two 200s and a
            // table that adds up to 120.
            assertThat(statuses).containsExactly(HttpStatus.OK, HttpStatus.CONFLICT);
        } finally {
            pool.shutdownNow();
        }

        assertThat(new JdbcTemplate(dataSource)
                        .queryForObject("SELECT SUM(percentage) FROM partner_profiles", java.math.BigDecimal.class))
                .isEqualByComparingTo("60");
    }

    @Test
    @DisplayName("the database refuses a total over 100 even when the application is bypassed")
    void theTriggerHoldsAgainstAHandWrittenInsert() {
        Account admin = staff("partner-admin", StaffRole.SUPER_ADMIN);
        Account first = account("partner-one");
        Account second = account("partner-two");
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        String insert =
                "INSERT INTO partner_profiles (account_id, percentage, created_by, updated_by) VALUES (?, ?, ?, ?)";

        jdbc.update(insert, first.id(), new java.math.BigDecimal("60"), admin.id(), admin.id());

        assertThatThrownBy(() -> jdbc.update(insert, second.id(), new java.math.BigDecimal("60"), admin.id(), admin.id()))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("partner percentages add up to more than 100");
    }

    // ------------------------------------------------------------------
    // Who may do it
    // ------------------------------------------------------------------

    @Test
    @DisplayName("only a super admin manages partners: a partner, a curator and a stranger are refused")
    void onlyASuperAdminManagesPartners() {
        Account admin = staff("partner-admin", StaffRole.SUPER_ADMIN);
        Account partner = account("partner-one");
        put(partner.id(), "10", List.of(), admin);
        Account curator = staff("partner-curator", StaffRole.CURATOR);
        Account stranger = account("partner-stranger");
        Account target = account("partner-target");

        // A partner must not be able to widen their own share.
        ResponseEntity<Map<String, Object>> byPartner = put(target.id(), "5", List.of(), partner);
        assertThat(byPartner.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(byPartner.getBody()).containsEntry("code", "INSUFFICIENT_STAFF_CAPABILITY");

        assertThat(put(target.id(), "5", List.of(), curator).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);

        ResponseEntity<Map<String, Object>> byStranger = put(target.id(), "5", List.of(), stranger);
        assertThat(byStranger.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(byStranger.getBody()).containsEntry("code", "NOT_A_MODERATOR");

        assertThat(get("/v1/admin/partners", partner.accessToken()).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(delete(partner.id(), partner).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);

        // And none of it changed anything.
        assertThat(roster(admin).getBody()).containsEntry("allocated", "10.00");
    }

    @Test
    @DisplayName("a super admin cannot be made a partner, and an unknown account is a 404")
    void theTargetMustBeAnOrdinaryAccount() {
        Account admin = staff("partner-admin", StaffRole.SUPER_ADMIN);
        Account otherAdmin = staff("partner-other-admin", StaffRole.SUPER_ADMIN);

        ResponseEntity<Map<String, Object>> refused = put(otherAdmin.id(), "10", List.of(), admin);
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "PARTNER_IS_SUPER_ADMIN");

        ResponseEntity<Map<String, Object>> unknown = put(UUID.randomUUID(), "10", List.of(), admin);
        assertThat(unknown.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(unknown.getBody()).containsEntry("code", "ACCOUNT_NOT_FOUND");
    }

    @Test
    @DisplayName("an account that already holds another staff role cannot be made a partner")
    void aPartnerHoldsNoOtherRole() {
        // Roles add up. A partner who also held FINANCE would read the payments journal and the
        // ledger through that role, and the percentage would protect nothing.
        Account admin = staff("partner-admin", StaffRole.SUPER_ADMIN);
        Account finance = staff("partner-finance", StaffRole.FINANCE);

        ResponseEntity<Map<String, Object>> refused = put(finance.id(), "10", List.of(), admin);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "PARTNER_HOLDS_OTHER_ROLES");
        assertThat(refused.getBody()).extracting("meta").hasToString("{roles=FINANCE}");
        assertThat(roster(admin).getBody().get("partners")).isEqualTo(List.of());
    }

    // ------------------------------------------------------------------
    // Sections
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an opened section gives the partner its capability, and closing it takes it away on the next request")
    void sectionsAreComputedOnEveryRequest() {
        Account admin = staff("partner-admin", StaffRole.SUPER_ADMIN);
        Account partner = account("partner-one");

        put(partner.id(), "25", List.of("CURATION", "HEALTH"), admin);
        assertThat(capabilities(get("/v1/admin/me", partner.accessToken())))
                .containsExactlyInAnyOrder("VIEW_PARTNER_STATISTICS", "CURATE", "VIEW_HEALTH");

        put(partner.id(), "25", List.of("HEALTH"), admin);
        assertThat(capabilities(get("/v1/admin/me", partner.accessToken())))
                .containsExactlyInAnyOrder("VIEW_PARTNER_STATISTICS", "VIEW_HEALTH");

        // Same token, no restart, no re-login: the row decides.
        put(partner.id(), "25", List.of(), admin);
        assertThat(capabilities(get("/v1/admin/me", partner.accessToken())))
                .containsExactly("VIEW_PARTNER_STATISTICS");
    }

    @Test
    @DisplayName("a section that may not be opened cannot even be named")
    void aForbiddenSectionCannotBeSpelled() {
        Account admin = staff("partner-admin", StaffRole.SUPER_ADMIN);
        Account partner = account("partner-one");

        // AD-05 is the payment journal and the ledger: individual transactions.
        for (String section : List.of("FINANCE", "AUDIT", "LEDGER", "PAYMENTS", "ANALYTICS")) {
            ResponseEntity<Map<String, Object>> refused = put(partner.id(), "10", List.of(section), admin);

            assertThat(refused.getStatusCode().is4xxClientError()).as(section).isTrue();
        }
        assertThat(roster(admin).getBody().get("partners")).isEqualTo(List.of());
    }

    // ------------------------------------------------------------------
    // Ending it
    // ------------------------------------------------------------------

    @Test
    @DisplayName("ending a partnership removes the profile, the sections and the role")
    void endingAPartnership() {
        Account admin = staff("partner-admin", StaffRole.SUPER_ADMIN);
        Account partner = account("partner-one");
        put(partner.id(), "40", List.of("CURATION"), admin);

        assertThat(delete(partner.id(), admin).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        ResponseEntity<Map<String, Object>> me = get("/v1/admin/me", partner.accessToken());
        assertThat(me.getBody()).containsEntry("staff", false);
        assertThat(capabilities(me)).isEmpty();
        assertThat(roster(admin).getBody()).containsEntry("allocated", "0.00").containsEntry("remaining", "100.00");

        // Ending one that is already over is a 404, not a silent success.
        ResponseEntity<Map<String, Object>> again = delete(partner.id(), admin);
        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(again.getBody()).containsEntry("code", "PARTNER_NOT_FOUND");
    }

    // ------------------------------------------------------------------
    // The record
    // ------------------------------------------------------------------

    @Test
    @DisplayName("every change is audited with the new and the replaced percentage")
    void everyChangeIsAudited() {
        Account admin = staff("partner-admin", StaffRole.SUPER_ADMIN);
        Account partner = account("partner-one");

        put(partner.id(), "50", List.of("CURATION"), admin);
        put(partner.id(), "30", List.of(), admin);
        delete(partner.id(), admin);

        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        List<String> details = jdbc.queryForList(
                "SELECT detail FROM audit_logs WHERE action = 'partner.profile_saved' AND entity_id = ? ORDER BY occurred_at",
                String.class,
                partner.id());

        assertThat(details).hasSize(2);
        assertThat(details.get(0)).contains("percentage=50.00", "previous=none", "created=true");
        assertThat(details.get(1)).contains("percentage=30.00", "previous=50.00", "created=false");

        List<String> removed = jdbc.queryForList(
                "SELECT detail FROM audit_logs WHERE action = 'partner.profile_removed' AND entity_id = ?",
                String.class,
                partner.id());
        assertThat(removed).hasSize(1);
        assertThat(removed.get(0)).contains("percentage=30.00", "roleRevoked=true");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {}

    /** An ordinary account, registered over HTTP, with a token minted for it. */
    private Account account(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + "-" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);
        return tokenFor(users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId());
    }

    /**
     * A member of staff holding exactly one role, granted by SQL and with a minted token — for
     * the reason {@code ConsoleReadApiTests.staff(String, StaffRole)} gives at length.
     */
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

    /** The configured staff address, whose grants the fixtures above reference as their author. */
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

    private ResponseEntity<Map<String, Object>> put(UUID accountId, String percentage, List<String> sections, Account as) {
        return rest.exchange(
                "/v1/admin/partners/" + accountId,
                HttpMethod.PUT,
                new HttpEntity<>(Map.of("percentage", percentage, "sections", sections), headers(as)),
                OBJECT);
    }

    private ResponseEntity<Map<String, Object>> delete(UUID accountId, Account as) {
        return rest.exchange(
                "/v1/admin/partners/" + accountId, HttpMethod.DELETE, new HttpEntity<>(headers(as)), OBJECT);
    }

    private ResponseEntity<Map<String, Object>> roster(Account as) {
        return get("/v1/admin/partners", as.accessToken());
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        return rest.exchange(path, HttpMethod.GET, new HttpEntity<>(bearer(accessToken)), OBJECT);
    }

    @SuppressWarnings("unchecked")
    private static List<String> capabilities(ResponseEntity<Map<String, Object>> me) {
        return (List<String>) me.getBody().get("capabilities");
    }

    private static HttpHeaders headers(Account as) {
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
