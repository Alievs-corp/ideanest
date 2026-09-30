package az.ideanest.staff.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.staff.domain.PartnerSection;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.staff.infrastructure.PartnerProfileRepository;
import az.ideanest.staff.infrastructure.StaffRoleRepository;
import az.ideanest.user.application.UserAccounts;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Making somebody a partner, changing their share, and ending it — #204, part of #202.
 *
 * <p><strong>Every method needs {@link StaffCapability#ADMINISTER_STAFF}</strong>, which only a
 * super admin holds, and checks it here rather than in the controller for the reason
 * {@link StaffAdministrationService} gives: the service is also where the change is recorded,
 * and an authorised action nobody recorded and a recorded action nobody authorised are the same
 * defect from opposite ends.
 *
 * <h2>What a partner is</h2>
 *
 * <p>A {@link StaffRole#PARTNER} grant plus a row in {@code partner_profiles}. {@link #save}
 * writes both in one transaction so there is no moment at which somebody holds the role and has
 * no percentage, or the reverse. A partner with no profile would see nothing, which is the safe
 * direction, but it is a state worth not being able to reach.
 *
 * <h2>The total may not pass one hundred</h2>
 *
 * <p>The partners divide one platform between them. {@link #save} takes the advisory lock V89's
 * trigger also takes, reads what the other partners already hold, and refuses a percentage that
 * would push the sum over 100, saying how much is left. The lock is what makes the answer true
 * when two super admins edit at once: the second waits, then reads a total that includes the
 * first.
 *
 * <h2>Nothing is split, copied or changed in the real data</h2>
 *
 * <p>This service stores a number. The statistics endpoint (#205) multiplies by it when it
 * produces a partner's figures; no payment, total or ledger row is touched here or there.
 */
@Service
public class PartnerAdministrationService {

    private static final Logger log = LoggerFactory.getLogger(PartnerAdministrationService.class);

    private static final BigDecimal WHOLE = new BigDecimal("100.00");

    private final PartnerProfileRepository profiles;
    private final StaffRoleRepository grants;
    private final StaffDirectory directory;
    private final PlatformStaff staff;
    private final UserAccounts accounts;
    private final AuditLog audit;

    public PartnerAdministrationService(
            PartnerProfileRepository profiles,
            StaffRoleRepository grants,
            StaffDirectory directory,
            PlatformStaff staff,
            UserAccounts accounts,
            AuditLog audit) {
        this.profiles = profiles;
        this.grants = grants;
        this.directory = directory;
        this.staff = staff;
        this.accounts = accounts;
        this.audit = audit;
    }

    /** Every partner, and how much of the whole is allocated. */
    public PartnerRoster roster(UUID staffId) {
        staff.requireCapability(staffId, StaffCapability.ADMINISTER_STAFF);
        List<PartnerProfileView> partners = profiles.findAll();
        BigDecimal allocated = partners.stream()
                .map(PartnerProfileView::percentage)
                .reduce(BigDecimal.ZERO, BigDecimal::add)
                .setScale(2, RoundingMode.UNNECESSARY);

        // Independently of the read, like the staff roster: there is no write to be atomic
        // with, and "who went looking at what partners are given" is what an investigation
        // asks.
        audit.recordIndependently(
                AuditAction.ACCOUNTS_SEARCHED,
                staffId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "partnerRoster; partners=" + partners.size());

        return new PartnerRoster(partners, allocated, WHOLE.subtract(allocated));
    }

    /**
     * Makes an account a partner, or changes their percentage and opened sections.
     *
     * <p>{@code PUT} semantics: the stored state becomes exactly what is given, so the sections
     * not listed are closed. Re-sending the same request changes nothing and is not an error.
     *
     * @param percentageText the share, as a decimal string: {@code "50"}, {@code "33.33"}.
     *     A string rather than a number for the reason money is one everywhere on this platform
     * @throws InvalidPartnerShareException when it is not in (0, 100] with at most two decimals
     * @throws PartnerShareExceededException when the other partners leave less than this
     * @throws PartnerIsSuperAdminException when the account holds a super-admin role
     * @throws PartnerHoldsOtherRolesException when it holds any other staff role
     * @throws UnknownStaffAccountException when the account does not exist
     */
    @Transactional
    public PartnerProfileView save(UUID staffId, UUID accountId, String percentageText, Set<PartnerSection> sections) {
        staff.requireCapability(staffId, StaffCapability.ADMINISTER_STAFF);
        accounts.findById(accountId).orElseThrow(() -> new UnknownStaffAccountException(accountId));

        BigDecimal percentage = parse(percentageText);

        Set<StaffRole> held = directory.membershipOf(accountId).roles();
        if (held.stream().anyMatch(StaffRole::isSuperAdmin)) {
            throw new PartnerIsSuperAdminException(accountId);
        }
        // Roles add up. A partner who also held FINANCE would read the payments journal and the
        // ledger through that role, and the percentage would protect nothing, so anything else
        // they hold is given up first and on purpose.
        Set<StaffRole> otherRoles = EnumSet.noneOf(StaffRole.class);
        otherRoles.addAll(held);
        otherRoles.remove(StaffRole.PARTNER);
        if (!otherRoles.isEmpty()) {
            throw new PartnerHoldsOtherRolesException(accountId, otherRoles);
        }

        profiles.lockTotal();
        BigDecimal others = profiles.totalExcluding(accountId);
        BigDecimal available = WHOLE.subtract(others).setScale(2, RoundingMode.UNNECESSARY);
        if (percentage.compareTo(available) > 0) {
            throw new PartnerShareExceededException(available);
        }

        PartnerProfileView before = profiles.find(accountId).orElse(null);
        BigDecimal previous = before == null ? null : before.percentage();
        Set<PartnerSection> previousSections = before == null ? Set.of() : before.sections();

        boolean created = profiles.upsert(accountId, percentage, staffId);
        profiles.replaceSections(accountId, sections);
        int roleWritten = grants.grantIfAbsent(accountId, StaffRole.PARTNER.name(), staffId, "partner profile");

        audit.record(
                AuditAction.PARTNER_PROFILE_SAVED,
                accountId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "percentage=%s; previous=%s; sections=%s; previousSections=%s; created=%s; roleGranted=%s"
                        .formatted(
                                percentage.toPlainString(),
                                previous == null ? "none" : previous.toPlainString(),
                                sorted(sections),
                                sorted(previousSections),
                                created,
                                roleWritten == 1));

        log.info("Partner {} saved by {} (percentage={}, created={})", accountId, staffId, percentage, created);
        return profiles.find(accountId).orElseThrow();
    }

    /**
     * Ends a partnership: the profile, its sections and the {@code PARTNER} role.
     *
     * @throws PartnerNotFoundException when the account is not a partner
     */
    @Transactional
    public void remove(UUID staffId, UUID accountId) {
        staff.requireCapability(staffId, StaffCapability.ADMINISTER_STAFF);
        accounts.findById(accountId).orElseThrow(() -> new UnknownStaffAccountException(accountId));

        PartnerProfileView existing = profiles.find(accountId).orElseThrow(() -> new PartnerNotFoundException(accountId));

        profiles.lockTotal();
        profiles.delete(accountId);
        int revoked = grants.revoke(accountId, StaffRole.PARTNER);

        audit.record(
                AuditAction.PARTNER_PROFILE_REMOVED,
                accountId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "percentage=%s; sections=%s; roleRevoked=%s"
                        .formatted(existing.percentage().toPlainString(), sorted(existing.sections()), revoked == 1));

        log.info("Partner {} removed by {}", accountId, staffId);
    }

    /** A share is a decimal in (0, 100] with at most two places. Anything else is refused by name. */
    static BigDecimal parse(String text) {
        if (text == null || text.isBlank()) {
            throw new InvalidPartnerShareException("A percentage is required.");
        }
        BigDecimal value;
        try {
            value = new BigDecimal(text.trim());
        } catch (NumberFormatException notANumber) {
            throw new InvalidPartnerShareException("The percentage must be a number such as 50 or 33.33.");
        }
        if (value.signum() <= 0) {
            throw new InvalidPartnerShareException("The percentage must be greater than 0.");
        }
        if (value.compareTo(new BigDecimal("100")) > 0) {
            throw new InvalidPartnerShareException("The percentage may not be more than 100.");
        }
        if (value.stripTrailingZeros().scale() > 2) {
            throw new InvalidPartnerShareException("The percentage may have at most two decimal places.");
        }
        return value.setScale(2, RoundingMode.UNNECESSARY);
    }

    private static String sorted(Set<PartnerSection> sections) {
        return sections.stream().map(Enum::name).sorted().toList().toString();
    }

    /**
     * Every partner and the arithmetic the screen needs.
     *
     * @param allocated the sum of the partners' percentages
     * @param remaining 100 minus that, the most a new partner could be given
     */
    public record PartnerRoster(List<PartnerProfileView> partners, BigDecimal allocated, BigDecimal remaining) {}
}
