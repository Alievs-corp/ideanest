package az.ideanest.notification;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.notification.application.NotificationMessage;
import az.ideanest.notification.application.TemplateOverrides;
import az.ideanest.notification.domain.NotificationChannel;
import az.ideanest.notification.domain.NotificationType;
import az.ideanest.notification.infrastructure.EmailComposer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.MailServerStub;
import az.ideanest.user.infrastructure.UserRepository;
import jakarta.mail.internet.MimeMessage;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
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
 * AD-15's third verb — writing, versioning and withdrawing the copy of an email, per language.
 *
 * <p>The suite exists because the editor never worked: every {@code PUT} wrote the locale
 * {@code und}, V52's CHECK refused it, and the console met a 500. So the first assertion is the
 * plain one — an edit is accepted — and the rest are the rules that make an accepted edit safe:
 * it applies to one language, it keeps the facts the message carries (the campaign name included),
 * it renders, and its apostrophes are apostrophes.
 */
class EmailTemplateEditorApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";
    private static final String ROLE_FIXTURE_NOTE = "email template editor fixture";

    private static final String COPY = "/v1/admin/email-templates/PLEDGE_CONFIRMED/copy";

    /** Keeps both slots PLEDGE_CONFIRMED's shipped copy uses: the campaign and the amount. */
    private static final Map<String, Object> GOOD = Map.of(
            "subject", "{1}: dəstəyiniz qəbul olundu",
            "body", "{1} kampaniyasına {2} dəstəyiniz qəbul olundu.",
            "note", "Daha qısa");

    private static Account moderator;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private TemplateOverrides overrides;

    @Autowired
    private EmailComposer composer;

    /**
     * Every version this suite wrote, gone — {@code created_by} restricts on {@code users}, so a
     * row left behind would fail the next suite's {@code DELETE FROM users}. The cache is dropped
     * with it, because it would otherwise keep rendering an override the table no longer has.
     */
    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM email_template_versions");
        jdbc.update("DELETE FROM staff_role_grants WHERE note = ?", ROLE_FIXTURE_NOTE);
        overrides.reload();
    }

    // ------------------------------------------------------------------
    // Writing a version
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an edit is accepted, goes live at once and says when it was written")
    @SuppressWarnings("unchecked")
    void anEditGoesLive() {
        ResponseEntity<Map<String, Object>> written = put(COPY + "?locale=az", GOOD, moderator().accessToken());

        assertThat(written.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(written.getBody())
                .containsEntry("version", 1)
                .containsEntry("live", true)
                .containsEntry("locale", "az")
                .containsEntry("requiredPlaceholders", List.of("1", "2"));
        assertThat(written.getBody().get("createdAt")).as("the write's own response carries its time").isNotNull();

        Map<String, Object> draft = get(COPY + "?locale=az", moderator().accessToken()).getBody();
        assertThat(draft).containsEntry("locale", "az");
        assertThat(draft.get("override")).asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.MAP)
                .containsEntry("version", 1);
        assertThat(draft.get("shippedSubjectNamed")).isEqualTo("{1} kampaniyasına dəstəyiniz təsdiqləndi");
        assertThat(draft.get("requiredPlaceholders")).isEqualTo(List.of("1", "2"));
        assertThat((List<Object>) draft.get("availablePlaceholders")).contains("0", "1", "2").doesNotContain("5");
    }

    @Test
    @DisplayName("a second edit is version two and the first stops being live, and both stay in the history")
    void aSecondEditIsAVersion() {
        put(COPY + "?locale=az", GOOD, moderator().accessToken());
        put(COPY + "?locale=az", Map.of("subject", "{1} — qəbul", "body", "{1}: {2} qəbul olundu."), moderator().accessToken());

        List<Map<String, Object>> versions = versionsOf(get(
                "/v1/admin/email-templates/PLEDGE_CONFIRMED/versions?locale=az", moderator().accessToken()));

        assertThat(versions).extracting(version -> version.get("version")).containsExactly(2, 1);
        assertThat(versions).extracting(version -> version.get("live")).containsExactly(true, false);
    }

    @Test
    @DisplayName("two saves at the same moment are two consecutive versions, not a 500")
    void concurrentEditsAreSerialised() {
        String token = moderator().accessToken();
        CompletableFuture<ResponseEntity<Map<String, Object>>> first =
                CompletableFuture.supplyAsync(() -> put(COPY + "?locale=az", GOOD, token));
        CompletableFuture<ResponseEntity<Map<String, Object>>> second =
                CompletableFuture.supplyAsync(() -> put(COPY + "?locale=az", GOOD, token));

        assertThat(first.join().getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(second.join().getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(versionsOf(get("/v1/admin/email-templates/PLEDGE_CONFIRMED/versions?locale=az", token)))
                .extracting(version -> version.get("version"))
                .containsExactly(2, 1);
    }

    // ------------------------------------------------------------------
    // One language at a time
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an Azerbaijani edit leaves the English copy alone, and each language reads its own shipped text")
    void anOverrideIsPerLanguage() {
        put(COPY + "?locale=az", GOOD, moderator().accessToken());

        Map<String, Object> english = get(COPY + "?locale=en", moderator().accessToken()).getBody();
        assertThat(english).containsEntry("locale", "en").doesNotContainKey("override");
        assertThat(english.get("shippedSubject")).asString().doesNotContain("təsdiq");

        assertThat(get(COPY + "?locale=de", moderator().accessToken()).getStatusCode())
                .as("a language the platform does not translate into has no copy to edit")
                .isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @DisplayName("a recipient gets the override for their language, and the shipped copy in any other")
    void theSenderUsesTheRecipientsLanguage() {
        put(COPY + "?locale=az", GOOD, moderator().accessToken());

        assertThat(composer.compose(message(true), "Aysel", Locale.forLanguageTag("az")).subject())
                .isEqualTo("Xari Bulbul Ceramics: dəstəyiniz qəbul olundu");
        assertThat(composer.compose(message(true), "Aysel", Locale.forLanguageTag("en")).subject())
                .as("English has no override, so it sends its own shipped copy")
                .doesNotContain("qəbul");
    }

    @Test
    @DisplayName("an override that names the campaign is not sent for a notification with no campaign name")
    void anOldNotificationGetsTheShippedCopy() {
        put(COPY + "?locale=az", GOOD, moderator().accessToken());

        assertThat(composer.compose(message(false), "Aysel", Locale.forLanguageTag("az")).subject())
                .as("the shipped sentence written for the nameless case, not the edit with a hole in it")
                .isEqualTo("Dəstəyiniz təsdiqləndi");
    }

    // ------------------------------------------------------------------
    // What an edit must keep, and must be
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an edit that drops the amount, or the campaign name, is refused and says which")
    void aMissingPlaceholderIsRefused() {
        ResponseEntity<Map<String, Object>> noAmount = put(
                COPY + "?locale=az",
                Map.of("subject", "{1}", "body", "{1} kampaniyasına dəstəyiniz qəbul olundu."),
                moderator().accessToken());
        assertThat(noAmount.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat(noAmount.getBody()).containsEntry("code", "MISSING_TEMPLATE_PLACEHOLDER");
        assertThat(noAmount.getBody().get("meta")).isEqualTo(Map.of("missing", List.of("2")));

        ResponseEntity<Map<String, Object>> noCampaign = put(
                COPY + "?locale=az",
                Map.of("subject", "Dəstəyiniz qəbul olundu", "body", "{2} dəstəyiniz qəbul olundu."),
                moderator().accessToken());
        assertThat(noCampaign.getBody().get("meta"))
                .as("the campaign-named variant counts, so the name cannot be dropped quietly")
                .isEqualTo(Map.of("missing", List.of("1")));
    }

    @Test
    @DisplayName("an edit that would not render is refused before it is stored")
    void malformedCopyIsRefused() {
        ResponseEntity<Map<String, Object>> unbalanced = put(
                COPY + "?locale=az",
                Map.of("subject", "{1}", "body", "{1} kampaniyasına {2 dəstəyiniz"),
                moderator().accessToken());
        assertThat(unbalanced.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat(unbalanced.getBody()).containsEntry("code", "TEMPLATE_COPY_MALFORMED");
        assertThat(unbalanced.getBody().get("meta")).isEqualTo(Map.of("field", "body", "reason", "SYNTAX"));

        ResponseEntity<Map<String, Object>> unknown = put(
                COPY + "?locale=az",
                Map.of("subject", "{1} {5}", "body", "{1} kampaniyasına {2}."),
                moderator().accessToken());
        assertThat(unknown.getBody().get("meta"))
                .isEqualTo(Map.of("field", "subject", "reason", "UNKNOWN_PLACEHOLDER", "placeholder", "5"));

        ResponseEntity<Map<String, Object>> formatted = put(
                COPY + "?locale=az",
                Map.of("subject", "{1}", "body", "{1} kampaniyasına {2,number}."),
                moderator().accessToken());
        assertThat(formatted.getBody()).containsEntry("code", "TEMPLATE_COPY_MALFORMED");

        assertThat(versionsOf(get("/v1/admin/email-templates/PLEDGE_CONFIRMED/versions?locale=az", moderator().accessToken())))
                .as("nothing was stored")
                .isEmpty();
    }

    @Test
    @DisplayName("an apostrophe is an apostrophe, and the placeholders after it still expand")
    void anApostropheIsLiteral() {
        ResponseEntity<Map<String, Object>> preview = post(
                "/v1/admin/email-templates/PLEDGE_CONFIRMED/preview",
                Map.of("locale", "tr", "subject", "IdeyaNest'te {1}", "body", "{1}'e {2} destek verdiniz."),
                moderator().accessToken());

        assertThat(preview.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(preview.getBody()).containsEntry("subject", "IdeyaNest'te Xari Bulbul Ceramics");
        assertThat((String) preview.getBody().get("text")).contains("Xari Bulbul Ceramics'e 120.00 AZN destek verdiniz.");
        assertThat((String) preview.getBody().get("html")).contains("<table");
    }

    @Test
    @DisplayName("a preview of unsaved text is refused only when it would not render")
    void aPreviewRefusesOnlyWhatCannotRender() {
        assertThat(post(
                        "/v1/admin/email-templates/PLEDGE_CONFIRMED/preview",
                        Map.of("locale", "az", "subject", "Qəbul", "body", "Qəbul olundu."),
                        moderator().accessToken())
                .getStatusCode())
                .as("a missing placeholder still previews, so the loss can be seen")
                .isEqualTo(HttpStatus.OK);

        ResponseEntity<Map<String, Object>> refused = post(
                "/v1/admin/email-templates/PLEDGE_CONFIRMED/preview",
                Map.of("locale", "az", "subject", "{", "body", "Qəbul olundu."),
                moderator().accessToken());
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat(refused.getBody()).containsEntry("code", "TEMPLATE_COPY_MALFORMED");
    }

    @Test
    @DisplayName("unsaved text can be sent to the caller's own address, in the language being edited")
    void unsavedTextCanBeTestSent() throws Exception {
        MailServerStub.clear();

        ResponseEntity<Map<String, Object>> sent = post(
                "/v1/admin/email-templates/PLEDGE_CONFIRMED/test-send",
                Map.of("locale", "az", "subject", "Sınaq: {1}", "body", "{1} üçün {2}."),
                moderator().accessToken());

        assertThat(sent.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        MimeMessage received = MailServerStub.awaitOne();
        assertThat(received.getAllRecipients()[0].toString()).contains(MODERATOR_EMAIL);
        assertThat(received.getSubject()).isEqualTo("Sınaq: Xari Bulbul Ceramics");
    }

    // ------------------------------------------------------------------
    // Withdrawing
    // ------------------------------------------------------------------

    @Test
    @DisplayName("withdrawing sends the shipped copy again, keeps the versions and is its own audit action")
    void withdrawingIsRecorded() {
        put(COPY + "?locale=az", GOOD, moderator().accessToken());

        ResponseEntity<Map<String, Object>> withdrawn = delete(COPY + "?locale=az", moderator().accessToken());
        assertThat(withdrawn.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        assertThat(get(COPY + "?locale=az", moderator().accessToken()).getBody()).doesNotContainKey("override");
        assertThat(versionsOf(get("/v1/admin/email-templates/PLEDGE_CONFIRMED/versions?locale=az", moderator().accessToken())))
                .extracting(version -> version.get("live"))
                .containsExactly(false);

        Integer recorded = new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT count(*) FROM audit_logs WHERE action = 'email.template_withdrawn' AND detail LIKE ?",
                        Integer.class,
                        "%template=PLEDGE_CONFIRMED; locale=az; version=1%");
        assertThat(recorded).isPositive();
    }

    // ------------------------------------------------------------------
    // The list, and who may
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the list says which languages a template is rewritten in, and which version is live")
    void theListNamesTheOverrides() {
        put(COPY + "?locale=az", GOOD, moderator().accessToken());
        put(COPY + "?locale=az", GOOD, moderator().accessToken());

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> templates = (List<Map<String, Object>>)
                get("/v1/admin/email-templates", moderator().accessToken()).getBody().get("templates");

        Map<String, Object> confirmed = templates.stream()
                .filter(template -> "PLEDGE_CONFIRMED".equals(template.get("type")))
                .findFirst()
                .orElseThrow();
        assertThat(confirmed.get("overrides")).isEqualTo(List.of(Map.of("locale", "az", "liveVersion", 2)));

        Map<String, Object> edited = templates.stream()
                .filter(template -> "PLEDGE_EDITED".equals(template.get("type")))
                .findFirst()
                .orElseThrow();
        assertThat(edited.get("overrides")).isEqualTo(List.of());
    }

    @Test
    @DisplayName("a colleague without CONFIGURE_PLATFORM is refused, and told which capability")
    void editingNeedsConfigurePlatform() {
        Account curator = staff("template-curator", StaffRole.CURATOR);

        ResponseEntity<Map<String, Object>> refused = put(COPY + "?locale=az", GOOD, curator.accessToken());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody()).containsEntry("code", "INSUFFICIENT_STAFF_CAPABILITY");
        assertThat(refused.getBody()).extracting("meta").hasToString("{capability=CONFIGURE_PLATFORM}");

        assertThat(put(COPY + "?locale=az", GOOD, account().accessToken()).getBody())
                .containsEntry("code", "NOT_A_MODERATOR");
    }

    @Test
    @DisplayName("a type the platform never emails has no copy to edit")
    void aTypeWithNoEmailHasNoCopy() {
        ResponseEntity<Map<String, Object>> refused =
                get("/v1/admin/email-templates/DEADLINE_24H/copy", moderator().accessToken());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "TEMPLATE_NOT_EMAILED");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    /** A pledge notification as the sender sees one, with or without the campaign's name. */
    private static NotificationMessage message(boolean named) {
        String params = named
                ? """
                  {"projectTitle": "Xari Bulbul Ceramics", "creatorSlug": "aysel-studio",
                   "projectSlug": "xari-bulbul-ceramics", "amount": {"amount": "120.00", "currency": "AZN"}}"""
                : """
                  {"amount": {"amount": "120.00", "currency": "AZN"}}""";
        UUID id = UUID.fromString("01890000-0000-7000-8000-0000000000e1");
        return new NotificationMessage(
                id,
                id,
                NotificationType.PLEDGE_CONFIRMED,
                NotificationChannel.EMAIL,
                "project",
                UUID.fromString("01890000-0000-7000-8000-0000000000e2"),
                params,
                Instant.parse("2026-10-01T08:00:00Z"),
                1);
    }

    private Account account() {
        EmailAddress email = EmailAddress.of("template-editor-" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);
        return new Account(tokenFor(email), users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId());
    }

    /** The bootstrap administrator, minted rather than signed in for — see EmailTemplateApiTests. */
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
        moderator = new Account(tokenFor(email), users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId());
        return moderator;
    }

    /** A member of staff holding exactly one role, granted with SQL as ConsoleReadApiTests does. */
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
                        ROLE_FIXTURE_NOTE);
        return new Account(tokenFor(email), id);
    }

    private String tokenFor(EmailAddress email) {
        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return tokens.issue(
                        id,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> versionsOf(ResponseEntity<Map<String, Object>> response) {
        return (List<Map<String, Object>>) response.getBody().get("versions");
    }

    private ResponseEntity<Map<String, Object>> get(String path, String token) {
        return exchange(path, HttpMethod.GET, null, token);
    }

    private ResponseEntity<Map<String, Object>> put(String path, Map<String, Object> body, String token) {
        return exchange(path, HttpMethod.PUT, body, token);
    }

    private ResponseEntity<Map<String, Object>> post(String path, Map<String, Object> body, String token) {
        return exchange(path, HttpMethod.POST, body, token);
    }

    private ResponseEntity<Map<String, Object>> delete(String path, String token) {
        return exchange(path, HttpMethod.DELETE, null, token);
    }

    private ResponseEntity<Map<String, Object>> exchange(
            String path, HttpMethod method, Map<String, Object> body, String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(token);
        return rest.exchange(
                path, method, new HttpEntity<>(body, headers), new ParameterizedTypeReference<Map<String, Object>>() {});
    }
}
