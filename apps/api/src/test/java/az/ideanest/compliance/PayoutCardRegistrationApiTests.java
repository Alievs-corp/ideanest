package az.ideanest.compliance;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.outbox.OutboxRelay;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Destinations;
import az.ideanest.support.ScriptedWebhooks;
import java.time.Instant;
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
 * A creator registers the business card a payout goes to — IDN-EXT-01 (#44).
 *
 * <p>Against the scripted provider: the card page is one nothing resolves, and the provider's callback
 * is a scripted webhook. Accounts are written straight into {@code users} with minted tokens, because
 * nothing here is about signing in and registrations are limited per address for the whole run.
 */
@DisplayName("Registering a payout card")
class PayoutCardRegistrationApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private OutboxRelay relay;

    @Autowired
    private DataSource dataSource;

    @BeforeEach
    void onlyThisSuitesEvents() {
        jdbc().update("DELETE FROM outbox_events");
    }

    @AfterEach
    void clear() {
        jdbc().update("DELETE FROM outbox_events");
        jdbc().update("DELETE FROM provider_webhook_events");
        jdbc().update("DELETE FROM payout_card_registrations");
        Destinations.clear(dataSource);
        jdbc().update("DELETE FROM creator_legal_subjects");
    }

    @Test
    @DisplayName("begins on the provider's page, and records the card it names as pending")
    void beginsOnTheProvidersPage() {
        Account creator = account();

        ResponseEntity<Map<String, Object>> page = begin(creator);

        assertThat(page.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat((String) page.getBody().get("redirectUrl")).startsWith("https://pay.scripted.invalid/card/");
        assertThat(page.getBody().get("provider")).isEqualTo("PAYRIFF");
        assertThat(jdbc().queryForObject(
                        "SELECT state FROM payout_card_registrations WHERE creator_id = ?", String.class, creator.id()))
                .isEqualTo("PENDING");
        // Nothing is on file until the provider says the card registered.
        assertThat(mine(creator).get("recorded")).isEqualTo(false);
    }

    @Test
    @DisplayName("a card the provider registers becomes the payout destination, awaiting verification")
    void aRegisteredCardIsFiled() {
        Account creator = account();
        begin(creator);

        assertThat(deliver("payout_card_registered", cardOf(creator), "416973******1234", "Aygün Məmmədova"))
                .isEqualTo(HttpStatus.OK);
        relay.run();

        Map<String, Object> mine = mine(creator);
        assertThat(mine.get("recorded")).isEqualTo(true);
        assertThat(mine.get("standing")).isEqualTo("AWAITING_VERIFICATION");
        assertThat(mine.get("provider")).isEqualTo("PAYRIFF");
        assertThat(mine.get("displayHint")).isEqualTo("**1234");
        assertThat(mine.get("holderName")).isEqualTo("Aygün Məmmədova");
        assertThat(mine.values()).doesNotContain(cardOf(creator));
        assertThat(jdbc().queryForObject(
                        "SELECT state FROM payout_card_registrations WHERE creator_id = ?", String.class, creator.id()))
                .isEqualTo("REGISTERED");
    }

    @Test
    @DisplayName("a card held in somebody else's name is filed as a mismatch for a person to look at")
    void aDifferentHolderIsAMismatch() {
        Account creator = account();
        recordLegalName(creator, "Aygün Məmmədova");
        begin(creator);

        deliver("payout_card_registered", cardOf(creator), "416973******1234", "Rəşad Əliyev");
        relay.run();

        assertThat(mine(creator).get("standing")).isEqualTo("NAME_MISMATCH");
    }

    @Test
    @DisplayName("a card the provider refuses files nothing")
    void aRefusedCardFilesNothing() {
        Account creator = account();
        begin(creator);

        deliver("payout_card_failed", cardOf(creator), null, null);
        relay.run();

        assertThat(mine(creator).get("recorded")).isEqualTo(false);
        assertThat(jdbc().queryForObject(
                        "SELECT state FROM payout_card_registrations WHERE creator_id = ?", String.class, creator.id()))
                .isEqualTo("FAILED");
    }

    @Test
    @DisplayName("a callback about a card nobody began moves nothing, and a second one about a settled card neither")
    void strayCallbacksMoveNothing() {
        Account creator = account();
        begin(creator);

        assertThat(deliver("payout_card_registered", "scripted-card-never-begun", "416973******9999", "Somebody"))
                .isEqualTo(HttpStatus.OK);
        relay.run();
        assertThat(mine(creator).get("recorded")).isEqualTo(false);

        deliver("payout_card_failed", cardOf(creator), null, null);
        deliver("payout_card_registered", cardOf(creator), "416973******1234", "Aygün Məmmədova");
        relay.run();
        assertThat(mine(creator).get("recorded")).isEqualTo(false);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private Account account() {
        UUID id = Campaigns.creator(dataSource, "payout-card-" + SEQUENCE.incrementAndGet());
        String token = tokens.issue(
                        id, UUID.randomUUID(), new AccessTokenIssuer.AccountStanding(true, false), false, Instant.now())
                .value();
        return new Account(token, id);
    }

    private ResponseEntity<Map<String, Object>> begin(Account creator) {
        return exchange(
                "/v1/me/payout-destination/card-registration",
                HttpMethod.POST,
                creator,
                Map.of(
                        "language", "az",
                        "successUrl", "https://ideanest.az/az/settings/payout?card=registered",
                        "errorUrl", "https://ideanest.az/az/settings/payout?card=failed"));
    }

    private Map<String, Object> mine(Account creator) {
        return exchange("/v1/me/payout-destination", HttpMethod.GET, creator, null).getBody();
    }

    private void recordLegalName(Account creator, String legalName) {
        assertThat(exchange(
                                "/v1/me/legal-subject",
                                HttpMethod.PUT,
                                creator,
                                Map.of("subjectKind", "INDIVIDUAL", "legalName", legalName))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    private String cardOf(Account creator) {
        return jdbc().queryForObject(
                "SELECT card_id FROM payout_card_registrations WHERE creator_id = ? ORDER BY started_at DESC LIMIT 1",
                String.class,
                creator.id());
    }

    private HttpStatus deliver(String type, String cardId, String mask, String holder) {
        StringBuilder body = new StringBuilder()
                .append("{\"id\":\"evt-").append(UUID.randomUUID())
                .append("\",\"type\":\"").append(type)
                .append("\",\"cardId\":\"").append(cardId).append('"');
        if (mask != null) {
            body.append(",\"cardMask\":\"").append(mask).append('"');
        }
        if (holder != null) {
            body.append(",\"holderName\":\"").append(holder).append('"');
        }
        body.append('}');
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ScriptedWebhooks.headers().forEach(headers::add);
        return HttpStatus.valueOf(rest.exchange(
                        "/v1/webhooks/psp/payriff",
                        HttpMethod.POST,
                        new HttpEntity<>(body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8), headers),
                        String.class)
                .getStatusCode()
                .value());
    }

    private ResponseEntity<Map<String, Object>> exchange(String path, HttpMethod method, Account account, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(account.accessToken());
        headers.setContentType(MediaType.APPLICATION_JSON);
        return rest.exchange(path, method, new HttpEntity<>(body, headers), new ParameterizedTypeReference<>() {});
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
