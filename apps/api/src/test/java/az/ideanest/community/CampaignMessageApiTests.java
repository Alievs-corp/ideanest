package az.ideanest.community;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditEntry;
import az.ideanest.audit.AuditEntryRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.outbox.OutboxRelay;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.user.infrastructure.UserRepository;
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
 * §4.7's CD-13 (#98): a creator messaging their backers, or a saved segment of them.
 *
 * <p>The tests that carry the design:
 *
 * <ul>
 *   <li>{@link #aMessageToEveryBackerReachesEveryBacker()} and
 *       {@link #aMessageToASegmentReachesOnlyThatSegment()} — the feature, end to end through the
 *       real path: the row, the outbox event, the relay, the fan-out.
 *   <li>{@link #theSegmentNameIsFrozenAtSendTime()} — the snapshot. A segment renamed afterwards
 *       must not rewrite the record of what was sent.
 *   <li>{@link #messagingASegmentIsAudited()} — the audit trail #98 asks for, and the rule that
 *       it records the act and never the content.
 *   <li>{@link #theRateLimitIsPerCampaignAndNotPerAccount()} — the budget belongs to the
 *       campaign, because the harm is to its backers; two collaborators must not get two
 *       allowances for reaching the same people.
 * </ul>
 */
class CampaignMessageApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** §4.10 gives {@code DIRECT_MESSAGE} email, push and in-app. */
    private static final int DIRECT_MESSAGE_CHANNELS = 3;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private OutboxRelay relay;

    @Autowired
    private AuditEntryRepository auditEntries;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM notifications");
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update("DELETE FROM campaign_messages");
        jdbc.update("DELETE FROM backer_segments");
        jdbc.update("DELETE FROM pledges");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    // ------------------------------------------------------------------
    // The feature
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a message with no segment reaches every backer of the campaign")
    void aMessageToEveryBackerReachesEveryBacker() {
        Account creator = account("msg-creator");
        UUID project = liveCampaign(creator);
        UUID first = backer(project, "COLLECTED", "DE");
        UUID second = backer(project, "COLLECTED", "AZ");

        ResponseEntity<Map<String, Object>> sent = send(project, creator, null, "We shipped", "Thank you all.");

        assertThat(sent.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(sent.getBody()).containsEntry("recipientCount", 2).containsEntry("truncated", false);
        assertThat(sent.getBody().get("segmentId")).as("no segment means everybody").isNull();

        relay.run();
        assertThat(recipients()).containsExactlyInAnyOrder(first, second);
        assertThat(notificationCount())
                .as("two recipients, and §4.10 gives a direct message three channels")
                .isEqualTo(2 * DIRECT_MESSAGE_CHANNELS);
    }

    @Test
    @DisplayName("a message to a segment reaches only the backers that segment matches")
    void aMessageToASegmentReachesOnlyThatSegment() {
        Account creator = account("seg-creator");
        UUID project = liveCampaign(creator);
        UUID german = backer(project, "COLLECTED", "DE");
        UUID local = backer(project, "COLLECTED", "AZ");
        UUID segment = segment(project, creator, "Germany", "DE");

        ResponseEntity<Map<String, Object>> sent =
                send(project, creator, segment, "A note for Germany", "Customs is slow.");

        assertThat(sent.getBody()).containsEntry("recipientCount", 1).containsEntry("segmentName", "Germany");

        relay.run();
        assertThat(recipients()).containsExactly(german);
        assertThat(recipients()).doesNotContain(local);
    }

    @Test
    @DisplayName("the message names itself as the notification's subject, so an inbox can link back to it")
    void theNotificationSubjectIsTheMessage() {
        Account creator = account("subject-creator");
        UUID project = liveCampaign(creator);
        backer(project, "COLLECTED", "AZ");

        UUID messageId = UUID.fromString(
                (String) send(project, creator, null, "Hello", "A short note.").getBody().get("id"));
        relay.run();

        assertThat(subjectTypes()).containsExactly("message");
        assertThat(subjectIds()).containsExactly(messageId);
    }

    @Test
    @DisplayName("the creator is not sent their own message")
    void theSenderIsNotARecipient() {
        Account creator = account("self-creator");
        UUID project = liveCampaign(creator);
        UUID backer = backer(project, "COLLECTED", "AZ");

        send(project, creator, null, "Hello", "A short note.");
        relay.run();

        assertThat(recipients()).containsExactly(backer);
        assertThat(recipients()).doesNotContain(creator.id());
    }

    @Test
    @DisplayName("a campaign with no backers sends a message that reaches nobody, which is not an error")
    void aMessageWithNoAudienceIsStillRecorded() {
        Account creator = account("empty-creator");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> sent = send(project, creator, null, "Anyone there", "Hello?");

        assertThat(sent.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(sent.getBody()).containsEntry("recipientCount", 0);
        assertThat(messageCount(project)).as("the act is recorded even though nobody was reached").isEqualTo(1);
    }

    // ------------------------------------------------------------------
    // The snapshot
    // ------------------------------------------------------------------

    /**
     * The segment name is frozen when the message goes.
     *
     * <p>{@code V34} argues it: a segment's definition and its name are both editable, so a live
     * join would report this message as having gone to a set — and under a name — it did not go
     * to.
     */
    @Test
    @DisplayName("the segment name is frozen at send time and a later rename does not rewrite it")
    void theSegmentNameIsFrozenAtSendTime() {
        Account creator = account("frozen-creator");
        UUID project = liveCampaign(creator);
        backer(project, "COLLECTED", "DE");
        UUID segment = segment(project, creator, "Germany", "DE");

        send(project, creator, segment, "A note", "Body.");
        new JdbcTemplate(dataSource).update("UPDATE backer_segments SET name = ? WHERE id = ?", "Renamed", segment);

        List<Map<String, Object>> items = items(list(project, creator).getBody());
        assertThat(items).singleElement().satisfies(message -> {
            assertThat(message).containsEntry("segmentName", "Germany");
            assertThat(message).containsEntry("segmentId", segment.toString());
        });
    }

    /** The record survives the segment it names, which is why there is no foreign key. */
    @Test
    @DisplayName("deleting the segment does not delete the record of the message sent to it")
    void deletingASegmentLeavesTheMessage() {
        Account creator = account("deleted-creator");
        UUID project = liveCampaign(creator);
        backer(project, "COLLECTED", "DE");
        UUID segment = segment(project, creator, "Germany", "DE");

        send(project, creator, segment, "A note", "Body.");
        new JdbcTemplate(dataSource).update("DELETE FROM backer_segments WHERE id = ?", segment);

        assertThat(items(list(project, creator).getBody()))
                .singleElement()
                .satisfies(message -> assertThat(message).containsEntry("segmentName", "Germany"));
    }

    // ------------------------------------------------------------------
    // The audit trail
    // ------------------------------------------------------------------

    @Test
    @DisplayName("messaging a segment is audited, with the act and never the content")
    void messagingASegmentIsAudited() {
        Account creator = account("audit-creator");
        UUID project = liveCampaign(creator);
        backer(project, "COLLECTED", "DE");
        UUID segment = segment(project, creator, "Germany", "DE");

        send(project, creator, segment, "A confidential subject", "A confidential body.");

        List<AuditEntry> entries = auditEntries.findAll().stream()
                .filter(entry -> AuditAction.PROJECT_SEGMENT_MESSAGED.action().equals(entry.getAction()))
                .filter(entry -> project.equals(entry.getEntityId()))
                .toList();

        assertThat(entries).singleElement().satisfies(entry -> {
            assertThat(entry.getDetail()).contains("recipients=1").contains("Germany");
            assertThat(entry.getDetail())
                    .as("audit_logs has no retention rule and refuses DELETE; creator prose does not go in it")
                    .doesNotContain("A confidential subject")
                    .doesNotContain("A confidential body.");
        });
    }

    // ------------------------------------------------------------------
    // Refusals
    // ------------------------------------------------------------------

    @Test
    @DisplayName("somebody with no part in the campaign cannot message its backers")
    void aStrangerCannotMessage() {
        Account creator = account("guard-creator");
        Account stranger = account("guard-stranger");
        UUID project = liveCampaign(creator);

        assertThat(send(project, stranger, null, "Hello", "Body.").getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(messageCount(project)).isZero();
    }

    @Test
    @DisplayName("a segment that does not exist on this campaign is not found, and nothing is sent")
    void anUnknownSegmentIsNotFound() {
        Account creator = account("nosegment-creator");
        UUID project = liveCampaign(creator);
        backer(project, "COLLECTED", "AZ");

        ResponseEntity<Map<String, Object>> refused =
                send(project, creator, UUID.randomUUID(), "Hello", "Body.");

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(refused.getBody()).containsEntry("code", "BACKER_SEGMENT_NOT_FOUND");
        assertThat(messageCount(project)).as("refused before anything is written").isZero();
    }

    @Test
    @DisplayName("a body longer than the bound is refused with the bound")
    void anOverlongBodyIsRefused() {
        Account creator = account("long-creator");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> refused =
                send(project, creator, null, "Hello", "x".repeat(2_001));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(messageCount(project)).isZero();
    }

    @Test
    @DisplayName("an empty subject is refused")
    void anEmptySubjectIsRefused() {
        Account creator = account("blank-creator");
        UUID project = liveCampaign(creator);

        assertThat(send(project, creator, null, "   ", "Body.").getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(messageCount(project)).isZero();
    }

    /**
     * The budget belongs to the campaign.
     *
     * <p>{@code CommunityProperties.Messages} argues it: the harm is to the campaign's backers,
     * so a campaign with several collaborators must not get several allowances for reaching the
     * same people. Driven with the creator alone, because what the assertion needs is that the
     * key is the campaign — a second account on the same campaign is refused by the same counter.
     */
    @Test
    @DisplayName("the rate limit is per campaign and not per account")
    void theRateLimitIsPerCampaignAndNotPerAccount() {
        Account creator = account("limit-creator");
        UUID project = liveCampaign(creator);

        HttpStatus lastStatus = null;
        for (int attempt = 0; attempt < 12; attempt++) {
            lastStatus = (HttpStatus) send(project, creator, null, "Hello " + attempt, "Body.").getStatusCode();
            if (lastStatus == HttpStatus.TOO_MANY_REQUESTS) {
                break;
            }
        }

        assertThat(lastStatus).as("the campaign's budget runs out").isEqualTo(HttpStatus.TOO_MANY_REQUESTS);

        // A different campaign is a different budget, which is what proves the key is the
        // campaign rather than a global counter.
        UUID other = liveCampaign(creator);
        assertThat(send(other, creator, null, "Hello", "Body.").getStatusCode())
                .isEqualTo(HttpStatus.CREATED);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
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
                Map.of("title", "A campaign that writes to people " + SEQUENCE.incrementAndGet()));
        UUID project = UUID.fromString((String) created.getBody().get("id"));
        Campaigns.launch(dataSource, project);
        return project;
    }

    /** A new account with a live commitment to this campaign, shipping to that country. */
    private UUID backer(UUID project, String state, String country) {
        UUID backerId = Campaigns.creator(dataSource, "cm-b" + SEQUENCE.incrementAndGet());
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO pledges (id, project_id, backer_id, state, base_amount, shipping_country)
                        VALUES (?, ?, ?, ?, 25.00, ?)
                        """,
                        Identifiers.newIdentifier(),
                        project,
                        backerId,
                        state,
                        country);
        return backerId;
    }

    /** A saved segment on this campaign, filtered to one destination. */
    private UUID segment(UUID project, Account creator, String name, String country) {
        ResponseEntity<Map<String, Object>> saved = exchange(
                "/v1/projects/" + project + "/backer-segments",
                HttpMethod.POST,
                creator.accessToken(),
                Map.of("name", name, "filter", Map.of("countries", List.of(country))));
        return UUID.fromString((String) saved.getBody().get("id"));
    }

    private ResponseEntity<Map<String, Object>> send(
            UUID project, Account caller, UUID segmentId, String subject, String body) {

        Map<String, Object> request = new HashMap<>();
        request.put("subject", subject);
        request.put("body", body);
        if (segmentId != null) {
            request.put("segmentId", segmentId.toString());
        }
        return exchange("/v1/projects/" + project + "/messages", HttpMethod.POST, caller.accessToken(), request);
    }

    private ResponseEntity<Map<String, Object>> list(UUID project, Account caller) {
        return exchange("/v1/projects/" + project + "/messages", HttpMethod.GET, caller.accessToken(), null);
    }

    private ResponseEntity<Map<String, Object>> exchange(String path, HttpMethod method, String token, Object body) {
        return rest.exchange(
                path,
                method,
                new HttpEntity<>(body, token == null ? jsonHeaders() : bearer(token)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> items(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("items");
    }

    private List<UUID> recipients() {
        return new JdbcTemplate(dataSource)
                .queryForList(
                        "SELECT DISTINCT recipient_id FROM notifications WHERE type = 'DIRECT_MESSAGE'", UUID.class);
    }

    private long notificationCount() {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT count(*) FROM notifications WHERE type = 'DIRECT_MESSAGE'", Long.class);
    }

    private List<String> subjectTypes() {
        return new JdbcTemplate(dataSource)
                .queryForList(
                        "SELECT DISTINCT subject_type FROM notifications WHERE type = 'DIRECT_MESSAGE'", String.class);
    }

    private List<UUID> subjectIds() {
        return new JdbcTemplate(dataSource)
                .queryForList(
                        "SELECT DISTINCT subject_id FROM notifications WHERE type = 'DIRECT_MESSAGE'", UUID.class);
    }

    private long messageCount(UUID project) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT count(*) FROM campaign_messages WHERE project_id = ?", Long.class, project);
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
