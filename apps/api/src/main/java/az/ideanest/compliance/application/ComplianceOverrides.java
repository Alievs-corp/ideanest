package az.ideanest.compliance.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.compliance.domain.ComplianceOverride;
import az.ideanest.shared.compliance.ComplianceRequirement;
import az.ideanest.compliance.domain.OverrideReason;
import az.ideanest.compliance.infrastructure.ComplianceOverrideRepository;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Exceptions to compliance requirements: granted, withdrawn, and asked about — issue #436.
 *
 * <h2>Two audiences, and only one of them is authorised</h2>
 *
 * <p>{@link #isWaived} is asked by gates and needs no capability: a gate is the platform
 * asking itself a question about a rule it is enforcing, and there is no caller for it to
 * authorise. Everything that writes needs
 * {@link StaffCapability#GRANT_COMPLIANCE_OVERRIDE}, which only {@code SUPER_ADMIN} holds
 * — deliberately not {@code COMPLIANCE}, because a reviewer who could waive the requirement
 * they enforce holds both halves of it and the waiver stops being an exception anybody
 * escalated for.
 *
 * <p>The capability is checked here rather than by an annotation on the controller,
 * following {@code FeeSchedules} and {@code LegalDocuments}: this is also where the change
 * is recorded, and an authorised action nobody recorded and a recorded action nobody
 * authorised are the same defect from opposite ends.
 *
 * <h2>What this deliberately does not do</h2>
 *
 * <p><strong>It does not decide anything.</strong> An override says a requirement was
 * waived; whether that lets a payout through is #431's, whether it lets a submission
 * through is #429's. Those gates ask {@link #isWaived} and act on the answer, which is what
 * keeps this module from acquiring an opinion about payouts.
 *
 * <p><strong>It does not expire anything.</strong> There is no sweep and no state column.
 * {@code ComplianceOverride.isLiveAt} is a comparison, so an override stops working because
 * time passed rather than because a job ran — and a scheduler failing cannot leave every
 * override in the system live. What the row keeps is the history, which is the whole reason
 * expired rows are never deleted.
 */
@Service
public class ComplianceOverrides {

    private static final Logger log = LoggerFactory.getLogger(ComplianceOverrides.class);

    /**
     * The longest window anybody may grant in one go.
     *
     * <p>Ninety days, and the number is an argument rather than a preference. An override is
     * a control switched off for one person, and the failure it is guarding against is not
     * somebody granting a malicious one — it is somebody granting a reasonable one during an
     * outage and nobody ever looking at it again. A ceiling means the exception comes back
     * to a desk; a longer one means it comes back after the campaign it was granted for has
     * closed, which is the same as never.
     *
     * <p>Renewal is a second grant, with its own reason and its own name on it. That is more
     * ceremony than a still-valid exception deserves and exactly the right amount for the
     * case the ceremony is for.
     */
    public static final Duration LONGEST_WINDOW = Duration.ofDays(90);

    private final ComplianceOverrideRepository overrides;
    private final PlatformStaff staff;
    private final AuditLog audit;
    private final Clock clock;

    public ComplianceOverrides(
            ComplianceOverrideRepository overrides, PlatformStaff staff, AuditLog audit, Clock clock) {
        this.overrides = overrides;
        this.staff = staff;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * Whether this account has a live override of this requirement.
     *
     * <p><strong>The only question a gate asks, and it is a boolean on purpose.</strong> A
     * gate that received the override itself would start reading the reason, and the second
     * one to do it would branch on {@code PROVIDER_OUTAGE} — which is a policy decision made
     * at a call site, by somebody who did not know the enum could grow.
     *
     * <p>Reads the clock here rather than taking an instant, unlike the repository beneath
     * it. A gate is always asking about now; the parameterised form exists for the tests and
     * for whatever later needs to re-derive a decision, and offering it to every caller
     * would be offering them the chance to ask about the wrong instant.
     */
    @Transactional(readOnly = true)
    public boolean isWaived(UUID subjectUserId, ComplianceRequirement requirement) {
        return overrides
                .liveFor(subjectUserId, requirement, clock.instant())
                .isPresent();
    }

    /**
     * Everything ever granted to this account, newest first.
     *
     * <p>Expired and revoked rows included, which is the point: #436 asks that an override
     * "appears on the account it was applied to where the next person to look at that
     * account will see it", and a list of only the live ones would hide that somebody was
     * let past a rule in March.
     *
     * <p>Readable with {@link StaffCapability#REVIEW_IDENTITY_VERIFICATION} rather than with
     * the capability that grants one. The person deciding a verification is exactly the
     * person who has to know an exception was made, and requiring the granting capability to
     * read would mean only administrators could see what administrators had done.
     */
    @Transactional(readOnly = true)
    public List<ComplianceOverride> forSubject(UUID staffId, UUID subjectUserId) {
        staff.requireCapability(staffId, StaffCapability.REVIEW_IDENTITY_VERIFICATION);
        return overrides.forSubject(subjectUserId);
    }

    /**
     * Waives a requirement for one account until an instant.
     *
     * <p><strong>The self-grant is refused three times over</strong>, and only one of them
     * is a guarantee. V66's {@code compliance_overrides_grantor_is_not_the_subject} is the
     * one that holds against a hand-written INSERT during an incident — which is exactly
     * when somebody would write one, because that is when the only person available to
     * authorise an exception is the person who needs it. {@code ComplianceOverride}'s
     * constructor turns it into a sentence, and this method never reaches either, because
     * the controller has already been told who the caller is. The redundancy is deliberate:
     * the outer two produce a readable refusal and the innermost produces a correct
     * database.
     *
     * @throws InvalidOverrideWindowException when the window has already gone by or is
     *     longer than {@link #LONGEST_WINDOW}
     * @throws az.ideanest.compliance.domain.SelfGrantedOverrideException when the grantor is
     *     the subject
     */
    @Transactional
    public ComplianceOverride grant(
            UUID staffId,
            UUID subjectUserId,
            ComplianceRequirement requirement,
            OverrideReason reason,
            String note,
            Instant expiresAt) {

        staff.requireCapability(staffId, StaffCapability.GRANT_COMPLIANCE_OVERRIDE);

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Instant expires = expiresAt.truncatedTo(ChronoUnit.MICROS);

        // One refusal for both ends of the window, because both are the same mistake made
        // on the same field and the operator's correction is the same: pick another date.
        // Splitting them would put two codes in front of one input.
        Duration window = Duration.between(now, expires);
        if (window.isNegative() || window.isZero() || window.compareTo(LONGEST_WINDOW) > 0) {
            throw new InvalidOverrideWindowException(expires, now, LONGEST_WINDOW);
        }

        ComplianceOverride granted = new ComplianceOverride(
                Identifiers.newIdentifier(), subjectUserId, requirement, reason, note, staffId, now, expires);
        ComplianceOverride saved = overrides.save(granted);

        audit.record(
                AuditAction.COMPLIANCE_OVERRIDE_GRANTED,
                subjectUserId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "override=%s; requirement=%s; reason=%s; expires=%s"
                        .formatted(saved.id(), requirement, reason, expires));

        log.info(
                "Compliance override {} granted to {} for {} until {} by {}",
                saved.id(),
                subjectUserId,
                requirement,
                expires,
                staffId);
        return saved;
    }

    /**
     * Withdraws a live override before it would have expired.
     *
     * <p>Idempotent, and silent about it: revoking an already-revoked override keeps the
     * first withdrawal and writes no second audit row, because the first is the one that
     * stopped it working. A second row would make a reader count them to find out whether
     * something happened twice.
     *
     * @throws UnknownOverrideException when no such override exists
     */
    @Transactional
    public ComplianceOverride revoke(UUID staffId, UUID overrideId) {
        staff.requireCapability(staffId, StaffCapability.GRANT_COMPLIANCE_OVERRIDE);

        ComplianceOverride override =
                overrides.findById(overrideId).orElseThrow(() -> new UnknownOverrideException(overrideId));

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        if (!override.revoke(staffId, now)) {
            return override;
        }
        ComplianceOverride saved = overrides.save(override);

        audit.record(
                AuditAction.COMPLIANCE_OVERRIDE_REVOKED,
                override.subjectUserId(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "override=%s; requirement=%s; wouldHaveExpired=%s"
                        .formatted(override.id(), override.requirement(), override.expiresAt()));

        log.info("Compliance override {} revoked by {}", override.id(), staffId);
        return saved;
    }
}
