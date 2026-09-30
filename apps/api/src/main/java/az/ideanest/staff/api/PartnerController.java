package az.ideanest.staff.api;

import az.ideanest.staff.application.PartnerAdministrationService;
import az.ideanest.staff.domain.PartnerSection;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Partners, over HTTP — #204, part of #202.
 *
 * <p><strong>Super admin only, checked in the service.</strong> {@code ADMINISTER_STAFF} is the
 * capability, because being able to make somebody a partner is being able to decide who sees a
 * share of the platform's money, and that is the same authority as deciding who may move it.
 * The check is in {@link PartnerAdministrationService} and not an annotation here, for
 * {@link StaffController}'s reason: an annotation is one somebody forgets on the fifth
 * endpoint, and the service is also where the change is recorded.
 *
 * <p><strong>{@code PUT} rather than {@code POST}.</strong> A partner is a state: this account
 * has this share and these sections. Sending the same request twice leaves the same row, and
 * the account is the identity, so it is in the path.
 *
 * <p><strong>{@code no-store}</strong>, like everything under this prefix. A response here says
 * who is given what share of the platform's money.
 */
@RestController
@RequestMapping("/v1/admin/partners")
public class PartnerController {

    private final PartnerAdministrationService partners;

    public PartnerController(PartnerAdministrationService partners) {
        this.partners = partners;
    }

    /** Every partner, and how much of the whole is still unallocated. */
    @GetMapping
    public ResponseEntity<PartnerResponses.Roster> roster(@AuthenticationPrincipal Jwt accessToken) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PartnerResponses.Roster.of(partners.roster(callerOf(accessToken))));
    }

    /**
     * Makes an account a partner, or changes their percentage and opened sections.
     *
     * <p>The stored state becomes exactly what is sent: a section not listed is closed. The
     * sections are the enum's two names, so a section that may not be opened to a partner
     * cannot even be spelled.
     */
    @PutMapping("/{accountId}")
    public ResponseEntity<PartnerResponses.Partner> save(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID accountId,
            @Valid @RequestBody SaveRequest request) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PartnerResponses.Partner.of(
                        partners.save(callerOf(accessToken), accountId, request.percentage(), request.sections())));
    }

    /** Ends a partnership: the profile, its sections and the role. 404 when there is none. */
    @DeleteMapping("/{accountId}")
    public ResponseEntity<Void> remove(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID accountId) {
        partners.remove(callerOf(accessToken), accountId);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    /**
     * @param percentage a decimal string in (0, 100] with at most two places. A string for the
     *     reason money is one; the service parses it and names what is wrong with it
     * @param sections the console sections to open, possibly none
     */
    public record SaveRequest(
            @NotBlank @Size(max = 10) String percentage, @NotNull Set<PartnerSection> sections) {}

    /** Whoever is signed in, read from the token and never from the request. */
    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
