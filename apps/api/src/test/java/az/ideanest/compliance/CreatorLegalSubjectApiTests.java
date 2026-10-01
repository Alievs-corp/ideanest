package az.ideanest.compliance;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.compliance.infrastructure.CampaignLegalSubjectRepository;
import az.ideanest.compliance.infrastructure.CreatorLegalSubjectRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.compliance.LegalSubject;
import az.ideanest.shared.compliance.LegalSubjects;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Who a creator legally is, end to end — issue #430.
 *
 * <p>The freeze is the half worth an integration test. Everything else here — the shape of a
 * VÖEN, what completeness means — is pure and is checked in {@code LegalSubjectTests} without a
 * container; what needs a database is that a campaign carries its own copy and that editing the
 * account afterwards cannot reach it.
 */
@DisplayName("A creator's legal subject")
class CreatorLegalSubjectApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final String STAFF_EMAIL = "moderator@ideanest.test";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private LegalSubjects subjects;

    @Autowired
    private CreatorLegalSubjectRepository recorded;

    @Autowired
    private CampaignLegalSubjectRepository frozen;

    @Autowired
    private PlatformTransactionManager transactions;

    // ------------------------------------------------------------------
    // Recording
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an account with nothing recorded says so, rather than 404")
    void nothingRecorded() {
        Account creator = account();

        Map<String, Object> mine = mine(creator);

        // One shape for the screen to render. A 404 would make the settings page distinguish
        // "you have not filled this in" from "the endpoint is broken", which it cannot do.
        assertThat(mine.get("recorded")).isEqualTo(false);
        assertThat(mine.get("legalName")).isNull();
        assertThat(mine.get("complete")).isEqualTo(false);
    }

    @Test
    @DisplayName("an individual records a name and carries no company fields")
    void anIndividual() {
        Account creator = account();

        Map<String, Object> saved = record(creator, individual("Aygün Məmmədova"));

        assertThat(saved.get("subjectKind")).isEqualTo("INDIVIDUAL");
        assertThat(saved.get("legalName")).isEqualTo("Aygün Məmmədova");
        assertThat(saved.get("complete")).isEqualTo(true);
        assertThat(saved.get("taxId")).isNull();
    }

    @Test
    @DisplayName("an individual entrepreneur keeps the VÖEN they entered — #239")
    void anIndividualEntrepreneur() {
        Account creator = account();

        Map<String, Object> body = individual("Aygün Məmmədova");
        body.put("taxId", "1234 567 890");
        Map<String, Object> saved = record(creator, body);

        // The form said "Saved" and the service threw this away, so an individual could never
        // reach §6.3's approval: a payout is approved only against a real VÖEN.
        assertThat(saved.get("subjectKind")).isEqualTo("INDIVIDUAL");
        assertThat(saved.get("taxId")).isEqualTo("1234567890");
        assertThat(saved.get("complete")).isEqualTo(true);
        assertThat(recorded.findById(creator.id()).orElseThrow().getTaxId()).isEqualTo("1234567890");
        assertThat(mine(creator).get("taxId")).isEqualTo("1234567890");
    }

    @Test
    @DisplayName("an individual carries no company address or registration number, even if sent one")
    void anIndividualHasNoCompanyFields() {
        Account creator = account();

        Map<String, Object> body = individual("Aygün Məmmədova");
        body.put("taxId", "1234567890");
        body.put("registeredAddress", "Bakı, Nizami küçəsi 1");
        body.put("registrationNumber", "AZ-1234");
        Map<String, Object> saved = record(creator, body);

        assertThat(saved.get("taxId")).isEqualTo("1234567890");
        assertThat(saved.get("registeredAddress")).isNull();
        assertThat(saved.get("registrationNumber")).isNull();
    }

    @Test
    @DisplayName("a company records its VÖEN, its address and its registration number")
    void aLegalEntity() {
        Account creator = account();

        Map<String, Object> saved = record(creator, entity("Nümunə MMC", "1234567890"));

        assertThat(saved.get("subjectKind")).isEqualTo("LEGAL_ENTITY");
        assertThat(saved.get("taxId")).isEqualTo("1234567890");
        assertThat(saved.get("complete")).isEqualTo(true);
    }

    @Test
    @DisplayName("a VÖEN that is not ten digits is refused, and the refusal names what was typed")
    void aMalformedTaxIdentifier() {
        Account creator = account();

        Map<String, Object> body = entity("Nümunə MMC", "12345");
        ResponseEntity<Map<String, Object>> refused = rest.exchange(
                "/v1/me/legal-subject",
                HttpMethod.PUT,
                new HttpEntity<>(body, authorised(creator.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("code")).isEqualTo("MALFORMED_TAX_IDENTIFIER");
        assertThat(recorded.findById(creator.id())).isEmpty();
    }

    @Test
    @DisplayName("moving back to an individual clears the company fields rather than leaving them")
    void movingBackClearsTheEntityFields() {
        Account creator = account();
        record(creator, entity("Nümunə MMC", "1234567890"));

        Map<String, Object> now = record(creator, individual("Aygün Məmmədova"));

        // A whole-row replacement: the body named no VÖEN, so none is left behind, and the
        // company's address and number go with the kind.
        assertThat(now.get("taxId")).isNull();
        assertThat(now.get("registeredAddress")).isNull();
        assertThat(recorded.findById(creator.id()).orElseThrow().getTaxId()).isNull();
    }

    // ------------------------------------------------------------------
    // The freeze — the reason this suite needs a database
    // ------------------------------------------------------------------

    @Test
    @DisplayName("editing the subject after a campaign was frozen does not change what the campaign carries")
    void theSnapshotDoesNotFollowTheAccount() {
        Account creator = account();
        record(creator, individual("Aygün Məmmədova"));
        UUID campaign = draft(creator);

        freeze(campaign, creator.id());

        // The creator registers a company the next month. Every decision about the submitted
        // campaign was taken about the individual who submitted it.
        record(creator, entity("Nümunə MMC", "1234567890"));

        LegalSubject onTheCampaign = subjects.frozenFor(campaign).orElseThrow();
        assertThat(onTheCampaign.legalName()).isEqualTo("Aygün Məmmədova");
        assertThat(onTheCampaign.subjectKind().name()).isEqualTo("INDIVIDUAL");
        assertThat(onTheCampaign.taxIdentifier()).isEmpty();

        // And the live row is the company, so the two really are two facts.
        assertThat(subjects.of(creator.id()).orElseThrow().legalName()).isEqualTo("Nümunə MMC");
    }

    @Test
    @DisplayName("a resubmission freezes what is true now, and does not accumulate rows")
    void aResubmissionOverwrites() {
        Account creator = account();
        record(creator, individual("Aygün Məmmədova"));
        UUID campaign = draft(creator);
        freeze(campaign, creator.id());

        record(creator, entity("Nümunə MMC", "1234567890"));
        freeze(campaign, creator.id());

        assertThat(subjects.frozenFor(campaign).orElseThrow().legalName()).isEqualTo("Nümunə MMC");
        assertThat(frozen.findByUserIdOrderByFrozenAtDesc(creator.id())).hasSize(1);
    }

    @Test
    @DisplayName("a creator with nothing recorded freezes nothing, and that is not an error")
    void nothingToFreeze() {
        Account creator = account();
        UUID campaign = draft(creator);

        freeze(campaign, creator.id());

        // The ordinary case until #424 sets a threshold. An unfrozen campaign is one the rule
        // did not apply to, and refusing the submission instead would be this repository
        // deciding a compliance position it may not decide.
        assertThat(subjects.frozenFor(campaign)).isEmpty();
    }

    // ------------------------------------------------------------------
    // The console
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the console reads the live subject and every campaign frozen against it")
    void theConsoleRead() {
        Account creator = account();
        record(creator, individual("Aygün Məmmədova"));
        UUID campaign = draft(creator);
        freeze(campaign, creator.id());
        record(creator, entity("Nümunə MMC", "1234567890"));

        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/v1/admin/accounts/%s/legal-subject".formatted(creator.id()),
                HttpMethod.GET,
                new HttpEntity<>(authorised(staff().accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<?, ?> live = (Map<?, ?>) response.getBody().get("recorded");
        assertThat(live.get("legalName")).isEqualTo("Nümunə MMC");

        // Both halves, because the screen's job is to make the divergence visible: a funded
        // campaign submitted by an individual whose account now says company is not an error,
        // and it is what a finance operator has to see before approving a payout.
        List<?> campaigns = (List<?>) response.getBody().get("campaigns");
        assertThat(campaigns).hasSize(1);
        assertThat(((Map<?, ?>) campaigns.get(0)).get("legalName")).isEqualTo("Aygün Məmmədova");
    }

    @Test
    @DisplayName("an account that is not staff cannot read somebody else's")
    void theConsoleReadIsPrivileged() {
        Account creator = account();
        Account stranger = account();
        record(creator, individual("Aygün Məmmədova"));

        ResponseEntity<String> refused = rest.exchange(
                "/v1/admin/accounts/%s/legal-subject".formatted(creator.id()),
                HttpMethod.GET,
                new HttpEntity<>(authorised(stranger.accessToken())),
                String.class);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static Map<String, Object> individual(String name) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("subjectKind", "INDIVIDUAL");
        body.put("legalName", name);
        return body;
    }

    private static Map<String, Object> entity(String name, String taxId) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("subjectKind", "LEGAL_ENTITY");
        body.put("legalName", name);
        body.put("taxId", taxId);
        body.put("registeredAddress", "Bakı, Nizami küçəsi 1");
        body.put("registrationNumber", "AZ-1234");
        return body;
    }

    private Map<String, Object> record(Account account, Map<String, Object> body) {
        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/v1/me/legal-subject",
                HttpMethod.PUT,
                new HttpEntity<>(body, authorised(account.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return response.getBody();
    }

    private Map<String, Object> mine(Account account) {
        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/v1/me/legal-subject",
                HttpMethod.GET,
                new HttpEntity<>(authorised(account.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return response.getBody();
    }

    /**
     * The freeze, called directly, inside a transaction of the test's own.
     *
     * <p>Not driven through a submission. Reaching it that way would mean building a complete
     * submittable campaign — a subscription, an accepted agreement, a full checklist — for a
     * fixture whose subject is one row; {@code CreatorAgreementGateApiTests} is the suite that
     * takes that path because the gate is what it is checking.
     *
     * <p>The transaction is not ceremony: {@code freezeFor} is {@code MANDATORY} precisely so
     * that it cannot commit apart from the submission, and a test calling it bare would be
     * asserting against a method the application never reaches.
     */
    private void freeze(UUID campaign, UUID creator) {
        new TransactionTemplate(transactions).executeWithoutResult(status -> subjects.freezeFor(campaign, creator));
    }

    /** A real campaign row, because the snapshot's foreign key points at one. */
    private UUID draft(Account creator) {
        ResponseEntity<Map<String, Object>> created = rest.exchange(
                "/v1/projects",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("title", "A campaign worth saving " + SEQUENCE.incrementAndGet()),
                        authorised(creator.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        assertThat(created.getStatusCode().is2xxSuccessful()).isTrue();
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private Account account() {
        EmailAddress email = EmailAddress.of("legal-subject-%d@example.com".formatted(SEQUENCE.incrementAndGet()));
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Creator"),
                String.class);
        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Account(tokenFor(id), id);
    }

    private Account staff() {
        EmailAddress email = EmailAddress.of(STAFF_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Administrator"),
                    String.class);
        }
        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Account(tokenFor(id), id);
    }

    /**
     * A token is minted rather than signed in for.
     *
     * <p>A dozen suites share {@code moderator@ideanest.test} and sign-ins per email are limited
     * to five; a suite that signed in would fail whenever it happened to run late in the pass.
     */
    private String tokenFor(UUID id) {
        return tokens.issue(
                        id,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();
    }

    private static HttpHeaders authorised(String accessToken) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(accessToken);
        return headers;
    }

    private record Account(String accessToken, UUID id) {
    }
}
