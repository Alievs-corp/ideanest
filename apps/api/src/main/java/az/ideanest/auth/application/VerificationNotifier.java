package az.ideanest.auth.application;

import az.ideanest.shared.EmailAddress;

/**
 * Sending what registration produces.
 *
 * <p>A port, because transactional email — templates, retries, bounces,
 * suppression lists — is #86 and does not belong inside registration. What
 * belongs here is the decision about <em>what</em> is sent and when, which is
 * what this interface names.
 */
public interface VerificationNotifier {

    /** The link that proves the address exists. */
    void sendEmailVerification(EmailAddress email, String token, String locale);

    /**
     * Sent when somebody tries to register with an address that already has an
     * account.
     *
     * <p>The registration response is identical either way, so this message is
     * the only signal — and it goes to the person who owns the address rather
     * than to the person who typed it. That is the point: it tells the owner
     * that someone is probing their account, and tells the prober nothing.
     */
    void sendRegistrationAttemptOnExistingAccount(EmailAddress email, String locale);

    /**
     * §4.1's A-06: the single-use link that sets a new password without the old one.
     *
     * <p>Sent only when the address has an account. Nothing goes to an address that
     * does not — see {@code AuthEvents.PasswordResetRequested} for why an
     * unauthenticated form must not be able to mail a stranger.
     */
    void sendPasswordReset(EmailAddress email, String token, String locale);

    /**
     * A notice that the password changed, to the address on the account.
     *
     * <p>No link and nothing to click. It exists so that a change the account's
     * owner did not make is visible to them within minutes, which is the only
     * window in which knowing is worth anything.
     */
    void sendPasswordChanged(EmailAddress email, String locale);

    /** §4.1's A-12: the link that proves the new address, sent to the new address. */
    void sendEmailChangeConfirmation(EmailAddress newEmail, String token, String locale);

    /**
     * A-12's other half, to the address the account is leaving.
     *
     * <p>The capability says "confirmation to both addresses" and this is the second
     * one. It carries no link: the old address cannot approve the change, and it does
     * not need to — what it needs is to know, while it is still the address on the
     * account.
     */
    void sendEmailChangeNotice(EmailAddress previousEmail, EmailAddress newEmail, String locale);

    /**
     * Sent to an address somebody asked to move another account onto (#587).
     *
     * <p>The address-change form answers identically whether or not the address is
     * taken, so — as with {@link #sendRegistrationAttemptOnExistingAccount} — this is
     * the only signal, and it goes to the owner rather than to whoever typed it.
     */
    void sendEmailChangeAttemptOnExistingAccount(EmailAddress email, String locale);
}
