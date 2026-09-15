package az.ideanest.compliance.application;

import az.ideanest.shared.outbox.OutboxMessage;
import java.util.UUID;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * A payout card the provider registered becomes the creator's payout destination — IDN-EXT-01 (#44).
 *
 * <p>Filed through {@link CreatorPayoutDestinations#record}, exactly as a destination typed in by hand
 * was: the holder's name is matched against the creator's legal name, the destination waits for a
 * person to verify it, and replacing an earlier one starts that verification again. Nothing here
 * releases a payout by itself.
 *
 * <p>A provider that names no holder files the destination under {@link #UNNAMED}, which cannot match a
 * legal name and so is looked at by a person rather than passed on the strength of a missing field.
 */
@Component
public class PayoutCardRegisteredListener {

    static final String REGISTERED = "payout-card.registered";

    /** The holder a destination is filed under when the provider did not say. */
    static final String UNNAMED = "Not named by the provider";

    private final CreatorPayoutDestinations destinations;
    private final ObjectMapper json;

    public PayoutCardRegisteredListener(CreatorPayoutDestinations destinations, ObjectMapper json) {
        this.destinations = destinations;
        this.json = json;
    }

    @EventListener
    public void on(OutboxMessage message) {
        if (!REGISTERED.equals(message.eventType())) {
            return;
        }
        JsonNode payload;
        try {
            payload = json.readTree(message.payload());
        } catch (JacksonException malformed) {
            throw new IllegalStateException("A payout-card.registered event " + message.id() + " cannot be read", malformed);
        }
        UUID creatorId = UUID.fromString(payload.required("creatorId").asString());
        String holder = textOrNull(payload, "holderName");
        destinations.record(
                creatorId,
                payload.required("provider").asString(),
                payload.required("cardId").asString(),
                holder == null ? UNNAMED : holder,
                textOrNull(payload, "displayHint"));
    }

    private static String textOrNull(JsonNode payload, String field) {
        JsonNode node = payload.get(field);
        if (node == null || node.isNull()) {
            return null;
        }
        String value = node.asString();
        return value.isBlank() ? null : value;
    }
}
