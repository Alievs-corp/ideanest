package az.ideanest.analytics.api;

import az.ideanest.analytics.domain.AudienceEventKind;
import az.ideanest.analytics.domain.AudiencePlatform;
import az.ideanest.analytics.domain.AudienceSurface;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

/**
 * "This happened, on this client" — #633's beacon body.
 *
 * <p>Two required fields as annotations; the rule tying the rest to the kind — a
 * campaign for {@code VIEW} and {@code CLICK} and none for {@code VISIT}, a surface for a
 * {@code CLICK} only — is {@code AudienceEvent}'s, stated once there.
 *
 * @param projectId the campaign, for {@code VIEW} and {@code CLICK}; absent for {@code VISIT}
 * @param surface where the card was, for {@code CLICK} only
 */
public record AudienceEventRequest(
        @NotNull(message = "An audience event says what happened") AudienceEventKind kind,
        @NotNull(message = "An audience event says which client sent it") AudiencePlatform platform,
        UUID projectId,
        AudienceSurface surface) {
}
