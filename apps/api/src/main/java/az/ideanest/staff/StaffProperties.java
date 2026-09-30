package az.ideanest.staff;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The way in before there is anybody to let you in — #295.
 *
 * @param bootstrapEmails accounts treated as holding {@code SUPER_ADMIN} by
 *     configuration rather than by a grant, by verified address.
 *     <p><strong>This is not a leftover of the list V48 replaced; it is the answer to
 *     the question that table cannot answer.</strong> Granting a role needs
 *     {@code ADMINISTER_STAFF}, which is conferred by a role, which has to be granted by
 *     somebody. A freshly migrated database has no grants, so without this there is no
 *     first administrator and no endpoint that could make one — the table is a lock with
 *     its only key inside.
 *     <p>It reads {@code MODERATOR_EMAILS}, the same variable the configured list used,
 *     so no deployment loses its staff on the release that adds the role model. What
 *     changes is what the value means: it used to be the whole of staff identity and is
 *     now the bootstrap. An operator who has granted real roles should empty it, and the
 *     console says so on the staff screen.
 *     <p><strong>It fails closed.</strong> An unset list is nobody, which is the default
 *     — a deployment that forgets it has a console nobody can open, which is visible and
 *     fixable, rather than a console anybody can open, which has no symptom at all until
 *     it matters.
 */
@ConfigurationProperties(prefix = "ideanest.staff")
public record StaffProperties(List<String> bootstrapEmails) {

    public StaffProperties {
        bootstrapEmails = bootstrapEmails == null ? List.of() : List.copyOf(bootstrapEmails);
    }
}
