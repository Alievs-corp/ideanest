package az.ideanest.compliance;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.compliance.application.CreatorPayoutDestinations;
import az.ideanest.shared.EmailAddress;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.BankDetailsKeys;
import az.ideanest.support.Destinations;
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
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The payout destination over HTTP — part of issue #432.
 *
 * <p>{@code CreatorPayoutDestinationTests} asserts the rules; this asserts that the two
 * controllers are wired to them and that every refusal arrives as the {@code code} the console
 * branches on. Those are separable and both worth having: a service rule with no route to it
 * protects nothing, and a route whose refusals arrive as 500s is a console that cannot tell a
 * mismatched name from an outage.
 *
 * <p><strong>The token never appears in a response</strong>, and that is asserted rather than
 * assumed. A screen has nothing to do with the value that {@code displayHint} does not do
 * better, and a response carrying it puts it in a browser cache, a proxy log and a bug report.
 */
@DisplayName("The payout destination endpoints")
class PayoutDestinationApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final String ADMIN_EMAIL = "moderator@ideanest.test";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private CreatorPayoutDestinations destinations;

    /** A bank-details key, installed by the tests that store an IBAN and by nothing else. */
    private BankDetailsKeys.Installed keys;

    @AfterEach
    void clear() {
        if (keys != null) {
            keys.close();
            keys = null;
        }
        Destinations.clear(dataSource);
        new JdbcTemplate(dataSource).update("DELETE FROM creator_legal_subjects");
    }

    // ------------------------------------------------------------------
    // The creator's half
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an account with nothing filed says so, rather than 404")
    void nothingFiled() {
        Account creator = account();

        Map<String, Object> mine = mine(creator);

        // One shape for the screen to render. A 404 would make the settings page distinguish
        // "you have not filled this in" from "the endpoint is broken", which it cannot do.
        assertThat(mine.get("recorded")).isEqualTo(false);
        assertThat(mine.get("standing")).isEqualTo("NONE");
        assertThat(mine.get("holderName")).isNull();
        // The suite's scripted provider registers payout cards, so the route is offered.
        assertThat(mine.get("cardRegistrationAvailable")).isEqualTo(true);
    }

    @Test
    @DisplayName("a creator files an account and reads back a hint rather than a token")
    void filingReturnsNoToken() {
        Account creator = account();

        Map<String, Object> saved = record(creator, destination("EPOINT", "tok-live-1", "Aygün Məmmədova"));

        assertThat(saved.get("recorded")).isEqualTo(true);
        assertThat(saved.get("standing")).isEqualTo("AWAITING_VERIFICATION");
        assertThat(saved.get("provider")).isEqualTo("EPOINT");
        assertThat(saved.get("displayHint")).isEqualTo("**4321");
        // The whole response, checked rather than one field: a token that reached the client
        // through a field nobody thought about is the failure this assertion is for.
        assertThat(saved).doesNotContainKey("reference");
        assertThat(saved.values()).doesNotContain("tok-live-1");
    }

    @Test
    @DisplayName("a provider §9.3 has never heard of is a 400 that names it")
    void anUnknownProviderIsABadRequest() {
        Account creator = account();

        Map<String, Object> refused = refusal(
                "/v1/me/payout-destination",
                HttpMethod.PUT,
                creator,
                destination("stripe", "tok-1", "Aygün Məmmədova"),
                HttpStatus.BAD_REQUEST);

        assertThat(refused.get("code")).isEqualTo("UNKNOWN_PAYMENT_PROVIDER");
        assertThat(meta(refused).get("provider")).isEqualTo("stripe");
    }

    @Test
    @DisplayName("an account held by a differently named party comes back as a mismatch, not an error")
    void aMismatchIsAStandingRatherThanARefusal() {
        Account creator = account();
        recordSubject(creator, "Aygün Məmmədova");

        Map<String, Object> saved = record(creator, destination("EPOINT", "tok-2", "Rəşad Əliyev"));

        assertThat(saved.get("standing")).isEqualTo("NAME_MISMATCH");
    }

    // ------------------------------------------------------------------
    // A bank account (#394)
    // ------------------------------------------------------------------

    private static final String IBAN = "AZ21NABZ00000000137010001944";

    @Test
    @DisplayName("without a bank-details key an IBAN is a 503, and nothing is filed")
    void anUnconfiguredKeyringIsUnavailable() {
        // The suite's configuration has no bank-details key, exactly like a deployment that has
        // not provisioned one: it starts, serves everything else, and refuses this write.
        Account creator = account();

        Map<String, Object> refused = refusal(
                "/v1/me/payout-destination/bank-account",
                HttpMethod.PUT,
                creator,
                bankAccount(IBAN, "Aygün Məmmədova"),
                HttpStatus.SERVICE_UNAVAILABLE);

        assertThat(refused.get("code")).isEqualTo("ENCRYPTED_STORAGE_UNAVAILABLE");
        assertThat(mine(creator).get("recorded")).isEqualTo(false);
    }

    @Test
    @DisplayName("with a key, a creator files an IBAN and reads back its hint and never the number")
    void filingABankAccount() {
        keys = BankDetailsKeys.install(destinations);
        Account creator = account();

        Map<String, Object> saved = recordBank(creator, bankAccount("AZ21 NABZ 0000 0000 1370 1000 1944", "Aygün Məmmədova"));

        assertThat(saved.get("recorded")).isEqualTo(true);
        assertThat(saved.get("standing")).isEqualTo("AWAITING_VERIFICATION");
        assertThat(saved.get("kind")).isEqualTo("BANK_TRANSFER");
        assertThat(saved.get("provider")).isEqualTo("BANK_TRANSFER");
        assertThat(saved.get("displayHint")).isEqualTo("AZ21…1944");
        assertThat(saved).doesNotContainKey("reference").doesNotContainKey("iban");
        assertThat(saved.values()).noneSatisfy(value -> assertThat(String.valueOf(value)).contains("NABZ"));

        Map<String, Object> mine = mine(creator);
        assertThat(mine.get("displayHint")).isEqualTo("AZ21…1944");
        assertThat(mine.values()).noneSatisfy(value -> assertThat(String.valueOf(value)).contains("NABZ"));
    }

    @Test
    @DisplayName("an IBAN that does not check out is a 400 naming the defect and not the number")
    void aMalformedIbanIsABadRequest() {
        keys = BankDetailsKeys.install(destinations);
        Account creator = account();

        Map<String, Object> mistyped = refusal(
                "/v1/me/payout-destination/bank-account",
                HttpMethod.PUT,
                creator,
                bankAccount("AZ21NABZ00000000137010001945", "Aygün Məmmədova"),
                HttpStatus.BAD_REQUEST);
        Map<String, Object> foreign = refusal(
                "/v1/me/payout-destination/bank-account",
                HttpMethod.PUT,
                creator,
                bankAccount("GB82WEST12345698765432", "Aygün Məmmədova"),
                HttpStatus.BAD_REQUEST);

        assertThat(mistyped.get("code")).isEqualTo("MALFORMED_IBAN");
        assertThat(meta(mistyped).get("defect")).isEqualTo("CHECKSUM");
        assertThat(mistyped.toString()).doesNotContain("NABZ");
        assertThat(meta(foreign).get("defect")).isEqualTo("COUNTRY_NOT_ACCEPTED");
        assertThat(mine(creator).get("recorded")).isEqualTo(false);
    }

    @Test
    @DisplayName("an IBAN held by a differently named party comes back as a mismatch")
    void aBankAccountMismatch() {
        keys = BankDetailsKeys.install(destinations);
        Account creator = account();
        recordSubject(creator, "Aygün Məmmədova");

        Map<String, Object> saved = recordBank(creator, bankAccount(IBAN, "Rəşad Əliyev"));

        assertThat(saved.get("standing")).isEqualTo("NAME_MISMATCH");
    }

    @Test
    @DisplayName("the token endpoint refuses the bank as a token's issuer")
    void theBankIsNotATokenIssuer() {
        Account creator = account();

        Map<String, Object> refused = refusal(
                "/v1/me/payout-destination",
                HttpMethod.PUT,
                creator,
                destination("BANK_TRANSFER", "AZ21NABZ00000000137010001944", "Aygün Məmmədova"),
                HttpStatus.BAD_REQUEST);

        // Otherwise an IBAN could be filed in the clear as a "token", unsealed and unchecked.
        assertThat(refused.get("code")).isEqualTo("UNKNOWN_PAYMENT_PROVIDER");
    }

    @Test
    @DisplayName("compliance opens the IBAN in full, finance may too, and the panel itself still shows the hint")
    void revealingTheAccount() {
        keys = BankDetailsKeys.install(destinations);
        Account creator = account();
        Account reviewer = staff("api-dest-compliance", StaffRole.COMPLIANCE);
        Account financeOfficer = staff("api-dest-finance", StaffRole.FINANCE);
        recordBank(creator, bankAccount(IBAN, "Aygün Məmmədova"));

        Map<String, Object> panel = get("/v1/admin/accounts/" + creator.id() + "/payout-destination", reviewer);
        assertThat(panel.get("kind")).isEqualTo("BANK_TRANSFER");
        assertThat(panel.get("displayHint")).isEqualTo("AZ21…1944");
        assertThat(panel.values()).noneSatisfy(value -> assertThat(String.valueOf(value)).contains("NABZ"));

        Map<String, Object> opened =
                get("/v1/admin/accounts/" + creator.id() + "/payout-destination/account", reviewer);
        assertThat(opened.get("iban")).isEqualTo(IBAN);
        assertThat(opened.get("holderName")).isEqualTo("Aygün Məmmədova");
        assertThat(opened.get("displayHint")).isEqualTo("AZ21…1944");

        assertThat(get("/v1/admin/accounts/" + creator.id() + "/payout-destination/account", financeOfficer)
                        .get("iban"))
                .isEqualTo(IBAN);

        Integer audited = new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT count(*) FROM audit_logs WHERE action = 'compliance.payout_destination_account_revealed'"
                                + " AND entity_id = ? AND detail NOT LIKE '%NABZ%'",
                        Integer.class,
                        creator.id());
        assertThat(audited).isEqualTo(2);
    }

    @Test
    @DisplayName("a moderator is refused the IBAN, and a token has none to reveal")
    void revealingIsRefused() {
        Account creator = account();
        Account moderator = staff("api-dest-moderator", StaffRole.MODERATOR);
        Account reviewer = staff("api-dest-compliance", StaffRole.COMPLIANCE);
        record(creator, destination("EPOINT", "tok-1", "Aygün Məmmədova"));

        Map<String, Object> forbidden = refusal(
                "/v1/admin/accounts/" + creator.id() + "/payout-destination/account",
                HttpMethod.GET,
                moderator,
                null,
                HttpStatus.FORBIDDEN);
        assertThat(forbidden.get("code")).isEqualTo("INSUFFICIENT_STAFF_CAPABILITY");

        Map<String, Object> none = refusal(
                "/v1/admin/accounts/" + creator.id() + "/payout-destination/account",
                HttpMethod.GET,
                reviewer,
                null,
                HttpStatus.NOT_FOUND);
        assertThat(none.get("code")).isEqualTo("PAYOUT_BANK_ACCOUNT_NOT_FOUND");
    }

    // ------------------------------------------------------------------
    // The reviewer's half
    // ------------------------------------------------------------------

    @Test
    @DisplayName("compliance reads it, confirms it, and the standing moves")
    void aReviewerConfirmsIt() {
        Account creator = account();
        Account reviewer = staff("api-dest-compliance", StaffRole.COMPLIANCE);
        record(creator, destination("EPOINT", "tok-1", "Aygün Məmmədova"));

        Map<String, Object> read = get("/v1/admin/accounts/" + creator.id() + "/payout-destination", reviewer);
        assertThat(read.get("standing")).isEqualTo("AWAITING_VERIFICATION");
        assertThat(read).doesNotContainKey("reference");

        Map<String, Object> verified = post(
                "/v1/admin/accounts/" + creator.id() + "/payout-destination/verify",
                reviewer,
                Map.of("method", "STAFF_ATTESTED"));

        assertThat(verified.get("standing")).isEqualTo("VERIFIED");
        assertThat(verified.get("verificationMethod")).isEqualTo("STAFF_ATTESTED");
        assertThat(verified.get("verifiedBy")).isEqualTo(reviewer.id().toString());
    }

    @Test
    @DisplayName("the queue lists what is waiting on somebody")
    void theQueueListsWhatWaits() {
        Account creator = account();
        Account reviewer = staff("api-dest-compliance", StaffRole.COMPLIANCE);
        record(creator, destination("EPOINT", "tok-1", "Aygün Məmmədova"));

        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/v1/admin/payout-destinations",
                HttpMethod.GET,
                new HttpEntity<>(authorised(reviewer.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> waiting = (List<Map<String, Object>>) response.getBody().get("destinations");
        assertThat(waiting).anySatisfy(row -> assertThat(row.get("creatorId")).isEqualTo(creator.id().toString()));
    }

    @Test
    @DisplayName("finance is refused, which is the whole point of V66's split")
    void financeIsRefused() {
        Account creator = account();
        Account financeOfficer = staff("api-dest-finance", StaffRole.FINANCE);
        record(creator, destination("EPOINT", "tok-1", "Aygün Məmmədova"));

        Map<String, Object> refused = refusal(
                "/v1/admin/accounts/" + creator.id() + "/payout-destination/verify",
                HttpMethod.POST,
                financeOfficer,
                Map.of("method", "STAFF_ATTESTED"),
                HttpStatus.FORBIDDEN);

        // The person who confirms that an account belongs to the creator it is filed under is
        // not the person who sends money to it.
        assertThat(refused.get("code")).isEqualTo("INSUFFICIENT_STAFF_CAPABILITY");
    }

    @Test
    @DisplayName("confirming a mismatched account is a 409 that names the holder")
    void confirmingAMismatchIsAConflict() {
        Account creator = account();
        Account reviewer = staff("api-dest-compliance", StaffRole.COMPLIANCE);
        recordSubject(creator, "Aygün Məmmədova");
        record(creator, destination("EPOINT", "tok-1", "Rəşad Əliyev"));

        Map<String, Object> refused = refusal(
                "/v1/admin/accounts/" + creator.id() + "/payout-destination/verify",
                HttpMethod.POST,
                reviewer,
                Map.of("method", "STAFF_ATTESTED"),
                HttpStatus.CONFLICT);

        assertThat(refused.get("code")).isEqualTo("DESTINATION_NAME_MISMATCH");
        // The reviewer is deciding which of two names is wrong; a refusal that withheld the
        // one it refused on would send them to another screen to find it.
        assertThat(meta(refused).get("holderName")).isEqualTo("Rəşad Əliyev");
    }

    @Test
    @DisplayName("confirming a destination nobody filed is a 404 a reload answers")
    void confirmingNothingIsANotFound() {
        Account creator = account();
        Account reviewer = staff("api-dest-compliance", StaffRole.COMPLIANCE);

        Map<String, Object> refused = refusal(
                "/v1/admin/accounts/" + creator.id() + "/payout-destination/verify",
                HttpMethod.POST,
                reviewer,
                Map.of("method", "STAFF_ATTESTED"),
                HttpStatus.NOT_FOUND);

        assertThat(refused.get("code")).isEqualTo("PAYOUT_DESTINATION_NOT_FOUND");
    }

    @Test
    @DisplayName("a refusal carries a reason the creator can be shown")
    void aRefusalCarriesItsReason() {
        Account creator = account();
        Account reviewer = staff("api-dest-compliance", StaffRole.COMPLIANCE);
        record(creator, destination("EPOINT", "tok-1", "Aygün Məmmədova"));

        Map<String, Object> rejected = post(
                "/v1/admin/accounts/" + creator.id() + "/payout-destination/reject",
                reviewer,
                Map.of("reason", "INCOMPLETE"));

        assertThat(rejected.get("standing")).isEqualTo("REJECTED");
        assertThat(rejected.get("rejectionReason")).isEqualTo("INCOMPLETE");

        // And the creator is told, in the vocabulary the four catalogues have words for.
        assertThat(mine(creator).get("rejectionReason")).isEqualTo("INCOMPLETE");
    }

    @Test
    @DisplayName("there is no endpoint by which a member of staff files a destination")
    void staffCannotFileOne() {
        Account creator = account();
        Account reviewer = staff("api-dest-compliance", StaffRole.COMPLIANCE);

        // The absence is the point of the issue, so it is asserted rather than left to be
        // noticed. `/v1/me/payout-destination` is the only write, and it writes the caller's
        // own row — a reviewer PUTting there files their own account, not the creator's.
        ResponseEntity<String> attempt = rest.exchange(
                "/v1/admin/accounts/" + creator.id() + "/payout-destination",
                HttpMethod.PUT,
                new HttpEntity<>(
                        destination("EPOINT", "tok-staff", "Whoever"), authorised(reviewer.accessToken())),
                String.class);

        assertThat(attempt.getStatusCode()).isEqualTo(HttpStatus.METHOD_NOT_ALLOWED);
        assertThat(mine(creator).get("recorded")).isEqualTo(false);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static Map<String, Object> destination(String provider, String reference, String holderName) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("provider", provider);
        body.put("reference", reference);
        body.put("holderName", holderName);
        body.put("displayHint", "**4321");
        return body;
    }

    private static Map<String, Object> bankAccount(String iban, String holderName) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("iban", iban);
        body.put("holderName", holderName);
        return body;
    }

    private Map<String, Object> recordBank(Account account, Map<String, Object> body) {
        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/v1/me/payout-destination/bank-account",
                HttpMethod.PUT,
                new HttpEntity<>(body, authorised(account.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return response.getBody();
    }

    private void recordSubject(Account creator, String legalName) {
        ResponseEntity<String> response = rest.exchange(
                "/v1/me/legal-subject",
                HttpMethod.PUT,
                new HttpEntity<>(
                        Map.of("subjectKind", "INDIVIDUAL", "legalName", legalName),
                        authorised(creator.accessToken())),
                String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    private Map<String, Object> record(Account account, Map<String, Object> body) {
        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/v1/me/payout-destination",
                HttpMethod.PUT,
                new HttpEntity<>(body, authorised(account.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return response.getBody();
    }

    private Map<String, Object> mine(Account account) {
        return get("/v1/me/payout-destination", account);
    }

    private Map<String, Object> get(String path, Account account) {
        ResponseEntity<Map<String, Object>> response = rest.exchange(
                path,
                HttpMethod.GET,
                new HttpEntity<>(authorised(account.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return response.getBody();
    }

    private Map<String, Object> post(String path, Account account, Map<String, Object> body) {
        ResponseEntity<Map<String, Object>> response = rest.exchange(
                path,
                HttpMethod.POST,
                new HttpEntity<>(body, authorised(account.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return response.getBody();
    }

    private Map<String, Object> refusal(
            String path, HttpMethod method, Account account, Map<String, Object> body, HttpStatus expected) {

        ResponseEntity<Map<String, Object>> response = rest.exchange(
                path,
                method,
                new HttpEntity<>(body, authorised(account.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        assertThat(response.getStatusCode()).isEqualTo(expected);
        return response.getBody();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> meta(Map<String, Object> problem) {
        return (Map<String, Object>) problem.get("meta");
    }

    private Account account() {
        EmailAddress email =
                EmailAddress.of("payout-destination-%d@example.com".formatted(SEQUENCE.incrementAndGet()));
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Creator"),
                String.class);
        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Account(tokenFor(id), id);
    }

    /** A staff account with one role, granted with SQL. {@code CreatorPayoutDestinationTests}' argument. */
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
                        administrator(),
                        "#432 fixture");
        return new Account(tokenFor(id), id);
    }

    private UUID administrator() {
        EmailAddress email = EmailAddress.of(ADMIN_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Administrator"),
                    String.class);
        }
        return users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
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
