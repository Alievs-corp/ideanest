package az.ideanest.user.application;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * What this module needs from whoever holds the account's credentials.
 *
 * <p><strong>An interface here, implemented over there, on purpose.</strong>
 * Closing an account has to check a password, kill the sessions, and put the
 * credentials beyond use — and all three of those live in {@code auth}. But
 * {@code auth} already depends on {@code user} (sign-in looks an account up),
 * and a call in the other direction would make the two modules mutually
 * dependent, which {@code ModuleBoundaryTests} refuses and which would mean
 * neither could ever be extracted alone. So the dependency is inverted: this
 * module states what it needs, and {@code auth} — which already knows about
 * this one — supplies it.
 */
public interface AccountSecurity {

    /**
     * Whether the password is the account's own.
     *
     * <p>Takes the same time whether or not the account has a credential, for
     * the same reason sign-in does.
     */
    boolean passwordMatches(UUID userId, String rawPassword);

    /**
     * Whether the account has a confirmed second factor — {@code GET /v1/me}'s
     * {@code twoFactorEnabled} (#270).
     *
     * <p>Confirmed, and nothing else. An enrolment that was started and never
     * proved with a code is not a second factor: sign-in does not ask for one,
     * so the owner's own screen must not say it is on either.
     */
    boolean twoFactorEnabled(UUID userId);

    /**
     * Ends every session the account has.
     *
     * <p>Called when deletion is requested. A closing account should not stay
     * signed in on a phone in a drawer for another thirty days, and the person
     * asking is usually asking because they no longer trust something.
     */
    void endAllSessions(UUID userId, Instant at);

    /**
     * Destroys what is left of the account's ability to authenticate, and the
     * personal data attached to the record of it having done so.
     *
     * <p>Idempotent: the anonymisation job may run this again after a crash, or
     * on two instances at once.
     */
    void forget(UUID userId);

    /** Everything the account's own security history contains, for an export. */
    SecurityHistory historyFor(UUID userId);

    /**
     * @param sessions one entry per sign-in, live or ended
     * @param verifications one entry per verification or reset link issued.
     *     Deliberately no token hashes — see {@code AccountExportService}
     */
    record SecurityHistory(List<SessionRecord> sessions, List<VerificationRecord> verifications) {
    }

    /** A sign-in, as the person it belongs to would recognise it. */
    record SessionRecord(
            UUID id,
            String deviceLabel,
            String userAgent,
            String ipAddress,
            Instant createdAt,
            Instant lastSeenAt,
            Instant expiresAt,
            Instant revokedAt,
            String revokedReason) {
    }

    /** A verification or password reset link that was issued, and what became of it. */
    record VerificationRecord(String purpose, Instant createdAt, Instant expiresAt, Instant consumedAt) {
    }
}
