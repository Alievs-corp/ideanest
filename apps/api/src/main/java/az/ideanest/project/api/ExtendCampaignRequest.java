package az.ideanest.project.api;

import jakarta.validation.constraints.NotNull;
import java.time.Instant;

/**
 * When an extended campaign ends — IDN-EXT-01 (#34), §5.1.
 *
 * <p>The creator chooses the length, so the end is required and is an instant rather than a
 * number of days, for {@link OpenLatePledgesRequest}'s reason: the creator is announcing a date to
 * their backers, and a duration would be resolved against a clock the client and the server do
 * not share. It must be after the first deadline and no later than sixty days after it.
 */
public record ExtendCampaignRequest(@NotNull(message = "An extension has to say when it ends") Instant until) {
}
