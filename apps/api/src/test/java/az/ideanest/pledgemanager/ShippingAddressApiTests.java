package az.ideanest.pledgemanager;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditEntry;
import az.ideanest.audit.AuditEntryRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.Identifiers;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.user.infrastructure.UserRepository;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
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
 * §4.8's PM-07 and PM-08 (#75): where a reward is posted, and freezing that answer.
 *
 * <p>The tests that carry the design:
 *
 * <ul>
 *   <li>{@link #theStoredRowContainsNoneOfTheAddress()} — §17.2, asserted against the
 *       bytes in the table rather than against the fact that a cipher was called. This
 *       is the test the feature exists for.
 *   <li>{@link #theAddressHasToGoWhereShippingWasQuoted()} — an address elsewhere is a
 *       parcel the creator was never paid to post.
 *   <li>{@link #aLockedAddressCannotBeEditedByItsBacker()} — PM-08, and that it is a
 *       409 rather than a 403: the backer is permitted, the row is not.
 *   <li>{@link #lockingIsAuditedAndTheBackersOwnWriteIsNot()} — the asymmetry, stated
 *       as a rule in {@code AuditAction.PROJECT_ADDRESSES_LOCKED}.
 *   <li>{@link #eachSaveUsesAFreshNonce()} — nonce reuse is the failure that breaks
 *       GCM completely rather than gradually.
 * </ul>
 */
class ShippingAddressApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AuditEntryRepository auditEntries;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM shipping_addresses");
        jdbc.update("DELETE FROM pledges");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    // ------------------------------------------------------------------
    // The feature
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a backer records an address and reads it back")
    void aBackerRecordsAnAddress() {
        Account creator = account("addr-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("addr-backer");
        UUID pledge = pledgeFor(project, backer.id(), "COLLECTED", "AZ");

        ResponseEntity<Map<String, Object>> saved = save(pledge, backer, address("AZ"));

        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(saved.getHeaders().getCacheControl())
                .as("a home address is not something a shared cache should hold")
                .contains("no-store");
        assertThat(addressOf(saved.getBody())).containsEntry("locality", "Baku");
        assertThat(saved.getBody()).containsEntry("locked", false);

        ResponseEntity<Map<String, Object>> read = read(pledge, backer);
        assertThat(addressOf(read.getBody())).containsEntry("line1", "12 Nizami street");
    }

    @Test
    @DisplayName("a pledge with no address yet answers 204 rather than 404")
    void aMissingAddressIsNotAMissingPledge() {
        Account creator = account("empty-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("empty-backer");
        UUID pledge = pledgeFor(project, backer.id(), "COLLECTED", "AZ");

        // The pledge exists and the address does not, which is a different fact from
        // "no such pledge" and the one a form needs in order to render itself blank.
        assertThat(read(pledge, backer).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    }

    @Test
    @DisplayName("an optional part left blank comes back as null rather than as an empty string")
    void blankOptionalPartsAreNull() {
        Account creator = account("blank-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("blank-backer");
        UUID pledge = pledgeFor(project, backer.id(), "COLLECTED", "AZ");

        Map<String, Object> body = address("AZ");
        body.put("line2", "   ");
        body.put("region", "");

        Map<String, Object> stored = addressOf(save(pledge, backer, body).getBody());
        assertThat(stored.get("line2")).isNull();
        assertThat(stored.get("region")).isNull();
    }

    @Test
    @DisplayName("a missing required part is refused, naming the field")
    void aMissingRequiredPartIsRefused() {
        Account creator = account("required-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("required-backer");
        UUID pledge = pledgeFor(project, backer.id(), "COLLECTED", "AZ");

        Map<String, Object> body = address("AZ");
        body.remove("line1");

        ResponseEntity<Map<String, Object>> refused = save(pledge, backer, body);
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "ADDRESS_INVALID");
        assertThat(meta(refused.getBody())).containsEntry("field", "line1");
    }

    // ------------------------------------------------------------------
    // §17.2 — encrypted at rest
    // ------------------------------------------------------------------

    /**
     * The test the feature exists for.
     *
     * <p>Asserted against the bytes in the table, not against the fact that a cipher
     * was called: what §17.2 promises is that a backup, a read replica and a
     * {@code SELECT *} see nothing, and the only way to check that is to look at what
     * a {@code SELECT *} sees.
     */
    @Test
    @DisplayName("the stored row contains none of the address in readable form")
    void theStoredRowContainsNoneOfTheAddress() {
        Account creator = account("crypto-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("crypto-backer");
        UUID pledge = pledgeFor(project, backer.id(), "COLLECTED", "AZ");

        save(pledge, backer, address("AZ"));

        byte[] ciphertext = new JdbcTemplate(dataSource)
                .queryForObject("SELECT ciphertext FROM shipping_addresses WHERE pledge_id = ?", byte[].class, pledge);
        String asText = new String(ciphertext, StandardCharsets.ISO_8859_1);

        assertThat(asText).doesNotContain("Nizami");
        assertThat(asText).doesNotContain("Baku");
        assertThat(asText).doesNotContain("Aysel");
        assertThat(asText).doesNotContain("AZ1000");

        assertThat(new JdbcTemplate(dataSource)
                        .queryForObject("SELECT key_id FROM shipping_addresses WHERE pledge_id = ?", String.class, pledge))
                .as("the row records which key sealed it, which is the whole of rotation")
                .isEqualTo("test");
    }

    /**
     * A fresh nonce every time, including when the address did not change.
     *
     * <p>Nonce reuse under one key is the failure that breaks GCM completely rather
     * than gradually, and "the address did not change" is exactly the case where a
     * naive implementation would keep the old one.
     */
    @Test
    @DisplayName("each save uses a fresh nonce, even for an identical address")
    void eachSaveUsesAFreshNonce() {
        Account creator = account("nonce-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("nonce-backer");
        UUID pledge = pledgeFor(project, backer.id(), "COLLECTED", "AZ");

        save(pledge, backer, address("AZ"));
        byte[] first = nonceOf(pledge);
        save(pledge, backer, address("AZ"));
        byte[] second = nonceOf(pledge);

        assertThat(second).isNotEqualTo(first);
        assertThat(second).hasSize(12);
    }

    // ------------------------------------------------------------------
    // The destination has to match what was quoted
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an address in a country the pledge was not quoted for is refused")
    void theAddressHasToGoWhereShippingWasQuoted() {
        Account creator = account("dest-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("dest-backer");
        UUID pledge = pledgeFor(project, backer.id(), "COLLECTED", "AZ");

        ResponseEntity<Map<String, Object>> refused = save(pledge, backer, address("DE"));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat(refused.getBody()).containsEntry("code", "ADDRESS_DESTINATION_MISMATCH");
        assertThat(meta(refused.getBody())).containsEntry("quoted", "AZ").containsEntry("given", "DE");
    }

    @Test
    @DisplayName("a pledge with nothing to post takes no address at all")
    void aPledgeWithNothingToPostTakesNoAddress() {
        Account creator = account("digital-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("digital-backer");
        UUID pledge = pledgeFor(project, backer.id(), "COLLECTED", null);

        ResponseEntity<Map<String, Object>> refused = save(pledge, backer, address("AZ"));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat(refused.getBody()).containsEntry("code", "ADDRESS_NOT_REQUIRED");
    }

    // ------------------------------------------------------------------
    // PM-08 — the lock
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a locked address cannot be edited by its backer")
    void aLockedAddressCannotBeEditedByItsBacker() {
        Account creator = account("lock-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("lock-backer");
        UUID pledge = pledgeFor(project, backer.id(), "COLLECTED", "AZ");
        save(pledge, backer, address("AZ"));

        ResponseEntity<Map<String, Object>> locked = lock(project, creator);
        assertThat(locked.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(locked.getBody()).containsEntry("locked", 1);

        ResponseEntity<Map<String, Object>> refused = save(pledge, backer, address("AZ"));
        assertThat(refused.getStatusCode())
                .as("the backer is permitted; the row is not editable")
                .isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "ADDRESS_LOCKED");

        assertThat(read(pledge, backer).getBody()).containsEntry("locked", true);
    }

    @Test
    @DisplayName("a second lock reports zero, because it froze nothing")
    void aSecondLockReportsZero() {
        Account creator = account("relock-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("relock-backer");
        save(pledgeFor(project, backer.id(), "COLLECTED", "AZ"), backer, address("AZ"));

        lock(project, creator);

        // A creator who read "1 locked" after pressing the button twice would believe
        // something happened the second time.
        assertThat(lock(project, creator).getBody()).containsEntry("locked", 0);
    }

    @Test
    @DisplayName("locking is audited and the backer's own write is not")
    void lockingIsAuditedAndTheBackersOwnWriteIsNot() {
        Account creator = account("auditlock-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("auditlock-backer");
        save(pledgeFor(project, backer.id(), "COLLECTED", "AZ"), backer, address("AZ"));

        long writes = auditRows(project, AuditAction.PROJECT_ADDRESSES_LOCKED).size();
        assertThat(writes).as("a backer changing their own data is not a privileged action").isZero();

        lock(project, creator);

        List<AuditEntry> entries = auditRows(project, AuditAction.PROJECT_ADDRESSES_LOCKED);
        assertThat(entries).singleElement().satisfies(entry -> {
            assertThat(entry.getDetail()).contains("locked=1");
            assertThat(entry.getDetail())
                    .as("audit_logs has no retention rule, so no address goes in it")
                    .doesNotContain("Nizami");
        });
    }

    @Test
    @DisplayName("the progress read decrypts nothing and names nobody")
    void progressIsJustCounts() {
        Account creator = account("progress-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("progress-backer");
        save(pledgeFor(project, backer.id(), "COLLECTED", "AZ"), backer, address("AZ"));

        ResponseEntity<Map<String, Object>> progress = exchange(
                "/v1/projects/" + project + "/shipping-addresses/progress",
                HttpMethod.GET,
                creator.accessToken(),
                null);

        assertThat(progress.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(progress.getBody()).containsEntry("given", 1).containsEntry("editable", 1).containsEntry("locked", 0);
        assertThat(progress.getBody().keySet()).containsExactlyInAnyOrder("given", "locked", "editable");
    }

    // ------------------------------------------------------------------
    // Who may see what
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a stranger cannot read or write somebody else's address")
    void aStrangerCannotReachAnotherBackersAddress() {
        Account creator = account("guard-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("guard-backer");
        Account stranger = account("guard-stranger");
        UUID pledge = pledgeFor(project, backer.id(), "COLLECTED", "AZ");
        save(pledge, backer, address("AZ"));

        assertThat(read(pledge, stranger).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(save(pledge, stranger, address("AZ")).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("the creator cannot lock a campaign they have no part in")
    void aStrangerCannotLock() {
        Account creator = account("lockguard-creator");
        UUID project = liveCampaign(creator);
        Account stranger = account("lockguard-stranger");

        assertThat(lock(project, stranger).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private static Map<String, Object> address(String country) {
        Map<String, Object> body = new HashMap<>();
        body.put("recipient", "Aysel Mammadova");
        body.put("line1", "12 Nizami street");
        body.put("line2", "Flat 4");
        body.put("locality", "Baku");
        body.put("region", "Nasimi");
        body.put("postcode", "AZ1000");
        body.put("countryCode", country);
        body.put("phone", "+994501234567");
        return body;
    }

    private Account account(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);

        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Account((String) signedIn.getBody().get("accessToken"), id);
    }

    private UUID liveCampaign(Account creator) {
        ResponseEntity<Map<String, Object>> created = exchange(
                "/v1/projects",
                HttpMethod.POST,
                creator.accessToken(),
                Map.of("title", "A campaign that posts things " + SEQUENCE.incrementAndGet()));
        UUID project = UUID.fromString((String) created.getBody().get("id"));
        Campaigns.launch(dataSource, project);
        return project;
    }

    private UUID pledgeFor(UUID project, UUID backerId, String state, String country) {
        UUID pledgeId = Identifiers.newIdentifier();
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO pledges
                            (id, project_id, backer_id, state, base_amount, shipping_country, confirmed_at)
                        VALUES (?, ?, ?, ?, 25.00, ?, now())
                        """,
                        pledgeId,
                        project,
                        backerId,
                        state,
                        country);
        return pledgeId;
    }

    private ResponseEntity<Map<String, Object>> save(UUID pledge, Account caller, Map<String, Object> body) {
        return exchange("/v1/pledges/" + pledge + "/shipping-address", HttpMethod.PATCH, caller.accessToken(), body);
    }

    private ResponseEntity<Map<String, Object>> read(UUID pledge, Account caller) {
        return exchange("/v1/pledges/" + pledge + "/shipping-address", HttpMethod.GET, caller.accessToken(), null);
    }

    private ResponseEntity<Map<String, Object>> lock(UUID project, Account caller) {
        return exchange(
                "/v1/projects/" + project + "/shipping-addresses/lock", HttpMethod.POST, caller.accessToken(), null);
    }

    private byte[] nonceOf(UUID pledge) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT nonce FROM shipping_addresses WHERE pledge_id = ?", byte[].class, pledge);
    }

    private List<AuditEntry> auditRows(UUID project, AuditAction action) {
        // Filtered to this campaign: `audit_logs` refuses DELETE by design (V21), so
        // the table carries every other test's rows too.
        return auditEntries.findAll().stream()
                .filter(entry -> entry.getAction().equals(action.action()))
                .filter(entry -> project.equals(entry.getEntityId()))
                .toList();
    }

    private ResponseEntity<Map<String, Object>> exchange(String path, HttpMethod method, String token, Object body) {
        return rest.exchange(
                path,
                method,
                new HttpEntity<>(body, token == null ? jsonHeaders() : bearer(token)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> addressOf(Map<String, Object> body) {
        return (Map<String, Object>) body.get("address");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> meta(Map<String, Object> body) {
        return (Map<String, Object>) body.get("meta");
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    private static HttpHeaders bearer(String accessToken) {
        HttpHeaders headers = jsonHeaders();
        headers.setBearerAuth(accessToken);
        return headers;
    }
}
