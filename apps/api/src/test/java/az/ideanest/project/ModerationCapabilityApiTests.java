package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.audit.AuditAction;
import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.project.infrastructure.CategoryRepository;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
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
 * A campaign's moderation decisions need {@code MODERATE_CONTENT}, not merely a staff role
 * (#574).
 *
 * <p>{@code ProjectAccess.requireModeratable} asked whether the caller was staff at all, which
 * every role answers yes to — a partner, whose one capability is a statistics screen, could
 * publish a draft or halt a live campaign while the queues those decisions come from refused to
 * show them either. The other suites prove a creator is refused, and they decide as the
 * bootstrapped super admin, who holds everything; neither would have noticed.
 *
 * <p>The four roles that do not carry the capability are each tried, rather than one standing in
 * for the rest, because a super admin can change what a role confers (V114) and the default set is
 * the thing being asserted. Accounts are written straight into {@code users}, their tokens minted
 * and their roles granted by SQL, as {@code RoleCapabilitiesApiTests} does and for its reason:
 * registering over HTTP spends a per-address allowance the whole run shares.
 */
class ModerationCapabilityApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String FIXTURE_NOTE = "moderation capability fixture";

    /** Every moderation decision a campaign can be the subject of, as audited. */
    private static final List<String> DECISIONS = List.of(
            AuditAction.PROJECT_APPROVED.action(),
            AuditAction.PROJECT_LAUNCHED.action(),
            AuditAction.PROJECT_REJECTED.action(),
            AuditAction.PROJECT_CHANGES_REQUESTED.action(),
            AuditAction.PROJECT_SUSPENDED.action(),
            AuditAction.PROJECT_REVISION_APPROVED.action(),
            AuditAction.PROJECT_REVISION_REJECTED.action());

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private CategoryRepository categories;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update("DELETE FROM notifications");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
        jdbc.update("DELETE FROM staff_role_grants WHERE note = ?", FIXTURE_NOTE);
    }

    // ------------------------------------------------------------------
    // Refused
    // ------------------------------------------------------------------

    @ParameterizedTest(name = "{0}")
    @EnumSource(names = {"PARTNER", "CURATOR", "FINANCE", "COMPLIANCE"})
    @DisplayName("staff without MODERATE_CONTENT cannot approve, reject or send back a campaign")
    void staffWithoutModerationCannotDecideACampaign(StaffRole role) {
        Account outsider = staff(role);
        UUID id = submittedCampaign(creator());

        for (ResponseEntity<Map<String, Object>> refused : List.of(
                post("/v1/admin/moderation/" + id + "/approve", outsider, null),
                post("/v1/admin/moderation/" + id + "/reject", outsider, Map.of("note", "No.")),
                post("/v1/admin/moderation/" + id + "/request-changes", outsider, Map.of("note", "Rewrite it.")))) {
            assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
            assertThat(refused.getBody()).containsEntry("code", "INSUFFICIENT_STAFF_CAPABILITY");
            assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("capability", "MODERATE_CONTENT"));
        }

        // Nothing published, and no audit row claiming somebody decided.
        assertThat(state(id)).isEqualTo("SUBMITTED");
        assertThat(decisionsAbout(id)).isEmpty();
    }

    @ParameterizedTest(name = "{0}")
    @EnumSource(names = {"PARTNER", "CURATOR", "FINANCE", "COMPLIANCE"})
    @DisplayName("staff without MODERATE_CONTENT cannot suspend a live campaign")
    void staffWithoutModerationCannotSuspend(StaffRole role) {
        Account outsider = staff(role);
        UUID id = liveCampaign(creator());

        ResponseEntity<Map<String, Object>> refused = suspend(id, outsider);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody()).containsEntry("code", "INSUFFICIENT_STAFF_CAPABILITY");
        assertThat(state(id)).isEqualTo("LIVE");
        assertThat(decisionsAbout(id)).isEmpty();
    }

    @ParameterizedTest(name = "{0}")
    @EnumSource(names = {"PARTNER", "CURATOR", "FINANCE", "COMPLIANCE"})
    @DisplayName("staff without MODERATE_CONTENT cannot approve or reject an edit to a live campaign")
    void staffWithoutModerationCannotDecideAnEdit(StaffRole role) {
        Account outsider = staff(role);
        Account creator = creator();
        UUID id = approvedCampaign(creator, staff(StaffRole.MODERATOR));
        UUID revision = submittedEdit(creator, id, "A title nobody approved");

        for (ResponseEntity<Map<String, Object>> refused : List.of(
                post("/v1/admin/moderation/revisions/" + revision + "/approve", outsider, null),
                post("/v1/admin/moderation/revisions/" + revision + "/reject", outsider, Map.of("note", "No.")))) {
            assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
            assertThat(refused.getBody()).containsEntry("code", "INSUFFICIENT_STAFF_CAPABILITY");
        }

        assertThat(revisionStatus(revision)).isEqualTo("PENDING");
        assertThat(publicTitle(id)).isNotEqualTo("A title nobody approved");
    }

    // ------------------------------------------------------------------
    // Nothing given away by the refusal
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a refusal is the same whether or not the campaign or the edit exists")
    void aRefusalDoesNotSayWhetherTheTargetExists() {
        Account partner = staff(StaffRole.PARTNER);
        Account stranger = creator();
        Account creator = creator();
        UUID submitted = submittedCampaign(creator);
        UUID live = approvedCampaign(creator, staff(StaffRole.MODERATOR));
        UUID revision = submittedEdit(creator, live, "Edited");
        UUID nothing = UUID.randomUUID();

        for (Account caller : List.of(partner, stranger)) {
            assertSameRefusal(
                    post("/v1/admin/moderation/" + submitted + "/approve", caller, null),
                    post("/v1/admin/moderation/" + nothing + "/approve", caller, null));
            assertSameRefusal(suspend(live, caller), suspend(nothing, caller));
            // Found through the revision, so the capability has to be asked before the
            // revision is looked up and not only once its campaign is.
            assertSameRefusal(
                    post("/v1/admin/moderation/revisions/" + revision + "/approve", caller, null),
                    post("/v1/admin/moderation/revisions/" + nothing + "/approve", caller, null));
        }

        assertThat(state(submitted)).isEqualTo("SUBMITTED");
        assertThat(state(live)).isEqualTo("LIVE");
        assertThat(revisionStatus(revision)).isEqualTo("PENDING");
    }

    // ------------------------------------------------------------------
    // Allowed
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a granted moderator approves a campaign, publishes an edit to it and suspends it")
    void aModeratorDecides() {
        // Granted rather than bootstrapped: the bootstrap address is a super admin, who holds
        // every capability and would pass whatever this check asked for.
        Account moderator = staff(StaffRole.MODERATOR);
        Account creator = creator();
        UUID id = submittedCampaign(creator);

        ResponseEntity<Map<String, Object>> approved = post("/v1/admin/moderation/" + id + "/approve", moderator, null);
        assertThat(approved.getStatusCode()).as("approve: %s", approved.getBody()).isEqualTo(HttpStatus.OK);
        assertThat(state(id)).isEqualTo("LIVE");

        UUID revision = submittedEdit(creator, id, "A better title");
        ResponseEntity<Map<String, Object>> published =
                post("/v1/admin/moderation/revisions/" + revision + "/approve", moderator, null);
        assertThat(published.getStatusCode()).as("revision: %s", published.getBody()).isEqualTo(HttpStatus.OK);
        assertThat(publicTitle(id)).isEqualTo("A better title");

        ResponseEntity<Map<String, Object>> suspended = suspend(id, moderator);
        assertThat(suspended.getStatusCode()).as("suspend: %s", suspended.getBody()).isEqualTo(HttpStatus.OK);
        assertThat(state(id)).isEqualTo("SUSPENDED");

        assertThat(decisionsAbout(id))
                .contains(
                        AuditAction.PROJECT_APPROVED.action(),
                        AuditAction.PROJECT_REVISION_APPROVED.action(),
                        AuditAction.PROJECT_SUSPENDED.action());
    }

    @Test
    @DisplayName("a granted moderator rejects a campaign and sends another back")
    void aModeratorRejectsAndSendsBack() {
        Account moderator = staff(StaffRole.MODERATOR);
        Account creator = creator();
        UUID rejected = submittedCampaign(creator);
        UUID returned = submittedCampaign(creator);

        assertThat(post("/v1/admin/moderation/" + rejected + "/reject", moderator, Map.of("note", "§5.4."))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(post(
                                "/v1/admin/moderation/" + returned + "/request-changes",
                                moderator,
                                Map.of("note", "The summary describes a different product."))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        assertThat(state(rejected)).isEqualTo("REJECTED");
        assertThat(state(returned)).isEqualTo("CHANGES_REQUESTED");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {}

    private Account account(String prefix) {
        UUID id = Campaigns.creator(dataSource, prefix + "-" + SEQUENCE.incrementAndGet());
        String accessToken = tokens.issue(
                        id,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();
        return new Account(accessToken, id);
    }

    private Account creator() {
        Account creator = account("mod-cap-creator");
        Campaigns.mayPublish(dataSource, creator.id());
        return creator;
    }

    private Account staff(StaffRole role) {
        Account account = account("mod-cap-" + role.name().toLowerCase(Locale.ROOT).replace('_', '-'));
        new JdbcTemplate(dataSource)
                .update(
                        "INSERT INTO staff_role_grants (account_id, role, granted_by, note) VALUES (?, ?, ?, ?)",
                        account.id(),
                        role.name(),
                        account.id(),
                        FIXTURE_NOTE);
        return account;
    }

    private UUID submittedCampaign(Account creator) {
        UUID id = draft(creator);
        ResponseEntity<Map<String, Object>> basics =
                send(HttpMethod.PATCH, "/v1/projects/" + id, creator, Campaigns.completeBasics(categories));
        assertThat(basics.getStatusCode()).as("basics: %s", basics.getBody()).isEqualTo(HttpStatus.OK);
        ResponseEntity<Map<String, Object>> submitted = post("/v1/projects/" + id + "/submit", creator, null);
        assertThat(submitted.getStatusCode()).as("submit: %s", submitted.getBody()).isEqualTo(HttpStatus.OK);
        return id;
    }

    /** Through a real approval, because an edit to a campaign needs one that was launched. */
    private UUID approvedCampaign(Account creator, Account moderator) {
        UUID id = submittedCampaign(creator);
        ResponseEntity<Map<String, Object>> approved = post("/v1/admin/moderation/" + id + "/approve", moderator, null);
        assertThat(approved.getStatusCode()).as("approve: %s", approved.getBody()).isEqualTo(HttpStatus.OK);
        return id;
    }

    /** Written into the row, as {@code ProjectSuspensionApiTests} does: the halt is the subject. */
    private UUID liveCampaign(Account creator) {
        UUID id = draft(creator);
        Campaigns.launch(dataSource, id);
        return id;
    }

    private UUID draft(Account creator) {
        ResponseEntity<Map<String, Object>> created = post(
                "/v1/projects", creator, Map.of("title", "A campaign to moderate " + SEQUENCE.incrementAndGet()));
        assertThat(created.getStatusCode()).as("create: %s", created.getBody()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private UUID submittedEdit(Account creator, UUID projectId, String title) {
        send(HttpMethod.PATCH, "/v1/projects/" + projectId, creator, Map.of("title", title));
        ResponseEntity<Map<String, Object>> submitted =
                post("/v1/projects/" + projectId + "/revision/submit", creator, null);
        assertThat(submitted.getStatusCode()).as("edit: %s", submitted.getBody()).isEqualTo(HttpStatus.OK);
        return new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT id FROM project_revisions WHERE project_id = ? AND status = 'PENDING'",
                        UUID.class,
                        projectId);
    }

    private ResponseEntity<Map<String, Object>> suspend(UUID projectId, Account caller) {
        return post(
                "/v1/admin/projects/" + projectId + "/suspend",
                caller,
                Map.of("reason", "Counterfeit product photographs."));
    }

    /** The two refusals agree on everything but the path they were asked about. */
    private static void assertSameRefusal(
            ResponseEntity<Map<String, Object>> real, ResponseEntity<Map<String, Object>> invented) {
        assertThat(real.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(invented.getStatusCode()).isEqualTo(real.getStatusCode());
        assertThat(withoutInstance(invented.getBody())).isEqualTo(withoutInstance(real.getBody()));
    }

    private static Map<String, Object> withoutInstance(Map<String, Object> body) {
        Map<String, Object> copy = new LinkedHashMap<>(body);
        copy.remove("instance");
        return copy;
    }

    private String state(UUID projectId) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT state FROM projects WHERE id = ?", String.class, projectId);
    }

    private String publicTitle(UUID projectId) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT title FROM projects WHERE id = ?", String.class, projectId);
    }

    private String revisionStatus(UUID revisionId) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT status FROM project_revisions WHERE id = ?", String.class, revisionId);
    }

    private List<String> decisionsAbout(UUID projectId) {
        return new JdbcTemplate(dataSource)
                .queryForList("SELECT action FROM audit_logs WHERE entity_id = ?", String.class, projectId)
                .stream()
                .filter(DECISIONS::contains)
                .toList();
    }

    private ResponseEntity<Map<String, Object>> post(String path, Account caller, Object body) {
        return send(HttpMethod.POST, path, caller, body);
    }

    private ResponseEntity<Map<String, Object>> send(HttpMethod method, String path, Account caller, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(caller.accessToken());
        return rest.exchange(
                path, method, new HttpEntity<>(body, headers), new ParameterizedTypeReference<Map<String, Object>>() {});
    }
}
