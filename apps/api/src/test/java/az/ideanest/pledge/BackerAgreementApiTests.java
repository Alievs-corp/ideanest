package az.ideanest.pledge;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.project.infrastructure.CategoryRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.PaymentRows;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
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
 * §22.3's acknowledgement, at the moment it is required — issue #427.
 *
 * <p>§22.3 asks that "rewards are not guaranteed" be stated <strong>within the pledge
 * flow</strong>. Half of that already existed: the catalogues carry the sentence and
 * {@code wording.test.ts} pins it in four languages. What did not exist was the record that
 * anybody saw it, and this suite is about the record.
 *
 * <p><strong>Opening the payment and the acceptance are one transaction, and
 * {@link #aRefusalRecordsNothing()} is what checks it.</strong> A pledge sent to pay without
 * its acknowledgement recorded and an acknowledgement recorded against a refused request are
 * both rows that say something untrue about what a person did.
 *
 * <p>The acknowledgement is asked for on {@code POST /v1/pledges/{id}/payment}, where the backer
 * commits. Until #45 it was asked on the stored-card model's {@code confirm}, which carried the
 * same gate; the rules below did not change with the route.
 */
class BackerAgreementApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final String ADMIN_EMAIL = "moderator@ideanest.test";

    private Account admin;

    /** Every pledge sent to the payment page, whose pending charge has to go before the pledge can. */
    private final List<UUID> paying = new ArrayList<>();

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private CategoryRepository categories;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private AccessTokenIssuer tokens;

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        // The outbox first, and it is not a cascade: V19 gives that table no foreign key to
        // the aggregate it describes. A suite that left rows behind fails OutboxTests, which
        // counts them all. Then the pending charges the payment page recorded, which V41
        // makes append-only and which would otherwise refuse the pledges' deletion.
        jdbc.update("DELETE FROM outbox_events");
        PaymentRows.clearPledges(dataSource, paying);
        paying.clear();
        jdbc.update("DELETE FROM pledge_addons");
        jdbc.update("DELETE FROM pledges");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
        jdbc.update("DELETE FROM document_acceptances");
        // See LegalDocumentApiTests on why the trigger is lifted for one statement.
        jdbc.execute("ALTER TABLE legal_documents DISABLE TRIGGER legal_documents_published_is_immutable");
        jdbc.update("DELETE FROM legal_documents");
        jdbc.execute("ALTER TABLE legal_documents ENABLE TRIGGER legal_documents_published_is_immutable");
    }

    @Test
    @DisplayName("with no backer agreement published, a payment opens as before")
    void anUnpublishedAgreementIsNotARequirement() {
        UUID project = liveCampaign();
        Account backer = account();
        UUID pledge = draft(project, backer);

        // The fail-open case. Until #439 seeds the text there is nothing to acknowledge, and
        // a platform that refused every payment until somebody wrote a document would be
        // worse than one that starts asking the day the document exists.
        assertThat(pay(pledge, backer, null).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("once it is published, a payment that acknowledges nothing is refused")
    void anUnacknowledgedPaymentIsRefused() {
        publishBackerAgreement("Dəstək hazır məhsulu almaq deyil.");
        UUID project = liveCampaign();
        Account backer = account();
        UUID pledge = draft(project, backer);

        ResponseEntity<Map<String, Object>> refused = pay(pledge, backer, null);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody().get("code")).isEqualTo("AGREEMENT_REQUIRED");
        // The version wanted is named; `acknowledged` is absent rather than null, because a
        // null property is dropped on the way out. Absent is the honest encoding of "the
        // client sent nothing", and the stale case below is where a number appears.
        assertThat(metaOf(refused)).containsEntry("version", 1).doesNotContainKey("acknowledged");
    }

    @Test
    @DisplayName("acknowledging the version in force opens the payment and records the acceptance")
    void anAcknowledgedPaymentIsRecorded() {
        publishBackerAgreement("Dəstək hazır məhsulu almaq deyil.");
        UUID project = liveCampaign();
        Account backer = account();
        UUID pledge = draft(project, backer);

        ResponseEntity<Map<String, Object>> opened = pay(pledge, backer, 1);

        assertThat(opened.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(opened.getBody().get("redirectUrl")).isNotNull();
        // Still a draft: the provider's word that the backer paid is what collects it.
        assertThat(stateOf(pledge)).isEqualTo("DRAFT");
        assertThat(acceptanceCountFor(backer)).isEqualTo(1);
    }

    @Test
    @DisplayName("a checkout page left open across a publication is refused rather than upgraded")
    void aStaleAcknowledgementIsRefused() {
        publishBackerAgreement("Birinci mətn.");
        UUID project = liveCampaign();
        Account backer = account();
        UUID pledge = draft(project, backer);

        publishBackerAgreement("İkinci mətn.");

        // The client acknowledged a sentence that is no longer the one in force. Recording
        // it would put an acknowledgement of version 2 against somebody who read version 1.
        ResponseEntity<Map<String, Object>> refused = pay(pledge, backer, 1);

        assertThat(refused.getBody().get("code")).isEqualTo("AGREEMENT_REQUIRED");
        assertThat(metaOf(refused)).containsEntry("version", 2).containsEntry("acknowledged", 1);

        assertThat(pay(pledge, backer, 2).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("a refusal leaves neither a held payment nor an acceptance behind")
    void aRefusalRecordsNothing() {
        publishBackerAgreement("Mətn.");
        UUID project = liveCampaign();
        Account backer = account();
        UUID pledge = draft(project, backer);

        pay(pledge, backer, null);

        assertThat(stateOf(pledge)).isEqualTo("DRAFT");
        assertThat(acceptanceCountFor(backer)).isZero();
        assertThat(pendingChargesFor(pledge)).isZero();
        // And nothing was announced.
        assertThat(outboxCountFor(pledge)).isZero();
    }

    @Test
    @DisplayName("a second pledge on another campaign does not re-record the same acceptance")
    void acceptanceIsPerVersionAndNotPerPledge() {
        publishBackerAgreement("Mətn.");
        Account backer = account();

        pay(draft(liveCampaign(), backer), backer, 1);
        pay(draft(liveCampaign(), backer), backer, 1);

        // An acceptance is a thing that happened once. V65's unique index is what makes the
        // second payment find the first row rather than write a second.
        assertThat(acceptanceCountFor(backer)).isEqualTo(1);
    }

    /* ------------------------------------------------------------------
     * Fixtures
     * --------------------------------------------------------------- */

    private record Account(EmailAddress email, String accessToken, UUID id) {
    }

    private void publishBackerAgreement(String body) {
        ResponseEntity<Map<String, Object>> drafted = rest.exchange(
                "/v1/admin/legal/documents/BACKER_AGREEMENT/az/draft",
                HttpMethod.PUT,
                new HttpEntity<>(
                        Map.of("title", "Dəstəkçi razılaşması", "body", body), authorised(admin().accessToken())),
                mapType());
        assertThat(drafted.getStatusCode()).isEqualTo(HttpStatus.OK);

        Map<String, Object> request = new LinkedHashMap<>();
        request.put("effectiveFrom", null);
        assertThat(rest.exchange(
                                "/v1/admin/legal/documents/BACKER_AGREEMENT/publish",
                                HttpMethod.POST,
                                new HttpEntity<>(request, authorised(admin().accessToken())),
                                mapType())
                        .getStatusCode())
                .isEqualTo(HttpStatus.CREATED);
    }

    /** A campaign taking pledges, written rather than driven — {@code Campaigns} argues why. */
    private UUID liveCampaign() {
        Account creator = account();
        ResponseEntity<Map<String, Object>> created = rest.exchange(
                "/v1/projects",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("title", "Backing " + SEQUENCE.incrementAndGet()), authorised(creator.accessToken())),
                mapType());
        UUID id = UUID.fromString((String) created.getBody().get("id"));

        rest.exchange(
                "/v1/projects/" + id,
                HttpMethod.PATCH,
                new HttpEntity<>(Campaigns.completeBasics(categories), authorised(creator.accessToken())),
                mapType());
        Campaigns.launch(dataSource, id);
        return id;
    }

    private UUID draft(UUID projectId, Account backer) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", projectId.toString());
        body.put("contribution", Map.of("amount", "50.00", "currency", "AZN"));

        HttpHeaders headers = authorised(backer.accessToken());
        headers.set("Idempotency-Key", UUID.randomUUID().toString());

        ResponseEntity<Map<String, Object>> drafted =
                rest.exchange("/v1/pledges/draft", HttpMethod.POST, new HttpEntity<>(body, headers), mapType());
        assertThat(drafted.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) drafted.getBody().get("id"));
    }

    private ResponseEntity<Map<String, Object>> pay(UUID pledgeId, Account backer, Integer version) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("acknowledgedAgreementVersion", version);
        body.put("language", "az");

        HttpHeaders headers = authorised(backer.accessToken());
        headers.set("Idempotency-Key", UUID.randomUUID().toString());

        paying.add(pledgeId);
        return rest.exchange(
                "/v1/pledges/" + pledgeId + "/payment", HttpMethod.POST, new HttpEntity<>(body, headers), mapType());
    }

    private int pendingChargesFor(UUID pledgeId) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT count(*) FROM transactions WHERE pledge_id = ?", Integer.class, pledgeId);
    }

    private String stateOf(UUID pledgeId) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT state FROM pledges WHERE id = ?", String.class, pledgeId);
    }

    private int acceptanceCountFor(Account account) {
        return new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT count(*) FROM document_acceptances WHERE user_id = ?", Integer.class, account.id());
    }

    private int outboxCountFor(UUID pledgeId) {
        return new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT count(*) FROM outbox_events WHERE aggregate_id = ?", Integer.class, pledgeId);
    }

    private Account admin() {
        if (admin != null) {
            return admin;
        }
        EmailAddress email = EmailAddress.of(ADMIN_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Administrator"),
                    String.class);
        }
        admin = tokenFor(email);
        return admin;
    }

    private Account account() {
        EmailAddress email = EmailAddress.of("backing" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Backer"),
                String.class);
        return tokenFor(email);
    }

    /** Issued rather than signed in for — {@code sign-ins-per-email} is five and shared. */
    private Account tokenFor(EmailAddress email) {
        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        String accessToken = tokens.issue(
                        id,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();
        return new Account(email, accessToken, id);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> metaOf(ResponseEntity<Map<String, Object>> response) {
        return (Map<String, Object>) response.getBody().get("meta");
    }

    private static ParameterizedTypeReference<Map<String, Object>> mapType() {
        return new ParameterizedTypeReference<>() {};
    }

    private static HttpHeaders authorised(String accessToken) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(accessToken);
        return headers;
    }
}
