package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.payment.domain.PaymentEventType;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.AdjustableClock;
import az.ideanest.support.ScriptedWebhooks;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * §9.3's R-07 and §17.2 at the endpoint (#66): verify, refuse a replay, act once.
 *
 * <p>The three controls are asserted separately because they answer three different
 * attacks, and only one of them survives a restart:
 *
 * <ul>
 *   <li>{@link #anUnsignedDeliveryIsRefused()} and {@link #aForgedSignatureIsRefused()} —
 *       the body is not ours to trust.
 *   <li>{@link #aStaleDeliveryIsRefused()} and {@link #aDeliveryFromTheFutureIsRefused()} —
 *       a validly signed body replayed later.
 *   <li>{@link #aRedeliveryDoesNothingTwice()} — the same event acted on twice, which is
 *       the only one of the three a signature and a timestamp cannot prevent.
 * </ul>
 *
 * <p>Driven over HTTP rather than against {@code ProviderWebhooks} directly, because half
 * of what #66 is about lives at the edge: the endpoint is the only unauthenticated write
 * on the platform, the body has to reach the adapter as the bytes that were signed, and
 * the statuses are instructions to a provider's retry loop rather than descriptions.
 */
class ProviderWebhookApiTests extends AbstractIntegrationTest {

    private static final String ENDPOINT = "/v1/webhooks/psp/payriff";

    @Autowired
    private TestRestTemplate http;

    @Autowired
    private AdjustableClock clock;

    @Autowired
    private DataSource dataSource;

    @BeforeEach
    void aFixedClock() {
        // The replay window is five minutes wide, so a free-running clock would make the
        // stale and future tests depend on how long the suite before them took.
        clock.freeze();
        // Cleared before as well as after: this suite reads the table as its own, and another suite
        // that delivered webhooks may have run first.
        new JdbcTemplate(dataSource).update("DELETE FROM provider_webhook_events");
    }

    @AfterEach
    void releaseTheClock() {
        clock.reset();
        new JdbcTemplate(dataSource).update("DELETE FROM provider_webhook_events");
    }

    // ------------------------------------------------------------------
    // The signature
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a delivery with no signature is refused, and nothing is recorded")
    void anUnsignedDeliveryIsRefused() {
        ResponseEntity<String> response = post(body(PaymentEventType.CHARGE_SUCCEEDED), Map.of());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).contains("WEBHOOK_REJECTED");
        assertThat(deliveries()).isEmpty();
    }

    @Test
    @DisplayName("a delivery whose signature does not verify is refused")
    void aForgedSignatureIsRefused() {
        ResponseEntity<String> response =
                post(body(PaymentEventType.CHARGE_SUCCEEDED), ScriptedWebhooks.forgedHeaders());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(deliveries()).isEmpty();
    }

    /**
     * A 400 and not a 500, and the difference is what the provider does next.
     *
     * <p>A delivery whose signature does not verify will not verify on the fourth attempt
     * either, so a 5xx would spend a provider's retry budget on something that cannot
     * succeed.
     */
    @Test
    @DisplayName("a refused delivery is a 4xx, so the provider does not retry it")
    void aRefusedDeliveryIsNotRetryable() {
        assertThat(post(body(PaymentEventType.CHARGE_SUCCEEDED), ScriptedWebhooks.forgedHeaders())
                        .getStatusCode()
                        .is4xxClientError())
                .isTrue();
    }

    // ------------------------------------------------------------------
    // §17.2's timestamp check
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a validly signed delivery from outside the tolerance is refused as a replay")
    void aStaleDeliveryIsRefused() {
        // Six minutes old against a five-minute tolerance: the signature is perfectly
        // valid, which is the whole point -- a signature does not expire, so this window
        // is the only thing that does.
        String stale = ScriptedWebhooks.body(
                UUID.randomUUID().toString(),
                PaymentEventType.CHARGE_SUCCEEDED,
                clock.instant().minus(Duration.ofMinutes(6)));

        ResponseEntity<String> response = post(stale, ScriptedWebhooks.headers());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(deliveries()).isEmpty();
    }

    /**
     * The other direction, which is not symmetry for its own sake.
     *
     * <p>A delivery signed an hour in the future is a clock somewhere that cannot be
     * reasoned about, and accepting it would make the "too old" half meaningless — an
     * attacker with a forward-dated body would have an hour's window rather than five
     * minutes.
     */
    @Test
    @DisplayName("a delivery signed in the future is refused too")
    void aDeliveryFromTheFutureIsRefused() {
        String ahead = ScriptedWebhooks.body(
                UUID.randomUUID().toString(),
                PaymentEventType.CHARGE_SUCCEEDED,
                clock.instant().plus(Duration.ofHours(1)));

        assertThat(post(ahead, ScriptedWebhooks.headers()).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @DisplayName("a delivery inside the tolerance is accepted")
    void aDeliveryInsideTheToleranceIsAccepted() {
        String recent = ScriptedWebhooks.body(
                UUID.randomUUID().toString(),
                PaymentEventType.CHARGE_SUCCEEDED,
                clock.instant().minus(Duration.ofMinutes(4)));

        assertThat(post(recent, ScriptedWebhooks.headers()).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(deliveries()).hasSize(1);
    }

    // ------------------------------------------------------------------
    // Exactly once
    // ------------------------------------------------------------------

    /**
     * <strong>The only one of §17.2's three controls that survives a restart.</strong>
     *
     * <p>A genuine redelivery — a provider retrying something whose response it never
     * received — passes the signature check and the timestamp check, because both are
     * still valid. The unique index over {@code (provider, provider_event_id)} is what
     * makes it harmless.
     */
    @Test
    @DisplayName("a redelivery is answered 200 and does nothing a second time")
    void aRedeliveryDoesNothingTwice() {
        String delivery = body(PaymentEventType.CHARGEBACK_OPENED);

        assertThat(post(delivery, ScriptedWebhooks.headers()).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(post(delivery, ScriptedWebhooks.headers()).getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(deliveries())
                .as("one row, because the second delivery is the same event")
                .hasSize(1);
    }

    /**
     * An event nothing handles is recorded and answered 200.
     *
     * <p>Not an error: a provider emits every event type it has, most of which describe
     * products the platform does not use. Recording them is what makes "the provider says
     * it sent us the dispute notification" a question with an answer.
     *
     * <p>Every event is {@code IGNORED} today, because #66 is the ingestion and what an
     * event <em>means</em> belongs to #67, #68 and #69 — see {@code PaymentEventHandler}.
     */
    @Test
    @DisplayName("an event nothing handles is recorded as ignored, not refused")
    void anUnhandledEventIsRecordedAndIgnored() {
        // PAYOUT_PAID rather than CHARGE_SUCCEEDED since IDN-EXT-01 (#39), whose handler settles
        // a payment made on the provider's page and so handles every CHARGE_SUCCEEDED.
        assertThat(post(body(PaymentEventType.PAYOUT_PAID), ScriptedWebhooks.headers())
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        List<Map<String, Object>> recorded = deliveries();
        assertThat(recorded).hasSize(1);
        assertThat(recorded.getFirst().get("state")).isEqualTo("IGNORED");
        assertThat(recorded.getFirst().get("event_type")).isEqualTo(PaymentEventType.PAYOUT_PAID.name());
    }

    /**
     * The bytes that were signed are the bytes that are stored.
     *
     * <p>V43's reason for {@code text} rather than {@code jsonb}: in a dispute the payload
     * is evidence, and a re-serialised document is one whose signature no longer verifies.
     */
    @Test
    @DisplayName("the body is stored exactly as it arrived")
    void theBodyIsStoredVerbatim() {
        String delivery = body(PaymentEventType.REFUND_SUCCEEDED);

        post(delivery, ScriptedWebhooks.headers());

        assertThat(deliveries().getFirst().get("payload")).isEqualTo(delivery);
    }

    @Test
    @DisplayName("a provider's own type the platform does not recognise is ignored rather than refused")
    void anUnrecognisedTypeIsIgnored() {
        // The failure this prevents: an adapter that threw on an unknown type would turn a
        // provider's product announcement into a 500 and a retry storm.
        String delivery = """
                {"id":"%s","type":"loyalty_points_awarded","signedAt":"%s"}"""
                .formatted(UUID.randomUUID(), clock.instant());

        assertThat(post(delivery, ScriptedWebhooks.headers()).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(deliveries().getFirst().get("event_type")).isEqualTo(PaymentEventType.UNRECOGNISED.name());
    }

    // ------------------------------------------------------------------
    // The path
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a path segment that names no provider is a 404, before anything is read")
    void anUnknownProviderIsNotFound() {
        ResponseEntity<String> response = http.exchange(
                "/v1/webhooks/psp/stripe",
                HttpMethod.POST,
                new HttpEntity<>(body(PaymentEventType.CHARGE_SUCCEEDED).getBytes(), headers(ScriptedWebhooks.headers())),
                String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody()).contains("WEBHOOK_ENDPOINT_NOT_FOUND");
    }

    /**
     * A provider in §9.3's list with no adapter deployed answers exactly as one that does
     * not exist.
     *
     * <p>Deliberate: the endpoint publishes nothing about which providers the platform is
     * talking to.
     */
    @Test
    @DisplayName("a provider with no adapter answers the same 404 as one that does not exist")
    void anUnconfiguredProviderIsNotFound() {
        ResponseEntity<String> response = http.exchange(
                "/v1/webhooks/psp/epoint",
                HttpMethod.POST,
                new HttpEntity<>(body(PaymentEventType.CHARGE_SUCCEEDED).getBytes(), headers(ScriptedWebhooks.headers())),
                String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody()).contains("WEBHOOK_ENDPOINT_NOT_FOUND");
    }

    @Test
    @DisplayName("the endpoint needs no credentials; the signature is what authorises it")
    void theEndpointIsUnauthenticated() {
        // No bearer token anywhere in this suite. Asserted explicitly because a security
        // rule that only happens to be true is a security rule somebody will tighten by
        // accident and break every provider's deliveries.
        assertThat(post(body(PaymentEventType.CHARGE_SUCCEEDED), ScriptedWebhooks.headers())
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private String body(PaymentEventType type) {
        return ScriptedWebhooks.body(UUID.randomUUID().toString(), type, clock.instant());
    }

    private ResponseEntity<String> post(String body, Map<String, String> signature) {
        return http.exchange(
                ENDPOINT, HttpMethod.POST, new HttpEntity<>(body.getBytes(), headers(signature)), String.class);
    }

    private static HttpHeaders headers(Map<String, String> signature) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        signature.forEach(headers::add);
        return headers;
    }

    private List<Map<String, Object>> deliveries() {
        return new JdbcTemplate(dataSource)
                .queryForList("SELECT provider, provider_event_id, event_type, state, payload"
                        + " FROM provider_webhook_events ORDER BY received_at");
    }
}
