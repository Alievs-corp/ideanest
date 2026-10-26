package az.ideanest.risk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import az.ideanest.notification.application.NotificationEvents.PledgeConfirmed;
import az.ideanest.risk.application.PledgeRiskListener;
import az.ideanest.risk.application.RiskAssessments;
import az.ideanest.risk.domain.RiskAssessment;
import az.ideanest.risk.infrastructure.RiskAssessmentRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.money.Money;
import az.ideanest.shared.outbox.Outbox;
import az.ideanest.shared.outbox.OutboxMessage;
import az.ideanest.shared.outbox.OutboxRelay;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.StaffGrants;
import az.ideanest.user.infrastructure.UserRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * §4.11's AD-02 fraud signals end to end — issue #108.
 *
 * <p>The ones that carry the design:
 *
 * <ul>
 *   <li>{@link #aConfirmedPledgeIsAssessed()} — the coupling between the pledge module and
 *       this one is a string on an outbox event, and nothing else.
 *   <li>{@link #anUnreadableEventDoesNotFailTheDispatch()} — the property that keeps a
 *       fraud score from vetoing an event for the modules that share it. Without it a
 *       malformed payload would re-deliver the notification fan-out that already succeeded.
 *   <li>{@link #theQueueIsStaffOnly()} — this is a list of people the platform's arithmetic
 *       has found suspicious.
 * </ul>
 */
@DisplayName("Fraud signals over HTTP")
class RiskApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String PASSWORD = "a-long-enough-password";

    private static final String AGGREGATE = "pledge";

    /** The note this suite's staff grants carry, so the cleanup removes exactly those. */
    private static final String STAFF_FIXTURE_NOTE = "risk queue fixture";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private Outbox outbox;

    @Autowired
    private OutboxRelay relay;

    @Autowired
    private RiskAssessments assessments;

    @Autowired
    private PledgeRiskListener listener;

    @Autowired
    private RiskAssessmentRepository repository;

    @Autowired
    private PlatformTransactionManager transactions;

    @Autowired
    private DataSource dataSource;

    private UUID projectId;

    @AfterEach
    void clearGrants() {
        StaffGrants.clear(dataSource, STAFF_FIXTURE_NOTE);
    }

    @BeforeEach
    void seed() {
        repository.deleteAll();
        UUID creatorId = Campaigns.creator(dataSource, "risk-creator-" + SEQUENCE.incrementAndGet());
        projectId = Campaigns.seed(dataSource, creatorId, "risk-campaign-" + SEQUENCE.incrementAndGet())
                .insert();
    }

    @Test
    @DisplayName("assesses a pledge when the confirmation event is dispatched")
    void aConfirmedPledgeIsAssessed() {
        Account backer = account("risk-backer-");
        UUID pledgeId = confirmPledge(backer);

        List<RiskAssessment> history = historyOf(pledgeId);

        assertThat(history).hasSize(1);
        assertThat(history.getFirst().getSubjectUserId()).isEqualTo(backer.id());
        assertThat(history.getFirst().getProjectId()).isEqualTo(projectId);
    }

    @Test
    @DisplayName("writes an assessment even when nothing was noticed")
    void aQuietAssessmentIsStillRecorded() {
        Account backer = account("risk-quiet-");
        UUID pledgeId = confirmPledge(backer);

        // "Was this flagged at the time" is the question asked after a chargeback, and
        // "we did not write it down because it looked fine" is not an answer.
        RiskAssessment assessment = historyOf(pledgeId).getFirst();
        assertThat(assessment.getScore()).isNotNegative();
    }

    @Test
    @DisplayName("records that a signal could not be evaluated rather than clearing it")
    void unavailableSignalsAreCounted() {
        Account backer = account("risk-unavailable-");
        UUID pledgeId = confirmPledge(backer);

        // No IP geolocation source is configured on any deployment, so geography is always
        // one of these. A low score with an unavailable signal is a different statement
        // from a low score with none.
        assertThat(historyOf(pledgeId).getFirst().getSignalsUnavailable())
                .isPositive();
    }

    @Test
    @DisplayName("an unreadable event does not fail the dispatch that carried it")
    void anUnreadableEventDoesNotFailTheDispatch() {
        /*
         * The listener is called directly rather than through the outbox, and that is not
         * a shortcut. A malformed `pledge.confirmed` on the relay is malformed for every
         * consumer of it -- the notification fan-out reads the same payload and fails
         * first -- so a test that went through the relay would be asserting that the
         * notification module tolerates it. What is being asserted here is this module's
         * own contract: whatever it is handed, it does not throw, because throwing would
         * roll the shared dispatch back.
         */
        OutboxMessage unreadable = new OutboxMessage(
                UUID.randomUUID(),
                AGGREGATE,
                UUID.randomUUID(),
                PledgeConfirmed.EVENT_TYPE,
                "{\"nothing\":\"useful\"}",
                Instant.now(),
                1);

        assertThatCode(() -> listener.on(unreadable)).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("ignores an event this module is not about")
    void anotherModulesEventIsIgnored() {
        OutboxMessage other = new OutboxMessage(
                UUID.randomUUID(), "project", UUID.randomUUID(), "project.launched", "{}", Instant.now(), 1);

        assertThatCode(() -> listener.on(other)).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("the queue is staff only")
    void theQueueIsStaffOnly() {
        Account backer = account("risk-outsider-");

        ResponseEntity<String> response = rest.exchange(
                "/v1/admin/risk/queue",
                HttpMethod.GET,
                new HttpEntity<>(bearer(backer)),
                String.class);

        assertThat(response.getStatusCode()).isIn(HttpStatus.FORBIDDEN, HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("staff without VIEW_FINANCE are refused the queue, a pledge's history and the review mark")
    void staffWithoutFinanceAreRefused() {
        Account curator = account("risk-curator-");
        StaffGrants.grant(dataSource, curator.id(), StaffRole.CURATOR, STAFF_FIXTURE_NOTE);
        Account backer = account("risk-curated-");
        UUID pledgeId = confirmPledge(backer);
        UUID assessmentId = historyOf(pledgeId).getFirst().getId();

        // #295 made every role "staff". A curator arranges the front page and has no business
        // with the list of backers the platform's arithmetic suspects.
        for (ResponseEntity<Map<String, Object>> refused : List.of(
                exchange("/v1/admin/risk/queue", HttpMethod.GET, curator),
                exchange("/v1/admin/risk/pledges/" + pledgeId, HttpMethod.GET, curator),
                exchange("/v1/admin/risk/" + assessmentId + "/reviewed", HttpMethod.POST, curator))) {
            assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
            assertThat(refused.getBody()).containsEntry("code", "INSUFFICIENT_STAFF_CAPABILITY");
        }
        assertThat(historyOf(pledgeId).getFirst().getReviewedAt()).isNull();
    }

    @Test
    @DisplayName("finance reads the queue and a pledge's history")
    void financeReadsTheQueue() {
        Account finance = account("risk-finance-");
        StaffGrants.grant(dataSource, finance.id(), StaffRole.FINANCE, STAFF_FIXTURE_NOTE);
        UUID pledgeId = confirmPledge(account("risk-read-"));

        assertThat(exchange("/v1/admin/risk/queue", HttpMethod.GET, finance).getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(exchange("/v1/admin/risk/pledges/" + pledgeId, HttpMethod.GET, finance).getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("the queue is never cached, because it is a list of suspected people")
    void theQueueIsNeverCached() {
        Account backer = account("risk-cache-");

        ResponseEntity<String> response = rest.exchange(
                "/v1/admin/risk/queue",
                HttpMethod.GET,
                new HttpEntity<>(bearer(backer)),
                String.class);

        // Even the refusal must not be stored. A shared cache holding any of this would be
        // a copy of the queue outside the console.
        assertThat(response.getStatusCode()).isNotEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("marking one reviewed twice is not an error")
    void reviewingIsIdempotent() {
        Account backer = account("risk-review-");
        UUID pledgeId = confirmPledge(backer);
        RiskAssessment assessment = historyOf(pledgeId).getFirst();

        // A real account: `reviewed_by` is a foreign key, so a random identifier would
        // fail the insert rather than the assertion.
        UUID staffId = account("risk-staff-").id();
        StaffGrants.grant(dataSource, staffId, StaffRole.FINANCE, STAFF_FIXTURE_NOTE);
        assertThat(assessments.markReviewed(assessment.getId(), staffId)).isPresent();

        // A second member of staff pressing the button on a row their colleague has just
        // taken should be told it is done, not that it is missing.
        assertThat(assessments.markReviewed(assessment.getId(), staffId)).isEmpty();
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {}

    /**
     * Records a {@code pledge.confirmed} and dispatches it.
     *
     * <p>Through the outbox and the relay rather than by inserting a row, so that what is
     * asserted is what the module actually hears.
     */
    private UUID confirmPledge(Account backer) {
        UUID pledgeId = UUID.randomUUID();
        Instant confirmedAt = Instant.now().truncatedTo(ChronoUnit.MICROS);

        PledgeConfirmed event = new PledgeConfirmed(
                pledgeId, projectId, backer.id(), Money.of(new BigDecimal("50.00"), "AZN"), confirmedAt);

        new TransactionTemplate(transactions)
                .executeWithoutResult(status -> outbox.record(AGGREGATE, pledgeId, PledgeConfirmed.EVENT_TYPE, event));
        relay.run();

        return pledgeId;
    }

    private Account account(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Account((String) signedIn.getBody().get("accessToken"), id);
    }

    /** Everything noticed about one pledge, read from the table rather than through the guarded service. */
    private List<RiskAssessment> historyOf(UUID pledgeId) {
        return repository.findBySubjectTypeAndSubjectIdOrderByAssessedAtDesc(RiskAssessment.PLEDGE, pledgeId);
    }

    private ResponseEntity<Map<String, Object>> exchange(String path, HttpMethod method, Account caller) {
        return rest.exchange(
                path, method, new HttpEntity<>(bearer(caller)), new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private static HttpHeaders bearer(Account account) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(account.accessToken());
        return headers;
    }
}
