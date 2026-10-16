package az.ideanest.ticket;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
import java.util.ArrayList;
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
 * AD-10's queue and the three things staff do to a ticket in it — #310, over HTTP.
 *
 * <p>The queue's whole promise is its order: "work this from the front". It sorted by the
 * priority column descending, believing that compared the enum's ordinal, and the column is
 * {@code text} — so the queue read URGENT, NORMAL, LOW, HIGH and a high-priority ticket sat
 * behind every low one. {@link #theQueueIsMostUrgentFirst()} is that defect.
 *
 * <p>Tickets are not deleted wholesale between tests, because other suites raise them too; each
 * test looks only at the ones it raised, and removes them afterwards.
 */
class SupportTicketQueueApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** The single address {@code application-test.yml} lists as platform staff. */
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";

    private static final ParameterizedTypeReference<Map<String, Object>> OBJECT =
            new ParameterizedTypeReference<Map<String, Object>>() {};

    private static Account staff;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    private final List<String> raised = new ArrayList<>();

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        for (String id : raised) {
            jdbc.update("DELETE FROM support_tickets WHERE id = ?::uuid", id);
        }
        raised.clear();
    }

    @Test
    @DisplayName("the queue is most urgent first, and oldest first within a priority")
    void theQueueIsMostUrgentFirst() {
        Account requester = account("queue-order");

        // Raised in an order that matches neither the priority nor the alphabet.
        String low = raise(requester, "LOW");
        String high = raise(requester, "HIGH");
        String normal = raise(requester, "NORMAL");
        String urgent = raise(requester, "URGENT");
        String secondHigh = raise(requester, "HIGH");

        assertThat(oursIn(get("/v1/admin/tickets/queue?page=0")))
                .containsExactly(urgent, high, secondHigh, normal, low);
    }

    @Test
    @DisplayName("a resolved ticket leaves the queue and the list still finds it")
    void aResolvedTicketLeavesTheQueue() {
        Account requester = account("queue-resolved");
        String ticket = raise(requester, "HIGH");

        ResponseEntity<Map<String, Object>> moved = patch(ticket, Map.of("state", "RESOLVED"));
        assertThat(moved.getStatusCode()).as(String.valueOf(moved.getBody())).isEqualTo(HttpStatus.OK);
        assertThat(moved.getBody()).containsEntry("state", "RESOLVED");

        assertThat(oursIn(get("/v1/admin/tickets/queue?page=0"))).doesNotContain(ticket);
        assertThat(oursIn(get("/v1/admin/tickets?state=RESOLVED&page=0"))).contains(ticket);
    }

    @Test
    @DisplayName("staff pick a ticket up, the assignee filter finds it, and putting it back empties it")
    void pickingATicketUpAndPuttingItBack() {
        Account requester = account("queue-assign");
        String ticket = raise(requester, "NORMAL");
        UUID me = staff().id();

        ResponseEntity<Map<String, Object>> taken = patch(ticket, Map.of("assigneeId", me.toString()));
        assertThat(taken.getStatusCode()).as(String.valueOf(taken.getBody())).isEqualTo(HttpStatus.OK);
        assertThat(taken.getBody()).containsEntry("assigneeId", me.toString());
        assertThat(oursIn(get("/v1/admin/tickets?assigneeId=" + me + "&page=0"))).contains(ticket);
        assertThat(oursIn(get("/v1/admin/tickets?unassigned=true&page=0"))).doesNotContain(ticket);

        ResponseEntity<Map<String, Object>> back = patch(ticket, Map.of("unassign", true));
        assertThat(back.getBody().get("assigneeId")).isNull();
        assertThat(oursIn(get("/v1/admin/tickets?unassigned=true&page=0"))).contains(ticket);
    }

    @Test
    @DisplayName("a reply moves an open ticket to waiting, and an internal note does not")
    void aReplyMovesTheTicketAndANoteDoesNot() {
        Account requester = account("queue-reply");
        String ticket = raise(requester, "NORMAL");

        ResponseEntity<Map<String, Object>> noted = reply(ticket, "Passing this to finance.", true);
        assertThat(ticketOf(noted)).containsEntry("state", "OPEN");

        ResponseEntity<Map<String, Object>> answered = reply(ticket, "We are looking into it.", false);
        assertThat(ticketOf(answered)).containsEntry("state", "PENDING");
        assertThat((List<?>) answered.getBody().get("messages")).hasSize(3);
    }

    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {}

    private String raise(Account requester, String priority) {
        ResponseEntity<Map<String, Object>> raised = rest.exchange(
                "/v1/admin/tickets",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of(
                                "requesterId", requester.id().toString(),
                                "subject", "Queue fixture " + priority,
                                "subjectType", "NONE",
                                "priority", priority,
                                "body", "Something went wrong."),
                        headers()),
                OBJECT);
        assertThat(raised.getStatusCode().is2xxSuccessful()).as(String.valueOf(raised.getBody())).isTrue();
        String id = String.valueOf(ticketOf(raised).get("id"));
        this.raised.add(id);
        return id;
    }

    /** The whole body, as the console sends it: the service binds every field. */
    private ResponseEntity<Map<String, Object>> patch(String ticket, Map<String, Object> update) {
        Map<String, Object> body = new HashMap<>();
        body.put("assigneeId", null);
        body.put("unassign", false);
        body.put("priority", null);
        body.put("state", null);
        body.putAll(update);
        return rest.exchange(
                "/v1/admin/tickets/" + ticket, HttpMethod.PATCH, new HttpEntity<>(body, headers()), OBJECT);
    }

    private ResponseEntity<Map<String, Object>> reply(String ticket, String body, boolean internal) {
        return rest.exchange(
                "/v1/admin/tickets/" + ticket + "/messages",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("body", body, "internal", internal), headers()),
                OBJECT);
    }

    private ResponseEntity<Map<String, Object>> get(String path) {
        ResponseEntity<Map<String, Object>> page =
                rest.exchange(path, HttpMethod.GET, new HttpEntity<>(headers()), OBJECT);
        assertThat(page.getStatusCode()).isEqualTo(HttpStatus.OK);
        return page;
    }

    /** The identifiers on a page, in its order, narrowed to the tickets this test raised. */
    @SuppressWarnings("unchecked")
    private List<String> oursIn(ResponseEntity<Map<String, Object>> page) {
        return ((List<Map<String, Object>>) page.getBody().get("tickets"))
                .stream()
                .map(ticket -> String.valueOf(ticket.get("id")))
                .filter(raised::contains)
                .toList();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> ticketOf(ResponseEntity<Map<String, Object>> file) {
        return (Map<String, Object>) file.getBody().get("ticket");
    }

    private Account account(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + "-" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Requester"),
                String.class);
        return tokenFor(users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId());
    }

    /** The configured staff address, an administrator by the bootstrap list. */
    private Account staff() {
        if (staff != null) {
            return staff;
        }
        EmailAddress email = EmailAddress.of(MODERATOR_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Moderator"),
                    String.class);
        }
        staff = tokenFor(users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId());
        return staff;
    }

    private Account tokenFor(UUID id) {
        String accessToken = tokens.issue(
                        id,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();
        return new Account(accessToken, id);
    }

    private HttpHeaders headers() {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(staff().accessToken());
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }
}
