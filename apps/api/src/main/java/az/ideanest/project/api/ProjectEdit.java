package az.ideanest.project.api;

import az.ideanest.shared.money.Money;
import com.fasterxml.jackson.annotation.JsonInclude;
import tools.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A campaign as its creator's editor sees it.
 *
 * <p>The response of every endpoint in this module that changes something. One
 * shape rather than one per action, so that a client applies the same update to
 * its state after a save, a submission, and a moderation decision — and so that
 * an endpoint cannot quietly start returning a field the others do not.
 *
 * <p>This is the <em>creator's</em> projection and not the public one. It carries
 * the state, the scheduled launch, and the fields nobody outside the campaign may
 * see; the public project page is a different response owned by a different issue.
 *
 * <p><strong>Nulls are written out.</strong> The service is configured with
 * {@code default-property-inclusion: non_null}, which is right for most responses
 * and wrong for this one: the editor binds a form to every field here, and an
 * absent key cannot be told from a field that is genuinely unset. That is the same
 * distinction the {@code PATCH} body depends on, in the other direction.
 *
 * @param goal the funding target, as an amount and a currency. The amount is a
 *     string on the wire — §10.3, and {@link Money} for why
 * @param lockedFields which fields may no longer be changed, given the state the
 *     campaign is in. Empty until launch; from {@code LIVE} onwards it lists
 *     {@code goal}, {@code durationDays}, and {@code scheduledLaunchAt}, which §5.3
 *     freezes because §5.1 resolves a campaign against them. The names are the keys
 *     of the {@code PATCH} body, so a client matches them directly against its own
 *     inputs and disables them; a client that does not is answered
 *     {@code 409 PROJECT_FIELD_LOCKED} when it tries. A reward's price is frozen by
 *     the same rule and is deliberately not listed here — it is not a field of this
 *     body. See {@code ProjectEditLocks}
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record ProjectEdit(
        UUID id,
        String slug,
        String state,
        String title,
        String blurb,
        UUID categoryId,
        UUID subcategoryId,
        Money goal,
        Integer durationDays,
        Instant scheduledLaunchAt,
        Instant launchedAt,
        Instant deadline,
        JsonNode story,
        String risks,
        CoverImageBody coverImage,
        CampaignVideoBody video,
        boolean latePledgeEnabled,
        Instant latePledgeEndsAt,
        List<String> lockedFields,
        Instant createdAt,
        Instant updatedAt) {
}
