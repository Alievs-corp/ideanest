package az.ideanest.staff.application;

import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.staff.StaffProperties;
import az.ideanest.staff.domain.PartnerSection;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.staff.domain.StaffRoleGrant;
import az.ideanest.staff.infrastructure.PartnerProfileRepository;
import az.ideanest.staff.infrastructure.StaffRoleRepository;
import az.ideanest.user.application.UserAccounts;
import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Who works here and what they may do — the role model #295 asked for.
 *
 * <p><strong>This replaces {@code project.application.ModeratorDirectory}, and the move
 * between modules is half the point.</strong> {@link PlatformStaff}'s own comment
 * predicted it: "epic #100 replaces what is behind this interface and changes nothing in
 * front of it — which is the reason the callers ask through an interface in
 * {@code shared} rather than naming the directory". That prediction held exactly. Four
 * call sites across three modules named the old class and all four now name the
 * interface, and no caller changed shape.
 *
 * <p>Staff identity left the project module because it was never a fact about campaigns.
 * A member of finance who may issue a refund and may not touch a submission queue has
 * nothing to do with {@code projects}, and a table of staff roles living in the module
 * that owns campaigns would make every future capability a change to the project module.
 *
 * <h2>Two sources, and the second one is a bootstrap rather than a fallback</h2>
 *
 * A grant in V48 is the real answer. {@link StaffProperties#bootstrapEmails()} is the
 * other, and it confers {@link StaffRole#SUPER_ADMIN} — not because a configured
 * address is trusted more, but because granting a role requires
 * {@link StaffCapability#ADMINISTER_STAFF}, so a database with no grants has no way to
 * make its first one. That property's comment has the argument.
 *
 * <p>It is a bootstrap and not a fallback because it does not wait for the table to be
 * empty. An address in the list is an administrator whether or not anybody holds a
 * grant; a rule that only applied when the table was empty would silently withdraw the
 * operator's own access on the day they granted somebody else a role, which is the worst
 * possible moment for it.
 *
 * <h2>Nothing is cached</h2>
 *
 * {@link #capabilitiesOf} queries on every call. A role withdrawn has to stop working on
 * the next request rather than on the next restart — a cache here would mean that
 * removing somebody's access is an action with no defined completion time, which is not
 * something anybody wants to explain after an incident. The query is a primary-key
 * lookup returning at most four rows.
 *
 * <h2>A deleted account is not staff</h2>
 *
 * {@code UserAccounts.findById} excludes soft-deleted rows, and the address lookup goes
 * through it — so an access token minted before the account was closed stops being
 * enough here as soon as it is. The grant rows go with the account through V48's
 * {@code ON DELETE CASCADE}.
 */
@Service
public class StaffDirectory implements PlatformStaff {

    private final Set<EmailAddress> bootstrapAdministrators;
    private final StaffRoleRepository grants;
    private final PartnerProfileRepository partners;
    private final UserAccounts accounts;

    public StaffDirectory(
            StaffProperties properties,
            StaffRoleRepository grants,
            PartnerProfileRepository partners,
            UserAccounts accounts) {
        this.grants = grants;
        this.partners = partners;
        this.accounts = accounts;
        // Normalised through EmailAddress at start-up rather than per call, so a
        // malformed entry stops the process with the value in the message instead of
        // silently never matching anybody.
        this.bootstrapAdministrators = properties.bootstrapEmails().stream()
                .map(String::trim)
                .filter(entry -> !entry.isEmpty())
                .map(EmailAddress::of)
                .collect(Collectors.toUnmodifiableSet());
    }

    @Override
    public boolean isStaff(UUID accountId) {
        return membershipOf(accountId).isStaff();
    }

    @Override
    public void requireStaff(UUID accountId) {
        if (!isStaff(accountId)) {
            throw new NotAModeratorException(accountId);
        }
    }

    @Override
    public Set<StaffCapability> capabilitiesOf(UUID accountId) {
        return membershipOf(accountId).capabilities();
    }

    @Override
    public void requireCapability(UUID accountId, StaffCapability capability) {
        StaffMember member = membershipOf(accountId);

        // The two refusals are deliberately not one. A stranger is told they do not work
        // here; a colleague is told which authority this screen wanted. Collapsing them
        // would send a moderator who opened the refund console looking for a bug.
        if (!member.isStaff()) {
            throw new NotAModeratorException(accountId);
        }
        if (!member.holds(capability)) {
            throw new InsufficientStaffCapabilityException(accountId, capability);
        }
    }

    /**
     * Everything the platform knows about one account's standing here.
     *
     * <p>Public because the console's own {@code GET /v1/admin/me} answers with it, and
     * because {@code StaffAdministrationService} needs the roles rather than only the
     * capabilities they add up to.
     */
    @Transactional(readOnly = true)
    public StaffMember membershipOf(UUID accountId) {
        Set<StaffRole> roles = grants.rolesOf(accountId).stream()
                .map(StaffRoleGrant::role)
                .collect(Collectors.toCollection(() -> EnumSet.noneOf(StaffRole.class)));

        boolean bootstrapped = isBootstrapAdministrator(accountId);
        if (bootstrapped) {
            roles.add(StaffRole.SUPER_ADMIN);
        }

        if (roles.isEmpty()) {
            return StaffMember.none(accountId);
        }

        Set<StaffCapability> capabilities = EnumSet.noneOf(StaffCapability.class);
        roles.forEach(role -> capabilities.addAll(role.capabilities()));

        // A partner's extra access is whatever sections a super admin opened, read on every
        // request like the roles are: a section closed has to stop working on the next call,
        // not the next restart. Computed here, into capabilities, so every endpoint that
        // authorises by capability honours it without knowing partners exist -- which is what
        // keeps the server, and not the browser, the thing that refuses a section nobody opened.
        // Only for accounts that hold PARTNER, so a stray row cannot widen anybody else.
        if (roles.contains(StaffRole.PARTNER)) {
            for (PartnerSection section : partners.sectionsOf(accountId)) {
                capabilities.add(section.capability());
            }
        }

        return new StaffMember(accountId, roles, capabilities, bootstrapped);
    }

    private boolean isBootstrapAdministrator(UUID accountId) {
        if (bootstrapAdministrators.isEmpty()) {
            // No query when there is no list. Not an optimisation — it keeps the
            // fail-closed case from depending on whether the account loads.
            return false;
        }
        return accounts.findById(accountId)
                .map(account -> bootstrapAdministrators.contains(account.email()))
                .orElse(false);
    }
}
