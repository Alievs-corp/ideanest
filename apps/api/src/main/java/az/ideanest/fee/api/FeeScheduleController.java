package az.ideanest.fee.api;

import az.ideanest.fee.application.FeeSchedules;
import az.ideanest.fee.domain.FeeScope;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * §4.11's AD-11 over HTTP — #311.
 *
 * <h2>There is no PUT and no PATCH, and that is the design</h2>
 *
 * <p>A rate is a term, not a setting. Editing one in place would silently rewrite what
 * every past payout should have been — V49's header has the argument at length — so the
 * only write is {@code POST /v1/admin/fees}, which closes the schedule in force and opens
 * a new one beginning now.
 *
 * <p>That makes the endpoint look like a create where an operator expects an update, and
 * the screen says so in as many words. The alternative reads more naturally and is the
 * one that makes §22.1's question unanswerable.
 *
 * <h2>Needs {@code CONFIGURE_PLATFORM}, checked in the service</h2>
 *
 * <p>Which only {@code SUPER_ADMIN} holds. Not an annotation here, following
 * {@code AuditTrailController}: the service is also where the change is recorded, and an
 * authorised action nobody recorded and a recorded action nobody authorised are the same
 * defect from opposite ends.
 *
 * <p><strong>{@code no-store}</strong>, like every response under this prefix.
 */
@RestController
@RequestMapping("/v1/admin/fees")
public class FeeScheduleController {

    private final FeeSchedules fees;

    public FeeScheduleController(FeeSchedules fees) {
        this.fees = fees;
    }

    /**
     * Every schedule ever written, newest first, open and closed alike.
     *
     * <p>The closed ones are the point: this screen answers "what did we charge in March"
     * as well as "what do we charge now", and a list of only the open ones would be three
     * rows that could have been configuration.
     */
    @GetMapping
    public ResponseEntity<FeeScheduleResponses.History> history(@AuthenticationPrincipal Jwt accessToken) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(FeeScheduleResponses.History.of(fees.history(callerOf(accessToken))));
    }

    /** Closes what is in force for this scope and opens the terms in the body. */
    @PostMapping
    public ResponseEntity<FeeScheduleResponses.Schedule> replace(
            @AuthenticationPrincipal Jwt accessToken, @Valid @RequestBody ReplaceRequest request) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(FeeScheduleResponses.Schedule.of(fees.replace(
                        callerOf(accessToken),
                        request.scope(),
                        request.scopeRef(),
                        request.platformRate(),
                        request.processingRate(),
                        request.processingFixed(),
                        request.currency(),
                        request.note())));
    }

    /**
     * New terms.
     *
     * <p><strong>The rates are fractions and are validated as such.</strong>
     * {@code 0.05} is five percent. A percentage would be divided by a hundred somewhere,
     * and the call site that forgets charges a fee a hundred times too large — so the wire
     * carries the number that gets multiplied, and {@code @DecimalMax("1")} makes "5"
     * a 400 rather than a five-hundred-percent fee.
     *
     * <p>They arrive as {@code BigDecimal} and never as {@code double}. CLAUDE.md: a rate
     * is not money but it is multiplied by money, and 0.05 has no exact binary
     * representation.
     *
     * @param scopeRef which category or which campaign. Must be null for {@code PLATFORM}
     *     and present otherwise, which V49 also checks — the constructor refuses first, so
     *     a mismatch is a 400 rather than a constraint violation
     * @param note why the rate changed. Required, unlike a staff grant's note: this one is
     *     read by an auditor rather than by a colleague, and a fee change nobody explained
     *     is one nobody can defend
     */
    public record ReplaceRequest(
            @NotNull FeeScope scope,
            UUID scopeRef,
            @NotNull @DecimalMin("0") @DecimalMax("1") BigDecimal platformRate,
            @NotNull @DecimalMin("0") @DecimalMax("1") BigDecimal processingRate,
            @NotNull @DecimalMin("0") BigDecimal processingFixed,
            @NotBlank @Pattern(regexp = "^[A-Z]{3}$") String currency,
            @NotBlank @Size(max = 2000) String note) {
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
