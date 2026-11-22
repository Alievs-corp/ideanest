package az.ideanest.subscription.application;

/**
 * A student-only plan, asked for by an account that is not a verified student now — #655.
 *
 * <p>Raised when the plan is chosen and again when a period of it is paid for — the first
 * period and every renewal — because the approval lasts a year and a subscription may outlive it.
 * The period already paid for is not taken away: what is refused is buying the next one.
 */
public class StudentVerificationRequiredException extends RuntimeException {

    public StudentVerificationRequiredException() {
        super("This plan is for verified students, and this account's student verification is not approved or has run out");
    }
}
