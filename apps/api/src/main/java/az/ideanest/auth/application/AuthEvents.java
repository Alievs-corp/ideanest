package az.ideanest.auth.application;

import az.ideanest.shared.EmailAddress;

/**
 * What registration announces once its transaction has committed.
 *
 * <p>Email is sent from a listener rather than inline, because a message sent
 * inside a transaction that then rolls back cannot be unsent: the user receives
 * a verification link for an account that does not exist.
 *
 * <p>This is not yet the transactional outbox (#135). A crash between the
 * commit and the send loses the message, and the user has to ask for another
 * one. The outbox closes that window by writing the intent to send in the same
 * transaction as the account.
 */
public final class AuthEvents {

    private AuthEvents() {
    }

    /** An account was created and needs its address proven. */
    public record EmailVerificationRequested(EmailAddress email, String token, String locale) {
    }

    /** Somebody tried to register an address that is already spoken for. */
    public record RegistrationAttemptedOnExistingAccount(EmailAddress email, String locale) {
    }

    /**
     * §4.1's A-06: somebody asked to reset the password on an account that exists.
     *
     * <p><strong>There is no counterpart for an address with no account.</strong>
     * Registration has one — it writes to somebody who already registered with us —
     * and this deliberately does not: the address on a reset request is whatever was
     * typed into a public form, so sending to it would let anybody use this platform
     * to put a message in a stranger's inbox. The response is identical either way,
     * which is what keeps the endpoint from answering "is this person a backer here".
     */
    public record PasswordResetRequested(EmailAddress email, String token, String locale) {
    }

    /**
     * The password changed — by A-13's change, or by A-06's reset.
     *
     * <p>Sent to the address on the account rather than to whoever caused it. If the
     * person reading it did not do this, they have just been told while their new
     * sessions are minutes old, which is the only window in which the notice is worth
     * anything.
     */
    public record PasswordChanged(EmailAddress email, String locale) {
    }

    /**
     * §4.1's A-12, the half that goes to the address being proven.
     *
     * <p>The link. Until it is followed the account's address has not moved.
     */
    public record EmailChangeRequested(EmailAddress newEmail, String token, String locale) {
    }

    /**
     * A-12's second half, and the reason the capability says "confirmation to both
     * addresses".
     *
     * <p>The message to the address the account is leaving. It carries no link and
     * cannot stop anything by itself; what it does is make an address takeover
     * visible to the person losing the account, at the address they still hold.
     * Without it the first they hear of it is a sign-in that no longer works.
     */
    public record EmailChangeNoticeToPreviousAddress(EmailAddress previousEmail, EmailAddress newEmail, String locale) {
    }

    /**
     * Somebody asked to move their account onto an address that already has one (#587).
     *
     * <p>{@link RegistrationAttemptedOnExistingAccount}'s counterpart for A-12. The
     * request is answered as though it had worked, so this message is the only signal,
     * and it goes to the address's owner rather than to whoever named it: the owner
     * learns somebody tried, and the person asking learns nothing.
     */
    public record EmailChangeAttemptedOnExistingAccount(EmailAddress email, String locale) {
    }
}
