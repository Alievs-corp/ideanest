package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditEntry;
import az.ideanest.audit.AuditEntryRepository;
import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Ledgers;
import az.ideanest.support.Pledges;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
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
 * §4.11's AD-05 reconciliation, over HTTP — issue #106.
 *
 * <p>#70 built the arithmetic and {@code LedgerReconciliationTests} covers it as a unit,
 * which is where it belongs: it is a pure function of two queries. What is asserted here is
 * everything that unit test cannot see — that a member of finance can actually reach it,
 * that a stranger cannot, that a discrepancy planted in the real tables comes back through
 * the endpoint, and that asking for a pass leaves a record of who asked.
 *
 * <p><strong>Every test starts from empty financial tables.</strong> Reconciliation is a
 * question about the whole platform, so a suite that ran after one which left a charge
 * behind would report that charge as a finding — a failure about the previous suite wearing
 * this one's name. {@code Ledgers.clear} is the same helper every payment suite already
 * calls in its teardown; here it runs before as well, because "the books balance" is only a
 * meaningful assertion against books this test owns.
 */
class ReconciliationApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** The single address {@code application-test.yml} bootstraps as an administrator. */
    private static final String STAFF_EMAIL = "moderator@ideanest.test";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AuditEntryRepository auditEntries;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    @BeforeEach
    void balancedBooks() {
        Ledgers.clear(dataSource);
    }

    @AfterEach
    void leaveNothingBehind() {
        Ledgers.clear(dataSource);
        Campaigns.clear(dataSource);
    }

    // ------------------------------------------------------------------
    // Who may ask
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an anonymous request is refused")
    void anonymousIsRefused() {
        assertThat(rest.getForEntity("/v1/admin/reconciliation", String.class).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a signed-in reader who is not staff is refused, and so is running one")
    void aStrangerIsRefused() {
        String token = tokenFor(register("recon-stranger-" + SEQUENCE.incrementAndGet()));

        assertThat(get("/v1/admin/reconciliation", token).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(runAsRaw(token).getStatusCode())
                .as("running a pass is a read of the whole platform's money, not a public button")
                .isEqualTo(HttpStatus.FORBIDDEN);
    }

    // ------------------------------------------------------------------
    // What it says
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a platform with nothing on its books reports balanced, and says it has run")
    void anEmptyPlatformBalances() {
        Map<String, Object> report = run();

        assertThat(report.get("balanced")).isEqualTo(true);
        assertThat(findings(report)).isEmpty();
        /*
         * The field that stops the screen lying. `balanced: true, findings: []` is also
         * what a reconciliation that never ran would look like, and a check that silently
         * stopped running is indistinguishable from a platform whose books are fine.
         */
        assertThat(report.get("hasRun")).isEqualTo(true);
        assertThat(report.get("runAt")).isNotNull();
    }

    /**
     * Check three, end to end: a charge the ledger knows nothing about.
     *
     * <p>The only one of {@link az.ideanest.payment.application.LedgerReconciliation}'s
     * three questions that can catch a posting the application simply never made — the
     * first two are satisfied by an empty ledger, which is perfectly balanced and perfectly
     * wrong.
     */
    @Test
    @DisplayName("a settled charge with no posting behind it comes back as a disagreement")
    void aChargeWithNoPostingIsReported() {
        chargeWithoutAPosting("250.00");

        Map<String, Object> report = run();

        assertThat(report.get("balanced")).isEqualTo(false);
        assertThat(findings(report))
                .singleElement()
                .satisfies(finding -> {
                    assertThat(finding.get("kind")).isEqualTo("DISAGREES_WITH_PAYMENTS");
                    assertThat(finding.get("currency")).isEqualTo("AZN");
                    // The figures, not a code to look up: this is what the person woken by
                    // the alert reads first.
                    assertThat(String.valueOf(finding.get("detail"))).contains("250.00");
                });
    }

    @Test
    @DisplayName("the read reports what the last run found, rather than running one of its own")
    void theReadReportsTheLastRun() {
        chargeWithoutAPosting("40.00");
        Map<String, Object> ran = run();

        Map<String, Object> read = get("/v1/admin/reconciliation", staffToken()).getBody();

        assertThat(read).isNotNull();
        assertThat(read.get("runAt")).isEqualTo(ran.get("runAt"));
        assertThat(findings(read)).hasSameSizeAs(findings(ran));
    }

    // ------------------------------------------------------------------
    // The record
    // ------------------------------------------------------------------

    /**
     * Running a pass is audited; reading the held report is not.
     *
     * <p>The split is deliberate and is argued in {@code ReconciliationService}: the read is
     * a count and a timestamp with nobody's name in it, while asking for a pass is what
     * somebody does when they suspect the books are wrong — and "who last checked, and
     * when" is the question asked afterwards.
     */
    @Test
    @DisplayName("running a pass is recorded; reading the last one is not")
    void runningOneIsAudited() {
        UUID staffId = staffId();
        int before = auditRows(staffId).size();

        run();
        List<AuditEntry> afterRunning = auditRows(staffId);
        assertThat(afterRunning).hasSize(before + 1);
        assertThat(afterRunning.getFirst().getDetail())
                .as("the outcome, and never a finding: audit_logs has no retention rule and a "
                        + "finding carries figures")
                .contains("findings=0")
                .contains("accountsChecked=");

        get("/v1/admin/reconciliation", staffToken());
        assertThat(auditRows(staffId)).hasSameSizeAs(afterRunning);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /**
     * A charge the platform believes settled, with nothing posted against it.
     *
     * <p>Written as SQL rather than driven through a collection run, because what is under
     * test is the comparison and not the collection — {@code CollectionTests} owns that
     * path. It is also the only way to produce this state at all: {@code CollectionRun}
     * records and posts in one commit, so the application cannot make the row this test
     * needs.
     */
    private void chargeWithoutAPosting(String amount) {
        String handle = "recon-" + SEQUENCE.incrementAndGet();
        UUID creatorId = Campaigns.creator(dataSource, handle);
        UUID projectId = Campaigns.seed(dataSource, creatorId, handle + "-campaign")
                .state("COLLECTING")
                .goal("100.00")
                .insert();
        UUID pledgeId = Pledges.confirmed(dataSource, projectId, handle + "-backer", amount);

        UUID id = UUID.randomUUID();
        jdbc().update(
                        """
                        INSERT INTO transactions (id, pledge_id, project_id, type, status, amount, currency,
                                                  provider, provider_transaction_id, attempt_number, idempotency_key)
                        VALUES (?, ?, ?, 'CHARGE', 'SUCCEEDED', CAST(? AS numeric), 'AZN', 'AZERICARD', ?, 1, ?)
                        """,
                        id,
                        pledgeId,
                        projectId,
                        amount,
                        "recon-" + id,
                        "recon-test-" + id);
    }

    /** Runs a pass and returns the report, failing loudly if the call was refused. */
    private Map<String, Object> run() {
        ResponseEntity<Map<String, Object>> response = runAs(staffToken());
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
        return response.getBody();
    }

    private ResponseEntity<Map<String, Object>> runAs(String accessToken) {
        return rest.exchange(
                "/v1/admin/reconciliation/runs",
                HttpMethod.POST,
                new HttpEntity<>(null, bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    /** The same, as a string body, for the refusals — a problem detail is not a report. */
    private ResponseEntity<String> runAsRaw(String accessToken) {
        return rest.exchange(
                "/v1/admin/reconciliation/runs",
                HttpMethod.POST,
                new HttpEntity<>(null, bearer(accessToken)),
                String.class);
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        return rest.exchange(
                path,
                HttpMethod.GET,
                new HttpEntity<>(null, bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> findings(Map<String, Object> report) {
        return (List<Map<String, Object>>) report.get("findings");
    }

    private List<AuditEntry> auditRows(UUID staffId) {
        return auditEntries.findByActorIdOrderByOccurredAtDesc(staffId).stream()
                .filter(entry -> entry.getAction().equals(AuditAction.LEDGER_RECONCILED.action()))
                .toList();
    }

    private UUID staffId() {
        return register(STAFF_EMAIL.substring(0, STAFF_EMAIL.indexOf('@')), STAFF_EMAIL);
    }

    private String staffToken() {
        return tokenFor(staffId());
    }

    /**
     * An account, minted once and found thereafter.
     *
     * <p>Not cached in a static field, unlike {@code ConsoleReadApiTests}: the suites share
     * one context and one database, and a cached identifier survives another suite deleting
     * the row. Looking it up costs one indexed read per call.
     */
    private UUID register(String handle) {
        return register(handle, handle + "@ideanest.test");
    }

    private UUID register(String handle, String email) {
        EmailAddress address = EmailAddress.of(email);
        if (users.findByEmailAndDeletedAtIsNull(address).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", address.value(), "password", PASSWORD, "name", "Test " + handle),
                    String.class);
        }
        return users.findByEmailAndDeletedAtIsNull(address).orElseThrow().getId();
    }

    private String tokenFor(UUID accountId) {
        return tokens.issue(
                        accountId,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();
    }

    private static HttpHeaders bearer(String accessToken) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(accessToken);
        return headers;
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
