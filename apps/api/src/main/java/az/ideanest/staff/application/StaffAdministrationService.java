package az.ideanest.staff.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.staff.domain.StaffRoleGrant;
import az.ideanest.staff.infrastructure.StaffRoleRepository;
import az.ideanest.user.application.UserAccounts;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Granting and withdrawing the roles V48 holds — #295.
 *
 * <p><strong>Every method here needs {@link StaffCapability#ADMINISTER_STAFF}</strong>,
 * which only {@code SUPER_ADMIN} confers. Anybody who can grant themselves a capability
 * effectively holds every capability, so this is the check that decides what the rest of
 * the enum is worth.
 *
 * <p><strong>The two writes are audited inside their own transaction</strong>, following
 * {@code UserAdministrationService.suspend}: a grant that rolled back must not leave a row
 * saying somebody was given the ability to move money. The read is audited too, and
 * independently — see {@link #roster}.
 */
@Service
public class StaffAdministrationService {

    private static final Logger log = LoggerFactory.getLogger(StaffAdministrationService.class);

    private final StaffRoleRepository grants;
    private final StaffDirectory directory;
    private final PlatformStaff staff;
    private final UserAccounts accounts;
    private final AuditLog audit;

    public StaffAdministrationService(
            StaffRoleRepository grants,
            StaffDirectory directory,
            PlatformStaff staff,
            UserAccounts accounts,
            AuditLog audit) {
        this.grants = grants;
        this.directory = directory;
        this.staff = staff;
        this.accounts = accounts;
        this.audit = audit;
    }

    /**
     * Who holds what.
     *
     * <p>Audited independently of the read, following {@code UserAdministrationService}:
     * there is no write to be atomic with, and "who went looking at the list of people who
     * can move money" is exactly the read an investigation cares about.
     */
    public List<StaffRoleGrant> roster(UUID staffId) {
        staff.requireCapability(staffId, StaffCapability.ADMINISTER_STAFF);
        List<StaffRoleGrant> roster = grants.everyGrant();

        audit.recordIndependently(
                AuditAction.ACCOUNTS_SEARCHED,
                staffId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "staffRoster; grants=" + roster.size());

        return roster;
    }

    /**
     * Gives an account a role.
     *
     * <p><strong>Granting a role somebody already holds is not an error.</strong> The
     * insert is {@code ON CONFLICT DO NOTHING} and this returns quietly, because two
     * administrators reaching the same conclusion at the same time is normal and a
     * constraint violation would be a 500 on a request that got what it asked for. The
     * audit row says which of the two happened.
     *
     * @throws NotAModeratorException when the caller does not work here
     * @throws InsufficientStaffCapabilityException when they do and are not an
     *     administrator
     * @throws UnknownStaffAccountException when the account named does not exist, or is
     *     deleted — deliberately the same answer, following {@code AdminUserController}
     */
    @Transactional
    public StaffMember grant(UUID staffId, UUID accountId, StaffRole role, String note) {
        staff.requireCapability(staffId, StaffCapability.ADMINISTER_STAFF);
        requireAccount(accountId);

        int written = grants.grantIfAbsent(accountId, role.name(), staffId, note);

        // Recorded either way, and the detail says which. "Nothing changed because they
        // already held it" is a different fact from "they were given it", and a trail
        // that recorded only the first would leave the second administrator's attempt
        // invisible.
        audit.record(
                AuditAction.STAFF_ROLE_GRANTED,
                accountId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "role=%s; created=%s; note=%s".formatted(role, written == 1, note == null ? "" : note));

        log.info("Role {} granted to {} by {} (created={})", role, accountId, staffId, written == 1);
        return directory.membershipOf(accountId);
    }

    /**
     * Takes a role away.
     *
     * <p><strong>An administrator may withdraw their own last role</strong>, and that is
     * deliberate rather than an oversight. The obvious guard — "you may not lock yourself
     * out" — protects nobody here: the bootstrap list in configuration is the way back in,
     * and a guard would instead prevent the legitimate case of an administrator standing
     * down after granting somebody else the role. What it would cost is a rule that reads
     * as a safety net and is not one.
     *
     * <p>Withdrawing a role the account does not hold is likewise not an error, for
     * {@link #grant}'s reason.
     */
    @Transactional
    public StaffMember revoke(UUID staffId, UUID accountId, StaffRole role) {
        staff.requireCapability(staffId, StaffCapability.ADMINISTER_STAFF);
        requireAccount(accountId);

        int removed = grants.revoke(accountId, role);

        audit.record(
                AuditAction.STAFF_ROLE_REVOKED,
                accountId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "role=%s; removed=%s".formatted(role, removed == 1));

        log.info("Role {} revoked from {} by {} (removed={})", role, accountId, staffId, removed == 1);
        return directory.membershipOf(accountId);
    }

    private void requireAccount(UUID accountId) {
        accounts.findById(accountId).orElseThrow(() -> new UnknownStaffAccountException(accountId));
    }
}
