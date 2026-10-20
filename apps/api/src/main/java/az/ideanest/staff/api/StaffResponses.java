package az.ideanest.staff.api;

import az.ideanest.shared.access.StaffCapability;
import az.ideanest.staff.application.RoleCapabilities;
import az.ideanest.staff.application.StaffMember;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.staff.domain.StaffRoleGrant;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * What the console is told about who it is talking to — #295.
 *
 * <p>One file for the shapes because they are read together and are small; the
 * administration module does the same for its ledger and payment responses.
 */
public final class StaffResponses {

    private StaffResponses() {
    }

    /**
     * The answer to {@code GET /v1/admin/me}.
     *
     * <p><strong>Both the roles and the capabilities travel</strong>, and neither is
     * derivable from the other in the browser without copying V48's policy there. The
     * capabilities decide what the console renders; the roles are what a person is shown
     * when they ask why a screen is missing, and what an administrator changes.
     *
     * <p>Sorted, so that two calls produce the same bytes and a caller diffing them sees
     * a real change. A {@code Set} would serialise in whatever order the enum iteration
     * happened to take.
     *
     * @param accountId whoever the access token names. Echoed so a console holding a
     *     stale token can tell that the answer is not about the person it thinks
     * @param staff whether this account works here at all. Redundant with an empty
     *     capability list and present anyway: it is the one field the console branches on
     *     first, and a client that had to know "empty means no" is a client that will
     *     eventually treat a failed parse as staff
     * @param bootstrapped staff by configuration rather than by a grant. The console
     *     shows this as a warning — an administrator who exists only in an environment
     *     variable cannot be withdrawn through the platform
     */
    public record Membership(
            UUID accountId,
            boolean staff,
            boolean bootstrapped,
            List<StaffRole> roles,
            List<StaffCapability> capabilities) {

        public static Membership of(StaffMember member) {
            return new Membership(
                    member.accountId(),
                    member.isStaff(),
                    member.bootstrapped(),
                    member.roles().stream().sorted().toList(),
                    member.capabilities().stream().sorted().toList());
        }
    }

    /**
     * One grant, as the staff screen lists it.
     *
     * <p>The account is an identifier and not a name. Turning one into a person is
     * {@code GET /v1/admin/users/{id}}, which is audited because it hands over an email
     * address — so this endpoint does not quietly do the same thing for four accounts at
     * once and leave one audit row saying "roster".
     */
    public record Grant(UUID accountId, StaffRole role, Instant grantedAt, UUID grantedBy, String note) {

        public static Grant of(StaffRoleGrant grant) {
            return new Grant(
                    grant.accountId(), grant.role(), grant.grantedAt(), grant.grantedBy(), grant.note());
        }
    }

    /**
     * The roster.
     *
     * <p>No cursor. V48's header has the argument: this table holds one row per role per
     * member of staff and the platform has four. The day it needs paging, the screen will
     * make that obvious by being long.
     */
    public record Roster(List<Grant> grants) {

        public static Roster of(List<StaffRoleGrant> grants) {
            return new Roster(grants.stream()
                    .sorted(Comparator.comparing(StaffRoleGrant::grantedAt))
                    .map(Grant::of)
                    .toList());
        }
    }

    /**
     * What one adjustable role confers now, what it would by default, and what may be changed on
     * it at all — the last so the console draws its checkboxes from the server's rule rather than
     * from a copy of it.
     */
    public record RoleCapabilitySet(
            StaffRole role,
            List<StaffCapability> capabilities,
            List<StaffCapability> defaults,
            List<StaffCapability> adjustable) {

        public static RoleCapabilitySet of(RoleCapabilities.RoleSet set) {
            return new RoleCapabilitySet(
                    set.role(),
                    set.capabilities().stream().sorted().toList(),
                    set.defaults().stream().sorted().toList(),
                    StaffRole.adjustableCapabilities().stream().sorted().toList());
        }
    }

    public record RoleCapabilityMatrix(List<RoleCapabilitySet> roles) {

        public static RoleCapabilityMatrix of(List<RoleCapabilities.RoleSet> sets) {
            return new RoleCapabilityMatrix(sets.stream().map(RoleCapabilitySet::of).toList());
        }
    }
}
