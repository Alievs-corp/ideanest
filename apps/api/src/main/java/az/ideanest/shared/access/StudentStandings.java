package az.ideanest.shared.access;

import java.time.Instant;
import java.util.UUID;

/**
 * Whether an account is a verified student, asked from outside the module that knows — #655.
 *
 * <p>The subscription module sells a student-only plan and has to refuse it to anybody whose
 * student card a member of staff has not approved. The approvals are the verification module's
 * rows, which the subscription module may not read, so the question is published here and
 * {@code verification.application.StudentVerifications} answers it — the arrangement
 * {@link PublishingEntitlement} has, the other way round.
 *
 * <p><strong>It fails closed.</strong> No row, a pending one, a refused one and an approval
 * whose year has run out are all "no".
 */
public interface StudentStandings {

    /**
     * Whether the account holds an approved student verification that is still valid at that
     * instant.
     *
     * @param accountId the authenticated caller, from the access token's subject
     * @param at the instant asked about — the expiry is a clock, not a state, so the caller says
     *     when
     */
    boolean isVerifiedStudent(UUID accountId, Instant at);
}
