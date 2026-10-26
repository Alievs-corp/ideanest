package az.ideanest.reward.api;

import az.ideanest.reward.application.ShippingZoneService;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * §4.8's PM-13 over HTTP: the regions a campaign ships to.
 *
 * <p>On the <strong>campaign</strong> and not on a tier, unlike
 * {@code PUT /v1/rewards/{id}/shipping-rules}. A region is a fact about the carrier
 * agreement the creator negotiated, so every tier prices the same regions and only
 * the amounts differ; putting the membership on a tier would mean re-entering
 * twenty-seven countries for each of them, which is the work this feature exists to
 * remove.
 *
 * <p>Both endpoints require a bearer token by falling through to
 * {@code SecurityConfiguration}'s catch-all, and both require {@code EDIT_REWARDS},
 * which {@code ShippingZoneService} enforces.
 *
 * <p><strong>No rate limiter.</strong> This is an authenticated write on the
 * creator's own campaign, bounded by {@code ShippingZoneService}'s two ceilings and
 * reaching nobody but the caller — the opposite of {@code CampaignMessageController},
 * where one request reaches every backer.
 */
@RestController
@RequestMapping("/v1/projects/{projectId}/shipping-zones")
public class ShippingZoneController {

    private final ShippingZoneService zones;

    public ShippingZoneController(ShippingZoneService zones) {
        this.zones = zones;
    }

    /**
     * The campaign's regions and what each covers.
     *
     * <p>{@code no-store}: the body describes a campaign that may not have launched,
     * and a shared cache holding an unlaunched campaign's fulfilment plan is the
     * failure the capability check exists to prevent.
     */
    @GetMapping
    public ResponseEntity<ShippingZoneListResponse> list(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID projectId) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(ShippingZoneListResponse.of(zones.list(projectId, callerOf(accessToken))));
    }

    /**
     * Makes the campaign's regions exactly the ones in the body.
     *
     * <p>{@code PUT}, and the whole set — see {@code ShippingZoneService}. An empty
     * list is a legitimate request and removes every region, along with every rate
     * that priced one.
     *
     * <p>200 with the resulting set rather than 204, because a region the creator
     * did not change keeps an identifier the client needs in order to send rates for
     * it, and a client that had to re-read to learn them would be one round trip away
     * from sending a rate for a zone that no longer exists.
     */
    @PutMapping
    public ResponseEntity<ShippingZoneListResponse> replace(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID projectId,
            @Valid @RequestBody ShippingZonesRequest request) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(ShippingZoneListResponse.of(
                        zones.replace(projectId, callerOf(accessToken), request.toDefinitions())));
    }

    /** The account making the request, from our own signature and never from the body. */
    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
