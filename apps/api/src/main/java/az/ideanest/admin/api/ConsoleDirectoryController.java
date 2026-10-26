package az.ideanest.admin.api;

import az.ideanest.admin.application.ConsoleDirectoryService;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * What the console's identifiers are called — issue #402, over HTTP.
 *
 * <p>{@link ConsoleDirectoryService} carries the argument for why this exists at all, why
 * it asks for {@code ADMINISTER_ACCOUNTS} or {@code MODERATE_CONTENT}, and why it is the one console read that is not
 * audited. What is decided here is the shape of the request.
 *
 * <p><strong>Repeated parameters rather than a comma-separated list.</strong>
 * {@code ?account=a&account=b} is what Spring binds to a {@code List<UUID>} without a
 * converter and what {@code createApiClient} already emits for an array — the client's own
 * test pins that behaviour, and a comma-joined value would be one identifier whose text
 * contains a comma.
 *
 * <p><strong>{@code GET} with the identifiers in the query, not {@code POST} with a
 * body.</strong> It reads and changes nothing, so a method that says otherwise would put a
 * lookup behind every client's write path. The query does have a length ceiling — two
 * hundred UUIDs is around seven kilobytes — which is inside what every server on the path
 * accepts and is the same bound {@code ConsoleDirectoryService} enforces for its own
 * reasons.
 *
 * <p><strong>{@code no-store}, like every other response under this prefix.</strong> Nothing
 * here is secret, but a console response held in a shared cache is one served to the next
 * reader of that cache, and the rule is worth more than the exception.
 */
@RestController
@RequestMapping("/v1/admin/directory")
public class ConsoleDirectoryController {

    private final ConsoleDirectoryService directory;

    public ConsoleDirectoryController(ConsoleDirectoryService directory) {
        this.directory = directory;
    }

    /**
     * Names for the identifiers a screen is holding.
     *
     * @param account the people to name. Repeat the parameter for each. Absent is an empty
     *     answer rather than every account — a directory that answered an empty question
     *     with the whole platform would be an enumeration endpoint
     * @param project the campaigns, likewise
     */
    @GetMapping
    public ResponseEntity<ConsoleDirectoryResponses.Directory> lookUp(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestParam(name = "account", required = false) List<UUID> account,
            @RequestParam(name = "project", required = false) List<UUID> project) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(ConsoleDirectoryResponses.of(directory.lookUp(
                        staffOf(accessToken),
                        account == null ? List.of() : account,
                        project == null ? List.of() : project)));
    }

    /**
     * Whoever is signed in.
     *
     * <p>From the token's subject and never from the request, as every other administration
     * endpoint does it.
     */
    private static UUID staffOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
