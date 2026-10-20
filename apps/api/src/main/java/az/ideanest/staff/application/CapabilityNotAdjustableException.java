package az.ideanest.staff.application;

import az.ideanest.shared.access.StaffCapability;
import az.ideanest.staff.domain.StaffRole;
import java.util.Set;

/**
 * A super admin asked to give a role a capability no adjustable role may hold. See
 * {@link StaffRole#adjustableCapabilities()}.
 */
public class CapabilityNotAdjustableException extends RuntimeException {

    private final Set<StaffCapability> capabilities;

    public CapabilityNotAdjustableException(StaffRole role, Set<StaffCapability> capabilities) {
        super(role + " cannot be given " + capabilities);
        this.capabilities = Set.copyOf(capabilities);
    }

    public Set<StaffCapability> capabilities() {
        return capabilities;
    }
}
