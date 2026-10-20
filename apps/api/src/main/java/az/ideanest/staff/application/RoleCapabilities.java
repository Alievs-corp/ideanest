package az.ideanest.staff.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.staff.infrastructure.RoleCapabilityOverrideRepository;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What each staff role confers, with a super admin's adjustments applied — V114.
 *
 * <h2>The default stays in code, and this applies the difference</h2>
 *
 * <p>{@link StaffRole} keeps each role's default set, and V114 stores only what a super admin
 * added to or took from it. The table's header says why a full copy of the matrix would be
 * worse: it would freeze the defaults, and a capability a later release gives a role would reach
 * nobody.
 *
 * <h2>Read on every request</h2>
 *
 * <p>{@link StaffDirectory#membershipOf} asks {@link #effective} each time it answers, for the
 * reason it reads the grants each time: a capability taken from a role has to stop working on the
 * next call, not the next restart. It is one query against a table of at most a few dozen rows.
 *
 * <h2>The editor's limits are the server's</h2>
 *
 * <p>The console hides what may not be changed, and this refuses it regardless: a role that is
 * not {@linkplain StaffRole#isAdjustable() adjustable} and a capability that is not in
 * {@link StaffRole#adjustableCapabilities()} are refusals here, so a request written by hand
 * cannot do what the screen would not offer.
 */
@Service
public class RoleCapabilities {

    private static final Logger log = LoggerFactory.getLogger(RoleCapabilities.class);

    private final RoleCapabilityOverrideRepository overrides;
    private final PlatformStaff staff;
    private final AuditLog audit;

    /*
     * `@Lazy` on the staff check because `StaffDirectory` is the `PlatformStaff` and depends on
     * this class for what roles confer; without it the two would need each other to be built.
     */
    public RoleCapabilities(RoleCapabilityOverrideRepository overrides, @Lazy PlatformStaff staff, AuditLog audit) {
        this.overrides = overrides;
        this.staff = staff;
        this.audit = audit;
    }

    /** One role: what it confers now, and what it would by default. */
    public record RoleSet(StaffRole role, Set<StaffCapability> capabilities, Set<StaffCapability> defaults) {
    }

    /**
     * What these roles add up to, adjustments applied. Used for authorisation, so it checks
     * nothing about the caller — it is the answer the check is made against.
     */
    @Transactional(readOnly = true)
    public Set<StaffCapability> effective(Set<StaffRole> roles) {
        Set<StaffCapability> capabilities = EnumSet.noneOf(StaffCapability.class);
        boolean anyAdjustable = roles.stream().anyMatch(StaffRole::isAdjustable);
        Map<StaffRole, Map<StaffCapability, Boolean>> adjustments =
                anyAdjustable ? overrides.all() : Map.of();
        for (StaffRole role : roles) {
            capabilities.addAll(apply(role, adjustments.getOrDefault(role, Map.of())));
        }
        return capabilities;
    }

    /** Every adjustable role, for the console's editor. Needs {@code ADMINISTER_STAFF}. */
    @Transactional(readOnly = true)
    public List<RoleSet> matrix(UUID staffId) {
        staff.requireCapability(staffId, StaffCapability.ADMINISTER_STAFF);
        Map<StaffRole, Map<StaffCapability, Boolean>> adjustments = overrides.all();
        return Arrays.stream(StaffRole.values())
                .filter(StaffRole::isAdjustable)
                .map(role -> new RoleSet(
                        role,
                        apply(role, adjustments.getOrDefault(role, Map.of())),
                        role.capabilities()))
                .toList();
    }

    /**
     * Makes {@code role} confer exactly {@code wanted}. Needs {@code ADMINISTER_STAFF}.
     *
     * <p>Idempotent: the same set twice leaves the same rows, so a retried request after a dropped
     * response changes nothing. Sending the role's defaults puts it back to them and leaves no
     * rows behind. Recorded in the audit trail whether or not anything changed, for the reason
     * {@code StaffAdministrationService#grant} records a grant that already existed.
     */
    @Transactional
    public RoleSet change(UUID staffId, StaffRole role, Set<StaffCapability> wanted) {
        staff.requireCapability(staffId, StaffCapability.ADMINISTER_STAFF);
        if (!role.isAdjustable()) {
            throw new RoleNotAdjustableException(role);
        }
        Set<StaffCapability> refused = EnumSet.noneOf(StaffCapability.class);
        refused.addAll(wanted);
        refused.removeAll(StaffRole.adjustableCapabilities());
        if (!refused.isEmpty()) {
            throw new CapabilityNotAdjustableException(role, refused);
        }

        overrides.lock(role);
        Set<StaffCapability> before = apply(role, overrides.all().getOrDefault(role, Map.of()));

        Map<StaffCapability, Boolean> adjustments = new EnumMap<>(StaffCapability.class);
        for (StaffCapability capability : wanted) {
            if (!role.capabilities().contains(capability)) {
                adjustments.put(capability, true);
            }
        }
        for (StaffCapability capability : role.capabilities()) {
            if (!wanted.contains(capability)) {
                adjustments.put(capability, false);
            }
        }
        overrides.replace(role, adjustments, staffId);

        Set<StaffCapability> after = apply(role, adjustments);
        audit.record(
                AuditAction.STAFF_ROLE_CAPABILITIES_CHANGED,
                entityOf(role),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "role=%s; before=%s; after=%s; changed=%s".formatted(role, before, after, !before.equals(after)));

        log.info("Capabilities of {} set to {} by {}", role, after, staffId);
        return new RoleSet(role, after, role.capabilities());
    }

    /**
     * The audit trail's entity for a role. A role has no row of its own to point at, so it is a
     * name-based identifier — the same one every time, which is what makes "every change to the
     * moderator role" one query. `FeatureFlags` does the same for a flag's key.
     */
    static UUID entityOf(StaffRole role) {
        return UUID.nameUUIDFromBytes(("staff_role:" + role.name()).getBytes(StandardCharsets.UTF_8));
    }

    private static Set<StaffCapability> apply(StaffRole role, Map<StaffCapability, Boolean> adjustments) {
        Set<StaffCapability> capabilities = EnumSet.noneOf(StaffCapability.class);
        capabilities.addAll(role.capabilities());
        if (!role.isAdjustable()) {
            // A stray row cannot widen or narrow a role the editor may not touch. V114's CHECK
            // already refuses one; this is the second lock on the same door.
            return Collections.unmodifiableSet(capabilities);
        }
        adjustments.forEach((capability, granted) -> {
            if (granted && StaffRole.adjustableCapabilities().contains(capability)) {
                capabilities.add(capability);
            } else if (!granted) {
                capabilities.remove(capability);
            }
        });
        return Collections.unmodifiableSet(capabilities);
    }
}
