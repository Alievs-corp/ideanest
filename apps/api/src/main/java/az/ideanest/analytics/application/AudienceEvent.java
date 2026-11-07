package az.ideanest.analytics.application;

import az.ideanest.analytics.domain.AudienceEventKind;
import az.ideanest.analytics.domain.AudiencePlatform;
import az.ideanest.analytics.domain.AudienceSurface;
import java.util.UUID;

/**
 * One audience event, with what the transport knew about who sent it — #633.
 *
 * <p>{@code address}, {@code userAgent} and {@code cloudflareCountry} are inputs to the
 * visitor key and the country and go no further: {@link AudienceEventService} stores
 * neither the address nor the agent, and this record is never logged.
 *
 * @param projectId the campaign, for {@code VIEW} and {@code CLICK}; null for {@code VISIT}
 * @param surface where a card was clicked, for {@code CLICK} only
 * @param address the client's address for this request, as an IP literal where known
 * @param userAgent the {@code User-Agent} header, or null
 * @param cloudflareCountry the {@code CF-IPCountry} header, or null
 * @throws InvalidAudienceEventException when the fields do not fit the kind
 */
public record AudienceEvent(
        AudienceEventKind kind,
        AudiencePlatform platform,
        UUID projectId,
        AudienceSurface surface,
        String address,
        String userAgent,
        String cloudflareCountry) {

    public AudienceEvent {
        if (kind == null || platform == null) {
            throw new InvalidAudienceEventException("An audience event names its kind and its platform");
        }
        if (kind.isAboutACampaign() && projectId == null) {
            throw new InvalidAudienceEventException("A " + kind + " names the campaign it is about");
        }
        if (!kind.isAboutACampaign() && projectId != null) {
            throw new InvalidAudienceEventException("A VISIT is about the site and names no campaign");
        }
        if (kind == AudienceEventKind.CLICK && surface == null) {
            throw new InvalidAudienceEventException("A CLICK names the surface the card was on");
        }
        if (kind != AudienceEventKind.CLICK && surface != null) {
            throw new InvalidAudienceEventException("Only a CLICK names a surface");
        }
        address = address == null || address.isBlank() ? "unknown" : address;
    }
}
