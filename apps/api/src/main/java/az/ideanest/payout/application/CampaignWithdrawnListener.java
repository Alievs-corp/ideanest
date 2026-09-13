package az.ideanest.payout.application;

import az.ideanest.shared.outbox.OutboxMessage;
import java.util.UUID;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Requests the payout when a campaign is withdrawn — IDN-EXT-01 (#41).
 *
 * <p>From the outbox, so the withdrawal and the request are two commits with a durable record
 * between them: a payout that failed to be requested is requested on redelivery, and one that was
 * requested is not requested twice ({@link WithdrawalPayouts#request} is idempotent on the campaign).
 */
@Component
public class CampaignWithdrawnListener {

    private static final String WITHDRAWN = "project.withdrawn";

    private final WithdrawalPayouts payouts;
    private final ObjectMapper json;

    public CampaignWithdrawnListener(WithdrawalPayouts payouts, ObjectMapper json) {
        this.payouts = payouts;
        this.json = json;
    }

    @EventListener
    public void on(OutboxMessage message) {
        if (!WITHDRAWN.equals(message.eventType())) {
            return;
        }
        JsonNode payload;
        try {
            payload = json.readTree(message.payload());
        } catch (JacksonException malformed) {
            throw new IllegalStateException("A project.withdrawn event " + message.id() + " cannot be read", malformed);
        }
        UUID projectId = UUID.fromString(payload.required("projectId").asString());
        boolean automatic = payload.path("automatic").asBoolean(false);
        payouts.request(projectId, automatic);
    }
}
