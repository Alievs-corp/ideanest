package az.ideanest.project.api;

import az.ideanest.project.domain.Capability;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.Set;

/**
 * Who to invite, and what they may do.
 *
 * @param email the address the invitation goes to. Not an account identifier: a
 *     creator invites the colleague whose address they know, and that colleague
 *     may not have registered here yet
 * @param capabilities at least one, from {@link Capability}. An unknown name is a
 *     400 from the binder rather than a silently dropped capability, which would
 *     leave a creator believing they had granted something they had not
 */
public record InviteCollaboratorRequest(
        @NotBlank(message = "An email address is required")
                @Email(message = "That is not an email address")
                @Size(max = 254, message = "An email address may not exceed 254 characters")
                String email,
        @NotEmpty(message = "At least one capability is required") @Size(max = 64) Set<Capability> capabilities) {
}
