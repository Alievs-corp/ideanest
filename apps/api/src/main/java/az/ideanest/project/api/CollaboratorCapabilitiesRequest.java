package az.ideanest.project.api;

import az.ideanest.project.domain.Capability;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.Set;

/**
 * The capabilities a collaborator should have from now on.
 *
 * <p>The whole set, not a change to it. The People tab renders a checkbox per
 * capability and sends what they now say; a body that meant "add these" would leave
 * no way to express unchecking one, and the creator would have to revoke the grant
 * and issue a new invitation to take a capability away.
 *
 * @param capabilities at least one. A collaborator with none is a person told they
 *     are on a campaign they cannot touch — revoke the grant instead
 */
public record CollaboratorCapabilitiesRequest(
        @NotEmpty(message = "At least one capability is required") @Size(max = 64) Set<Capability> capabilities) {
}
