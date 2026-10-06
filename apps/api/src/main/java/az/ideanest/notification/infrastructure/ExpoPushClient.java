package az.ideanest.notification.infrastructure;

import az.ideanest.notification.NotificationProperties;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Expo's push service, as the two calls this platform makes to it — issue #87.
 *
 * <h2>Why Expo and not APNs and FCM directly</h2>
 *
 * <p>§14.3 names it, and the reason it is the right call for this platform rather than
 * merely the easy one is that the alternative is two credentials with two rotation
 * stories, two payload shapes, and a token-per-platform question in every send path — in
 * exchange for removing a hop from a message that is already best-effort. `apps/mobile`
 * is an Expo application; its tokens are Expo tokens; going around the service would mean
 * ejecting from the toolchain to save a dependency that is on the delivery path of
 * nothing critical.
 *
 * <h2>The whole of the error handling is the RECEIPT, not the response code</h2>
 *
 * <p>This is the part that is easy to get wrong and expensive to get wrong quietly.
 * Expo's send endpoint answers 200 for a batch in which individual messages failed, and
 * the per-message {@code status} inside the response is where {@code DeviceNotRegistered}
 * appears. A client that checked only the HTTP status would keep sending to phones that
 * uninstalled the application months ago, for ever, and would never know.
 *
 * <p>So {@link Ticket} carries the per-message outcome, and {@code PushChannelSender} acts
 * on it — dropping the registration when the service says the device is gone.
 *
 * <h2>Timeouts are set, because the default is none</h2>
 *
 * <p>{@code CacheInvalidator} makes the same point: a request with no read timeout against
 * a service that has accepted the connection and stopped answering holds the calling
 * thread for ever, and the calling thread here belongs to the notification sender.
 */
@Component
public class ExpoPushClient {

    /**
     * Expo's own ceiling on one call. Stated here rather than discovered: a larger batch
     * is refused wholesale, so one busy campaign's fan-out would fail entirely.
     */
    public static final int MAX_MESSAGES_PER_CALL = 100;

    private final NotificationProperties properties;
    private final RestClient client;

    public ExpoPushClient(NotificationProperties properties, RestClient.Builder builder) {
        this.properties = properties;

        SimpleClientHttpRequestFactory requests = new SimpleClientHttpRequestFactory();
        requests.setConnectTimeout(properties.push().connectTimeout());
        requests.setReadTimeout(properties.push().readTimeout());
        this.client = builder.requestFactory(requests).build();
    }

    /**
     * One message, as Expo's API describes it.
     *
     * @param to the registered token
     * @param title what the lock screen shows in bold
     * @param body the sentence under it
     * @param data what the application reads when it is tapped, sent as Expo's {@code data}
     *     verbatim: {@code url}, an {@code ideanest://} link read by `apps/mobile`'s
     *     `lib/links.ts`, which refuses anything it does not recognise, and {@code type} and
     *     {@code notificationId} when there are such things — see {@code PushComposer}
     * @param idempotencyKey the notification's identifier. Expo deduplicates on this for a
     *     day, which is what makes {@code ChannelSender}'s at-least-once contract tolerable
     *     on this channel: the same message handed over twice arrives once
     */
    public record Push(String to, String title, String body, Map<String, String> data, String idempotencyKey) {}

    /**
     * What the service said about one message.
     *
     * @param ok whether it was accepted for delivery
     * @param unregistered whether the reason it was not is that the device is gone. Kept
     *     apart from every other failure because it is the only one that means "stop
     *     sending here" rather than "try again"
     * @param error the service's own error code, for the log line. Never the token
     */
    public record Ticket(boolean ok, boolean unregistered, String error) {

        static Ticket accepted() {
            return new Ticket(true, false, null);
        }
    }

    /**
     * Sends a batch, and answers one ticket per message in the order they were given.
     *
     * <p>Split into calls of {@link #MAX_MESSAGES_PER_CALL}. A short answer — fewer
     * tickets than messages, which the API should never produce — is padded with failures
     * rather than silently dropped, so a caller indexing tickets by message position
     * cannot read somebody else's outcome.
     *
     * @throws org.springframework.web.client.RestClientException when the service could
     *     not be reached or refused the batch. Thrown rather than swallowed:
     *     {@code ChannelSender}'s contract is that returning means accepted, and this is
     *     the failure the notification queue is supposed to retry
     */
    public List<Ticket> send(List<Push> messages) {
        List<Ticket> tickets = new ArrayList<>(messages.size());
        for (int from = 0; from < messages.size(); from += MAX_MESSAGES_PER_CALL) {
            List<Push> batch = messages.subList(from, Math.min(from + MAX_MESSAGES_PER_CALL, messages.size()));
            tickets.addAll(sendBatch(batch));
        }
        return tickets;
    }

    private List<Ticket> sendBatch(List<Push> batch) {
        List<Map<String, Object>> body = new ArrayList<>(batch.size());
        for (Push message : batch) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("to", message.to());
            payload.put("title", message.title());
            payload.put("body", message.body());
            /*
             * `data` is what the application reads when the notification is tapped: the
             * link, the type, and the inbox row a tap marks read. Nothing else -- the rest
             * is already in the visible text, and putting the campaign's identifiers in the
             * payload as well would put them in a push service's logs for no gain.
             */
            payload.put("data", message.data());
            /*
             * `default` rather than a custom sound. §4.10 has no notification whose
             * urgency justifies a distinctive one, and a platform that chose its own sound
             * for a campaign update is a platform people mute.
             */
            payload.put("sound", "default");
            /*
             * A day, in seconds. A pledge confirmation that reaches a phone which was off
             * for a week is a notification about something the person has already seen in
             * the application; the push services drop rather than queue past this, which
             * is the behaviour we want and is not their default.
             */
            payload.put("ttl", properties.push().timeToLive().toSeconds());
            payload.put("priority", "default");
            payload.put("_contentAvailable", false);
            body.add(payload);
        }

        ExpoResponse response = client.post()
                .uri(properties.push().endpoint())
                .contentType(MediaType.APPLICATION_JSON)
                .headers(headers -> {
                    /*
                     * The access token is optional on Expo's side and required by any
                     * project with "enhanced security" switched on. Sent when configured
                     * and omitted otherwise, rather than sent as an empty string — which
                     * Expo reads as a malformed credential and refuses, turning an
                     * unconfigured deployment's push into a 400 instead of a send.
                     */
                    String token = properties.push().accessToken();
                    if (token != null && !token.isBlank()) {
                        headers.setBearerAuth(token);
                    }
                })
                .body(body)
                .retrieve()
                .body(ExpoResponse.class);

        List<Ticket> tickets = new ArrayList<>(batch.size());
        List<ExpoTicket> answered = response == null || response.data() == null ? List.of() : response.data();
        for (int index = 0; index < batch.size(); index++) {
            tickets.add(index < answered.size() ? ticketOf(answered.get(index)) : shortAnswer());
        }
        return tickets;
    }

    private static Ticket ticketOf(ExpoTicket ticket) {
        if ("ok".equals(ticket.status())) {
            return Ticket.accepted();
        }
        String code = ticket.details() == null ? null : ticket.details().error();
        return new Ticket(false, "DeviceNotRegistered".equals(code), code == null ? ticket.message() : code);
    }

    private static Ticket shortAnswer() {
        // Never seen from a healthy service, and treated as a plain failure rather than as
        // an unregistered device: dropping a registration on the strength of a response we
        // do not understand would silently stop somebody's notifications.
        return new Ticket(false, false, "NoTicket");
    }

    /** Expo's envelope. Only the fields this platform reads. */
    private record ExpoResponse(List<ExpoTicket> data) {}

    private record ExpoTicket(String status, String message, ExpoDetails details) {}

    private record ExpoDetails(String error) {}
}
