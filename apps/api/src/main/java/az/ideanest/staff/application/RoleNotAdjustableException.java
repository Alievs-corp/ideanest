package az.ideanest.staff.application;

import az.ideanest.staff.domain.StaffRole;

/** A super admin asked to change what SUPER_ADMIN or PARTNER confers. See {@link StaffRole#isAdjustable()}. */
public class RoleNotAdjustableException extends RuntimeException {

    private final StaffRole role;

    public RoleNotAdjustableException(StaffRole role) {
        super("What " + role + " confers cannot be changed from the console");
        this.role = role;
    }

    public StaffRole role() {
        return role;
    }
}
