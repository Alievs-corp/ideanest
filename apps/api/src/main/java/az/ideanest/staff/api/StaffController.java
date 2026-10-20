package az.ideanest.staff.api;

import az.ideanest.shared.access.StaffCapability;
import az.ideanest.staff.application.RoleCapabilities;
import az.ideanest.staff.application.StaffAdministrationService;
import az.ideanest.staff.application.StaffDirectory;
import az.ideanest.staff.domain.StaffRole;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.EnumSet;
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
 * §4.11's role model over HTTP — #295.
 *
 * <h2>{@code GET /v1/admin/me} is the endpoint the whole console hangs off</h2>
 *
 * <p>Every other route under {@code /v1/admin} refuses a caller who is not staff. That
 * was enough while the console had one answer to give — a screen either worked or showed
 * a 403 — and stops being enough the moment capabilities are different per person: the
 * front door has to know which of sixteen modules to offer <em>before</em> the reader
 * clicks one, and discovering it by opening all sixteen and counting the refusals is
 * sixteen audited requests to find out what a console already knows.
 *
 * <p><strong>It is the one route here that requires no capability</strong>, only a valid
 * token. A signed-in visitor who opens {@code /admin} out of curiosity gets
 * {@code staff: false} and a page that says so — where a 403 would be an error in the log
 * for something that is not an error, and would leave the console unable to tell "you do
 * not work here" from "the service is down".
 *
 * <h2>The route is still not a gate, and #295 does not make it one</h2>
 *
 * <p>The epic asks that no admin route be reachable without a staff check performed on
 * the server, and it already is not: the service refuses every read behind every screen.
 * What this endpoint adds is that the browser can now render an honest console instead of
 * a grid of refusals.
 *
 * <p>It deliberately does not become a check in {@code app/admin/layout.tsx}. The web
 * client holds its access token in a module variable and its refresh token in a
 * {@code SameSite=Strict} {@code HttpOnly} cookie that rotates on every use — so a Server
 * Component could only authenticate by spending that cookie, which would invalidate the
 * token the browser is holding and end the session it was trying to check. A layout gate
 * would therefore be a second, weaker copy of a check the service already makes
 * correctly, and the dangerous direction is the one where the browser says yes.
 * {@code AdminArea} carries the same argument.
 *
 * <h2>Everything below {@code /me} needs {@code ADMINISTER_STAFF}</h2>
 *
 * <p>Checked in the service and not by an annotation here, following
 * {@code AuditTrailController}: an annotation on a controller is one somebody forgets on
 * the fifth endpoint, and the service is also where the grant is recorded — an authorised
 * action nobody recorded and a recorded action nobody authorised are the same defect from
 * opposite ends.
 *
 * <p><strong>{@code no-store} on all of them.</strong> These responses say who may move
 * money on this platform; a shared cache or a browser's disk cache holding one is a
 * disclosure that survives signing out.
 */
@RestController
@RequestMapping("/v1/admin")
public class StaffController {

    private final StaffDirectory directory;
    private final StaffAdministrationService administration;
    private final RoleCapabilities roleCapabilities;

    public StaffController(
            StaffDirectory directory,
            StaffAdministrationService administration,
            RoleCapabilities roleCapabilities) {
        this.directory = directory;
        this.administration = administration;
        this.roleCapabilities = roleCapabilities;
    }

    /** What the caller may do. See the class comment on why this one refuses nobody. */
    @GetMapping("/me")
    public ResponseEntity<StaffResponses.Membership> me(@AuthenticationPrincipal Jwt accessToken) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(StaffResponses.Membership.of(directory.membershipOf(callerOf(accessToken))));
    }

    /** Who holds what. */
    @GetMapping("/staff")
    public ResponseEntity<StaffResponses.Roster> roster(@AuthenticationPrincipal Jwt accessToken) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(StaffResponses.Roster.of(administration.roster(callerOf(accessToken))));
    }

    /**
     * Gives an account a role.
     *
     * <p><strong>{@code PUT} rather than {@code POST}</strong>, because the effect is
     * idempotent by construction: holding a role is a state, not an event, and granting
     * one twice leaves the same row. A {@code POST} would invite a client to believe the
     * second call had done something, and V48's {@code ON CONFLICT DO NOTHING} means it
     * has not.
     *
     * <p>The role is in the path rather than the body for the same reason: the pair
     * {@code (account, role)} is the identity of the thing being created, and V48's
     * primary key says so.
     */
    @PutMapping("/staff/{accountId}/roles/{role}")
    public ResponseEntity<StaffResponses.Membership> grant(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID accountId,
            @PathVariable StaffRole role,
            @Valid @RequestBody(required = false) GrantRequest request) {

        String note = request == null ? null : request.note();

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(StaffResponses.Membership.of(
                        administration.grant(callerOf(accessToken), accountId, role, note)));
    }

    /** Takes a role away. Withdrawing one the account does not hold is not an error. */
    @DeleteMapping("/staff/{accountId}/roles/{role}")
    public ResponseEntity<StaffResponses.Membership> revoke(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID accountId,
            @PathVariable StaffRole role) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(StaffResponses.Membership.of(
                        administration.revoke(callerOf(accessToken), accountId, role)));
    }

    /**
     * Why this person holds this role, in the words of whoever granted it.
     *
     * <p>Optional, unlike a suspension's reason. A suspension's reason is read back to the
     * person it was done to and an appeal is answered from it; this is a note to the next
     * administrator, and a required field with no reader is a required field that becomes
     * a full stop.
     *
     * @param note bounded to V48's {@code staff_role_grants_note_length}
     */
    /** What every adjustable role confers, for the console's editor. Needs {@code ADMINISTER_STAFF}. */
    @GetMapping("/roles")
    public ResponseEntity<StaffResponses.RoleCapabilityMatrix> roles(@AuthenticationPrincipal Jwt accessToken) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(StaffResponses.RoleCapabilityMatrix.of(roleCapabilities.matrix(callerOf(accessToken))));
    }

    /**
     * Makes a role confer exactly the capabilities sent. {@code PUT}, because what a role confers
     * is a state: sending the same set twice leaves the same role, and sending its defaults puts
     * it back to them.
     */
    @PutMapping("/roles/{role}/capabilities")
    public ResponseEntity<StaffResponses.RoleCapabilitySet> changeRole(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable StaffRole role,
            @Valid @RequestBody RoleCapabilitiesRequest request) {

        Set<StaffCapability> wanted = EnumSet.noneOf(StaffCapability.class);
        wanted.addAll(request.capabilities());

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(StaffResponses.RoleCapabilitySet.of(
                        roleCapabilities.change(callerOf(accessToken), role, wanted)));
    }

    public record GrantRequest(@Size(max = 2000) String note) {
    }

    public record RoleCapabilitiesRequest(@NotNull @Size(max = 64) Set<@NotNull StaffCapability> capabilities) {
    }

    /**
     * Whoever is signed in.
     *
     * <p>Read from the token's subject and never from the request, for the reason every
     * other administration endpoint gives: an actor who could name themselves would be
     * writing the record as well as taking the decision — and on this endpoint the
     * decision is who may take every other one.
     */
    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
