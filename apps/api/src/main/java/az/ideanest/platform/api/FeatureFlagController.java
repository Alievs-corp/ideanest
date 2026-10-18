package az.ideanest.platform.api;

import az.ideanest.platform.application.FeatureFlags;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
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
 * §4.11's AD-12 over HTTP — #312.
 *
 * <p><strong>{@code PUT} keyed on the flag's name, and there is no {@code POST}.</strong>
 * A flag's identity is what the code asks for — {@code flags.isOn("checkout-v2", id)} —
 * so the name is the address and creating one is putting to an address that has nothing
 * at it yet. The body's {@code version} says which of the two is meant: none creates, and
 * is refused for a name that exists; a version edits exactly that version, and is refused
 * when somebody has saved over it since. {@code FeatureFlags.save} has why both refusals
 * exist.
 *
 * <p><strong>There is no {@code DELETE}.</strong> Code asking for a flag that no longer
 * exists gets the fail-closed default silently, so "somebody deleted the row" and
 * "somebody never created it" look identical from the application's side. A flag is
 * switched off instead, which leaves the row saying who switched it off and when.
 *
 * <p>Needs {@code CONFIGURE_PLATFORM}, checked in the service.
 */
@RestController
@RequestMapping("/v1/admin/feature-flags")
public class FeatureFlagController {

    private final FeatureFlags flags;

    public FeatureFlagController(FeatureFlags flags) {
        this.flags = flags;
    }

    /** Every flag, alphabetically. */
    @GetMapping
    public ResponseEntity<PlatformResponses.FlagList> list(@AuthenticationPrincipal Jwt accessToken) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PlatformResponses.FlagList.of(flags.list(callerOf(accessToken))));
    }

    /** Creates the flag at this name, or replaces everything about it except the name. */
    @PutMapping("/{key}")
    public ResponseEntity<PlatformResponses.Flag> save(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable String key,
            @Valid @RequestBody SaveFlagRequest request) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PlatformResponses.Flag.of(flags.save(
                        callerOf(accessToken),
                        key,
                        request.description(),
                        request.enabled(),
                        request.rolloutPercentage(),
                        request.enabledAccounts() == null ? List.of() : request.enabledAccounts(),
                        request.version())));
    }

    /**
     * A flag's whole state.
     *
     * <p>Everything is replaced, including the account list, and that is deliberate: a
     * partial update would need an "add this account" verb and a "remove that one" verb,
     * and two administrators using them at once would produce a list neither intended.
     * Replacing whole makes the last write win visibly rather than invisibly.
     *
     * @param enabled the kill switch. Off means off for everybody, including the accounts
     *     named below — see {@code FeatureFlag.isOnFor}
     * @param rolloutPercentage nought to a hundred. Which accounts fall inside it is
     *     decided by a stable hash, so widening a rollout only ever adds people
     * @param enabledAccounts always in, whatever the percentage says. Bounded by V50 at
     *     two hundred, because this array is read on every evaluation. A repeated account
     *     is kept once
     * @param version the version the edit was made from, as the list sent it. Absent to
     *     create the flag
     */
    public record SaveFlagRequest(
            @NotBlank @Size(max = 2000) String description,
            boolean enabled,
            @Min(0) @Max(100) short rolloutPercentage,
            @Size(max = 200) List<@NotNull UUID> enabledAccounts,
            Long version) {
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
