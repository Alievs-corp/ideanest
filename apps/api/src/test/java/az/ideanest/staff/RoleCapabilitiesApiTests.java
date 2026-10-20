package az.ideanest.staff;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * A super admin changes what a staff role confers, from the console — V114.
 *
 * <p>What matters most is asserted against the service's own refusals rather than against the
 * response that described the change: a capability taken from a role is a screen that answers
 * 403 on the very next request, and one given is a capability `GET /v1/admin/me` reports at once.
 *
 * <p>Accounts are written straight into {@code users} and their tokens minted, and staff are
 * granted by SQL, because registering over HTTP spends a per-address allowance the whole run
 * shares.
 */
class RoleCapabilitiesApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String FIXTURE_NOTE = "role capabilities fixture";

    private static final ParameterizedTypeReference<Map<String, Object>> OBJECT =
            new ParameterizedTypeReference<Map<String, Object>>() {};

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM staff_role_capability_overrides");
        jdbc.update("DELETE FROM staff_role_grants WHERE note = ?", FIXTURE_NOTE);
    }

    @Test
    @DisplayName("a super admin reads the four adjustable roles, each at its default, and what may be changed")
    void aSuperAdminReadsTheMatrix() {
        Account admin = staff(StaffRole.SUPER_ADMIN);

        ResponseEntity<Map<String, Object>> response = get("/v1/admin/roles", admin);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        List<Map<String, Object>> roles = roles(response);
        assertThat(roles).extracting(role -> role.get("role"))
                .containsExactly("MODERATOR", "CURATOR", "FINANCE", "COMPLIANCE");
        for (Map<String, Object> role : roles) {
            assertThat(role.get("capabilities")).isEqualTo(role.get("defaults"));
            // The two that stay with super admins and partners are never offered.
            assertThat(strings(role.get("adjustable")))
                    .doesNotContain("ADMINISTER_STAFF", "VIEW_PARTNER_STATISTICS")
                    .contains("VIEW_AUDIT", "CURATE", "VIEW_HEALTH");
        }
    }

    @Test
    @DisplayName("a capability taken from a role is refused on the next request, and given back it works again")
    void takingACapabilityAwayRefusesTheScreen() {
        Account admin = staff(StaffRole.SUPER_ADMIN);
        Account curator = staff(StaffRole.CURATOR);
        assertThat(get("/v1/admin/audit", curator).getStatusCode()).isEqualTo(HttpStatus.OK);

        ResponseEntity<Map<String, Object>> changed = change("CURATOR", List.of("CURATE", "VIEW_HEALTH"), admin);

        assertThat(changed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(strings(changed.getBody().get("capabilities"))).containsExactly("CURATE", "VIEW_HEALTH");
        assertThat(strings(changed.getBody().get("defaults"))).containsExactly("CURATE", "VIEW_AUDIT");

        assertThat(strings(get("/v1/admin/me", curator).getBody().get("capabilities")))
                .containsExactly("CURATE", "VIEW_HEALTH");
        assertThat(get("/v1/admin/audit", curator).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);

        change("CURATOR", List.of("CURATE", "VIEW_AUDIT"), admin);
        assertThat(get("/v1/admin/audit", curator).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("sending a role its defaults puts it back and leaves no rows, and the same set twice changes nothing")
    void defaultsResetAndRepeatsAreIdempotent() {
        Account admin = staff(StaffRole.SUPER_ADMIN);
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);

        change("MODERATOR", List.of("MODERATE_CONTENT", "VIEW_HEALTH"), admin);
        List<Map<String, Object>> once = overrides(jdbc);
        change("MODERATOR", List.of("MODERATE_CONTENT", "VIEW_HEALTH"), admin);
        assertThat(overrides(jdbc)).isEqualTo(once);

        change("MODERATOR", List.of("MODERATE_CONTENT", "ADMINISTER_ACCOUNTS", "HANDLE_SUPPORT", "VIEW_AUDIT"), admin);
        assertThat(overrides(jdbc)).isEmpty();
    }

    @Test
    @DisplayName("every change is in the audit trail against the role, with the set before and after")
    void everyChangeIsAudited() {
        Account admin = staff(StaffRole.SUPER_ADMIN);

        change("FINANCE", List.of("VIEW_FINANCE", "VIEW_AUDIT"), admin);

        Map<String, Object> row = new JdbcTemplate(dataSource).queryForMap(
                """
                SELECT entity_type, actor_id, detail FROM audit_logs
                 WHERE action = 'staff.role_capabilities_changed'
                 ORDER BY occurred_at DESC LIMIT 1
                """);
        assertThat(row.get("entity_type")).isEqualTo("staff_role");
        assertThat(row.get("actor_id")).isEqualTo(admin.id());
        assertThat((String) row.get("detail"))
                .contains("role=FINANCE")
                .contains("after=[VIEW_FINANCE, VIEW_AUDIT]")
                .contains("changed=true");
    }

    @Test
    @DisplayName("staff without ADMINISTER_STAFF can neither read nor change what roles confer")
    void onlyASuperAdminMayTouchIt() {
        Account moderator = staff(StaffRole.MODERATOR);

        assertThat(get("/v1/admin/roles", moderator).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(change("MODERATOR", List.of("MODERATE_CONTENT", "VIEW_FINANCE"), moderator).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(overrides(new JdbcTemplate(dataSource))).isEmpty();
    }

    @Test
    @DisplayName("the super admin and partner roles cannot be changed, and no role can be given staff administration")
    void theLimitsAreTheServers() {
        Account admin = staff(StaffRole.SUPER_ADMIN);

        ResponseEntity<Map<String, Object>> superAdmin = change("SUPER_ADMIN", List.of("VIEW_AUDIT"), admin);
        assertThat(superAdmin.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(superAdmin.getBody()).containsEntry("code", "ROLE_NOT_ADJUSTABLE");

        assertThat(change("PARTNER", List.of(), admin).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);

        ResponseEntity<Map<String, Object>> escalation =
                change("MODERATOR", List.of("MODERATE_CONTENT", "ADMINISTER_STAFF"), admin);
        assertThat(escalation.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat(escalation.getBody()).containsEntry("code", "CAPABILITY_NOT_ADJUSTABLE");

        assertThat(change("MODERATOR", List.of("NOT_A_CAPABILITY"), admin).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(overrides(new JdbcTemplate(dataSource))).isEmpty();
    }

    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {}

    private Account staff(StaffRole role) {
        UUID id = Campaigns.creator(dataSource, "role-caps-" + role.name().toLowerCase(Locale.ROOT).replace('_', '-') + "-" + SEQUENCE.incrementAndGet());
        new JdbcTemplate(dataSource)
                .update(
                        "INSERT INTO staff_role_grants (account_id, role, granted_by, note) VALUES (?, ?, ?, ?)",
                        id,
                        role.name(),
                        id,
                        FIXTURE_NOTE);
        String accessToken = tokens.issue(
                        id,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();
        return new Account(accessToken, id);
    }

    private ResponseEntity<Map<String, Object>> get(String path, Account as) {
        return rest.exchange(path, HttpMethod.GET, new HttpEntity<>(headers(as)), OBJECT);
    }

    private ResponseEntity<Map<String, Object>> change(String role, List<String> capabilities, Account as) {
        return rest.exchange(
                "/v1/admin/roles/" + role + "/capabilities",
                HttpMethod.PUT,
                new HttpEntity<>(Map.of("capabilities", capabilities), headers(as)),
                OBJECT);
    }

    private static List<Map<String, Object>> overrides(JdbcTemplate jdbc) {
        return jdbc.queryForList(
                "SELECT role, capability, granted FROM staff_role_capability_overrides ORDER BY role, capability");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> roles(ResponseEntity<Map<String, Object>> response) {
        return (List<Map<String, Object>>) response.getBody().get("roles");
    }

    @SuppressWarnings("unchecked")
    private static List<String> strings(Object value) {
        return new ArrayList<>((List<String>) value);
    }

    private static HttpHeaders headers(Account as) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(as.accessToken());
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }
}
