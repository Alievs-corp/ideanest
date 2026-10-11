package az.ideanest.legal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.legal.application.LegalDocumentInForceChanged;
import az.ideanest.legal.domain.DocumentKind;
import az.ideanest.legal.domain.LegalDocument;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.RecordingLegalChanges;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
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
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * V65's two tables and the console that writes them — issue #425.
 *
 * <p><strong>What is checked here is the machinery, not the words.</strong> No text ships
 * with this feature: the eight kinds exist, the words are #423's adviser's, and #439
 * publishes them. So every document in this suite is invented, and what is asserted is that
 * a version is allocated once, cannot be edited after publication, cannot be accepted twice,
 * and goes away with the account that accepted it.
 *
 * <p><strong>The immutability test is the one that matters.</strong> An acceptance names a
 * version, and an acceptance of a text that can be edited afterwards is evidence of nothing.
 * It is asserted against the database rather than against the service, because the service
 * is not the only thing that ever writes to a table.
 */
class LegalDocumentApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final String ADMIN_EMAIL = "moderator@ideanest.test";

    private Account admin;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private RecordingLegalChanges legalChanges;

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        // Acceptances first: V65 restricts on the document, deliberately, so that a version
        // somebody accepted cannot be removed out from under the record.
        jdbc.update("DELETE FROM document_acceptances");
        // The trigger refuses a DELETE of a published row for the same reason, so it is
        // lifted for the length of one statement rather than the table being left behind for
        // the next suite. This is the only place in the build that does it, and it is a
        // fixture rather than a licence: nothing in `main` may.
        jdbc.execute("ALTER TABLE legal_documents DISABLE TRIGGER legal_documents_published_is_immutable");
        jdbc.update("DELETE FROM legal_documents");
        jdbc.execute("ALTER TABLE legal_documents ENABLE TRIGGER legal_documents_published_is_immutable");
    }

    @Test
    @DisplayName("a version is allocated once and is the same number in every language")
    void oneVersionAcrossLanguages() {
        draft("TERMS_OF_USE", "az", "İstifadə şərtləri", "Azərbaycan dilində mətn.");
        draft("TERMS_OF_USE", "en", "Terms of use", "The text in English.");

        Map<String, Object> published = publish("TERMS_OF_USE", null);
        List<Map<String, Object>> versions = documentsOf(published);

        assertThat(versions).hasSize(2);
        // The whole reason the allocation is per kind rather than per (kind, locale): an
        // acceptance naming version 1 identifies one agreement, not one translation of an
        // unknown one.
        assertThat(versions).allSatisfy(document -> assertThat(document.get("version")).isEqualTo(1));

        draft("TERMS_OF_USE", "az", "İstifadə şərtləri", "Düzəliş edilmiş mətn.");
        assertThat(documentsOf(publish("TERMS_OF_USE", null)))
                .allSatisfy(document -> assertThat(document.get("version")).isEqualTo(2));
    }

    @Test
    @DisplayName("nothing publishes without the Azerbaijani text, because that is the one that governs")
    void theGoverningTextIsNotOptional() {
        draft("PLATFORM_RULES", "en", "Platform rules", "The text in English.");

        ResponseEntity<Map<String, Object>> refused = publishExpecting("PLATFORM_RULES", null, HttpStatus.CONFLICT);
        assertThat(refused.getBody().get("code")).isEqualTo("GOVERNING_TEXT_MISSING");

        draft("PLATFORM_RULES", "az", "Platforma qaydaları", "Azərbaycan dilində mətn.");
        assertThat(documentsOf(publish("PLATFORM_RULES", null))).hasSize(2);
    }

    @Test
    @DisplayName("publishing with nothing drafted is refused rather than doing nothing quietly")
    void publishingTwiceIsRefused() {
        draft("COOKIE_POLICY", "az", "Kuki siyasəti", "Mətn.");
        publish("COOKIE_POLICY", null);

        assertThat(publishExpecting("COOKIE_POLICY", null, HttpStatus.CONFLICT).getBody().get("code"))
                .isEqualTo("NOTHING_TO_PUBLISH");
    }

    @Test
    @DisplayName("a version cannot be dated so that it governed before it existed")
    void backdatingIsRefused() {
        draft("PRIVACY_POLICY", "az", "Məxfilik siyasəti", "Mətn.");

        ResponseEntity<Map<String, Object>> refused = publishExpecting(
                "PRIVACY_POLICY", Instant.now().minusSeconds(3600), HttpStatus.BAD_REQUEST);

        assertThat(refused.getBody().get("code")).isEqualTo("EFFECTIVE_DATE_IN_THE_PAST");
    }

    @Test
    @DisplayName("a version dated in the future is published and does not yet govern")
    void aFutureVersionDoesNotGovernYet() {
        draft("DISPUTE_RESOLUTION_POLICY", "az", "Mübahisələr", "Bugünkü mətn.");
        publish("DISPUTE_RESOLUTION_POLICY", null);

        draft("DISPUTE_RESOLUTION_POLICY", "az", "Mübahisələr", "Gələcək mətn.");
        publish("DISPUTE_RESOLUTION_POLICY", Instant.now().plusSeconds(86_400));

        // The public route answers what governs now, which is still version 1. A version
        // announced a fortnight before it bites is the entire reason effective_from is a
        // column rather than the publication time.
        ResponseEntity<Map<String, Object>> current =
                rest.exchange("/v1/legal/documents/DISPUTE_RESOLUTION_POLICY", HttpMethod.GET, null, mapType());
        assertThat(current.getBody().get("version")).isEqualTo(1);
        assertThat(current.getBody().get("body")).isEqualTo("Bugünkü mətn.");
    }

    @Test
    @DisplayName("a published version cannot be edited, and the database is what refuses it")
    void aPublishedVersionIsImmutable() {
        draft("DELIVERY_AND_REFUND_POLICY", "az", "Çatdırılma", "Orijinal mətn.");
        publish("DELIVERY_AND_REFUND_POLICY", null);

        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        // Not through the service. The service refuses this too, and a rule only the
        // application knows is a rule that holds until somebody writes an UPDATE by hand
        // during an incident -- which is exactly when one gets written.
        assertThatThrownBy(() -> jdbc.update(
                        "UPDATE legal_documents SET body = 'Dəyişdirilmiş mətn.'"
                                + " WHERE kind = 'DELIVERY_AND_REFUND_POLICY'"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("published");

        // And drafting again produces a new version rather than touching the old one.
        draft("DELIVERY_AND_REFUND_POLICY", "az", "Çatdırılma", "Düzəliş.");
        assertThat(documentsOf(publish("DELIVERY_AND_REFUND_POLICY", null)))
                .allSatisfy(document -> assertThat(document.get("version")).isEqualTo(2));
    }

    @Test
    @DisplayName("the stored hash is of the stored body, so an edited text is a detectable one")
    void theHashCoversTheBody() {
        draft("TERMS_OF_USE", "az", "Şərtlər", "Hash-lanan mətn.");
        Map<String, Object> document = documentsOf(publish("TERMS_OF_USE", null)).getFirst();

        assertThat(document.get("contentHash")).isEqualTo(LegalDocument.hashOf("Hash-lanan mətn."));
    }

    @Test
    @DisplayName("an account accepts a version once, however many times it asks")
    void acceptanceIsIdempotentPerVersion() {
        draft("BACKER_AGREEMENT", "az", "Dəstəkçi razılaşması", "Mətn.");
        publish("BACKER_AGREEMENT", null);

        Account backer = account();
        assertThat(accept(backer, "BACKER_AGREEMENT", 1).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(accept(backer, "BACKER_AGREEMENT", 1).getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(acceptanceCountFor(backer)).isEqualTo(1);
    }

    @Test
    @DisplayName("accepting a version that is no longer in force is refused, not quietly upgraded")
    void aStaleVersionIsRefused() {
        draft("BACKER_AGREEMENT", "az", "Dəstəkçi razılaşması", "Birinci mətn.");
        publish("BACKER_AGREEMENT", null);
        draft("BACKER_AGREEMENT", "az", "Dəstəkçi razılaşması", "İkinci mətn.");
        publish("BACKER_AGREEMENT", null);

        Account backer = account();
        ResponseEntity<Map<String, Object>> refused = accept(backer, "BACKER_AGREEMENT", 1);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody().get("code")).isEqualTo("AGREEMENT_VERSION_STALE");
        // Otherwise the record would say somebody accepted a text they never saw.
        assertThat(acceptanceCountFor(backer)).isZero();
    }

    @Test
    @DisplayName("accepting two versions of one document leaves two rows, because that is the record")
    void everyVersionIsItsOwnAcceptance() {
        draft("CREATOR_AGREEMENT", "az", "Yaradıcı müqaviləsi", "Birinci mətn.");
        publish("CREATOR_AGREEMENT", null);

        Account creator = account();
        accept(creator, "CREATOR_AGREEMENT", 1);

        draft("CREATOR_AGREEMENT", "az", "Yaradıcı müqaviləsi", "İkinci mətn.");
        publish("CREATOR_AGREEMENT", null);
        accept(creator, "CREATOR_AGREEMENT", 2);

        // "They accepted the creator agreement" is worth nothing if the agreement has been
        // edited since. Two rows is what makes "which one, and when" answerable.
        assertThat(acceptanceCountFor(creator)).isEqualTo(2);
    }

    @Test
    @DisplayName("nothing of a document survives the account that accepted it")
    void acceptancesCascadeWithTheAccount() {
        // A gated kind, because only the two gated ones can be accepted: `AgreementKind`
        // has two values and the six policies are read rather than agreed to at a moment.
        draft("BACKER_AGREEMENT", "az", "Dəstəkçi razılaşması", "Mətn.");
        publish("BACKER_AGREEMENT", null);

        Account leaver = account();
        accept(leaver, "BACKER_AGREEMENT", 1);
        assertThat(acceptanceCountFor(leaver)).isEqualTo(1);

        // The suites truncate `users`. A foreign key with NO ACTION here breaks roughly
        // twenty tests in modules that have nothing to do with legal documents, and the
        // failure names this constraint from three frames away.
        new JdbcTemplate(dataSource).update("DELETE FROM users WHERE id = ?", leaver.id());
        assertThat(acceptanceCountFor(leaver)).isZero();
    }

    @Test
    @DisplayName("the documents are readable without an account, and an unpublished one says so")
    void theDocumentsArePublic() {
        assertThat(rest.exchange("/v1/legal/documents/TERMS_OF_USE", HttpMethod.GET, null, mapType())
                        .getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);

        draft("TERMS_OF_USE", "az", "Şərtlər", "Mətn.");
        publish("TERMS_OF_USE", null);

        // No Authorization header anywhere in this test. Terms behind authentication are
        // terms nobody can decide to be bound by.
        ResponseEntity<Map<String, Object>> read =
                rest.exchange("/v1/legal/documents/TERMS_OF_USE", HttpMethod.GET, null, mapType());
        assertThat(read.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(read.getBody().get("body")).isEqualTo("Mətn.");
    }

    @Test
    @DisplayName("a language with no translation falls back to the governing text rather than to nothing")
    void anUntranslatedLanguageFallsBack() {
        draft("PLATFORM_RULES", "az", "Qaydalar", "Azərbaycan dilində.");
        publish("PLATFORM_RULES", null);

        ResponseEntity<Map<String, Object>> russian =
                rest.exchange("/v1/legal/documents/PLATFORM_RULES?locale=ru", HttpMethod.GET, null, mapType());

        assertThat(russian.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(russian.getBody().get("locale")).isEqualTo("az");
    }

    @Test
    @DisplayName("an archived version stays readable, because somebody accepted it")
    void theArchiveIsReachable() {
        draft("TERMS_OF_USE", "az", "Şərtlər", "Birinci mətn.");
        publish("TERMS_OF_USE", null);
        draft("TERMS_OF_USE", "az", "Şərtlər", "İkinci mətn.");
        publish("TERMS_OF_USE", null);

        ResponseEntity<Map<String, Object>> archived =
                rest.exchange("/v1/legal/documents/TERMS_OF_USE/versions/1", HttpMethod.GET, null, mapType());

        assertThat(archived.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(archived.getBody().get("body")).isEqualTo("Birinci mətn.");
    }

    @Test
    @DisplayName("publishing announces the version, so the web's cached legal pages are dropped")
    void publishingAnnouncesTheVersion() {
        legalChanges.clear();
        draft("PRIVACY_POLICY", "az", "Məxfilik", "Mətn.");
        publish("PRIVACY_POLICY", null);

        assertThat(legalChanges.changes())
                .containsExactly(new LegalDocumentInForceChanged(DocumentKind.PRIVACY_POLICY, 1));
    }

    @Test
    @DisplayName("an administrator can show an earlier version, in every language, until the next publication")
    void anEarlierVersionCanBeShown() {
        draft("TERMS_OF_USE", "az", "Şərtlər", "Birinci mətn.");
        draft("TERMS_OF_USE", "en", "Terms", "First text.");
        publish("TERMS_OF_USE", null);
        draft("TERMS_OF_USE", "az", "Şərtlər", "İkinci mətn.");
        draft("TERMS_OF_USE", "en", "Terms", "Second text.");
        publish("TERMS_OF_USE", null);

        ResponseEntity<Map<String, Object>> activated = activate("TERMS_OF_USE", 1, admin().accessToken());
        assertThat(activated.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(events.stream(LegalDocumentInForceChanged.class))
                .contains(new LegalDocumentInForceChanged(DocumentKind.TERMS_OF_USE, 1));

        assertThat(current("TERMS_OF_USE", "az").get("body")).isEqualTo("Birinci mətn.");
        assertThat(current("TERMS_OF_USE", "en").get("body")).isEqualTo("First text.");

        ResponseEntity<Map<String, Object>> history = rest.exchange(
                "/v1/admin/legal/documents/TERMS_OF_USE",
                HttpMethod.GET,
                new HttpEntity<>(authorised(admin().accessToken())),
                mapType());
        assertThat(history.getBody().get("inForceVersion")).isEqualTo(1);

        draft("TERMS_OF_USE", "az", "Şərtlər", "Üçüncü mətn.");
        publish("TERMS_OF_USE", null);

        assertThat(current("TERMS_OF_USE", "az").get("body")).isEqualTo("Üçüncü mətn.");
    }

    @Test
    @DisplayName("a version that was never published cannot be shown")
    void anUnpublishedVersionCannotBeShown() {
        draft("COOKIE_POLICY", "az", "Cookie", "Mətn.");
        publish("COOKIE_POLICY", null);

        assertThat(activate("COOKIE_POLICY", 7, admin().accessToken()).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("only somebody who may publish may choose the version readers are shown")
    void choosingAVersionIsPrivileged() {
        draft("PLATFORM_RULES", "az", "Qaydalar", "Mətn.");
        publish("PLATFORM_RULES", null);

        assertThat(activate("PLATFORM_RULES", 1, account().accessToken()).getStatusCode())
                .isIn(HttpStatus.FORBIDDEN, HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("only somebody who may configure the platform may publish")
    void publishingIsPrivileged() {
        Account nobody = account();

        ResponseEntity<Map<String, Object>> refused = rest.exchange(
                "/v1/admin/legal/documents/TERMS_OF_USE/az/draft",
                HttpMethod.PUT,
                new HttpEntity<>(Map.of("title", "Şərtlər", "body", "Mətn."), authorised(nobody.accessToken())),
                mapType());

        assertThat(refused.getStatusCode()).isIn(HttpStatus.FORBIDDEN, HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("publishing writes an audit row naming the version and the hash")
    void publishingIsAudited() {
        draft("TERMS_OF_USE", "az", "Şərtlər", "Auditlənən mətn.");
        publish("TERMS_OF_USE", null);

        String detail = new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT detail FROM audit_logs WHERE action = 'legal.document_published'"
                                + " ORDER BY occurred_at DESC LIMIT 1",
                        String.class);

        assertThat(detail)
                .contains("TERMS_OF_USE")
                .contains("version 1")
                // The hash is what makes "is the document in the table the document that was
                // published" answerable from the trail alone.
                .contains(LegalDocument.hashOf("Auditlənən mətn."));
    }

    /* ------------------------------------------------------------------
     * Fixtures
     * --------------------------------------------------------------- */

    private record Account(EmailAddress email, String accessToken, UUID id) {
    }

    private void draft(String kind, String locale, String title, String body) {
        ResponseEntity<Map<String, Object>> drafted = rest.exchange(
                "/v1/admin/legal/documents/" + kind + "/" + locale + "/draft",
                HttpMethod.PUT,
                new HttpEntity<>(Map.of("title", title, "body", body), authorised(admin().accessToken())),
                mapType());
        assertThat(drafted.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    private Map<String, Object> publish(String kind, Instant effectiveFrom) {
        return publishExpecting(kind, effectiveFrom, HttpStatus.CREATED).getBody();
    }

    private ResponseEntity<Map<String, Object>> publishExpecting(
            String kind, Instant effectiveFrom, HttpStatus expected) {

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("effectiveFrom", effectiveFrom == null ? null : effectiveFrom.toString());

        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/v1/admin/legal/documents/" + kind + "/publish",
                HttpMethod.POST,
                new HttpEntity<>(body, authorised(admin().accessToken())),
                mapType());

        assertThat(response.getStatusCode()).isEqualTo(expected);
        return response;
    }

    private ResponseEntity<Map<String, Object>> activate(String kind, int version, String accessToken) {
        return rest.exchange(
                "/v1/admin/legal/documents/" + kind + "/versions/" + version + "/activate",
                HttpMethod.POST,
                new HttpEntity<>(authorised(accessToken)),
                mapType());
    }

    private Map<String, Object> current(String kind, String locale) {
        ResponseEntity<Map<String, Object>> read = rest.exchange(
                "/v1/legal/documents/" + kind + "?locale=" + locale, HttpMethod.GET, null, mapType());
        assertThat(read.getStatusCode()).isEqualTo(HttpStatus.OK);
        return read.getBody();
    }

    private ResponseEntity<Map<String, Object>> accept(Account account, String kind, int version) {
        return rest.exchange(
                "/v1/me/agreements/" + kind,
                HttpMethod.POST,
                new HttpEntity<>(Map.of("version", version), authorised(account.accessToken())),
                mapType());
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> documentsOf(Map<String, Object> catalogue) {
        return (List<Map<String, Object>>) catalogue.get("documents");
    }

    private int acceptanceCountFor(Account account) {
        return new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT count(*) FROM document_acceptances WHERE user_id = ?", Integer.class, account.id());
    }

    /**
     * The bootstrapped administrator, with a token issued rather than signed in for.
     *
     * <p>{@code PublishingGateApiTests}'s arrangement and its reason: the address is fixed by
     * {@code application-test.yml}, {@code sign-ins-per-email} is realistically five, and a
     * dozen suites in this build share this account. A suite that took a sign-in would
     * exhaust the limiter for whichever suite ran after it.
     */
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

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        String accessToken = tokens.issue(
                        id,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();

        admin = new Account(email, accessToken, id);
        return admin;
    }

    private Account account() {
        EmailAddress email = EmailAddress.of("legal" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Reader"),
                String.class);

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
