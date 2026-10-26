package az.ideanest.auth.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.auth.domain.SessionRevocationReason;
import az.ideanest.auth.infrastructure.SessionRepository;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Revoking a session so that the revocation survives the failure that caused
 * it.
 *
 * <p>This exists as its own bean for one reason: {@code REQUIRES_NEW}. When a
 * refresh detects a reused token, the correct response is to kill the session
 * <em>and</em> refuse the request — and refusing means throwing, which rolls
 * back the transaction the refresh is running in. Revoking in the same
 * transaction would therefore undo itself, and the attacker's next attempt
 * would find a live session. A separate transaction commits the revocation
 * before the caller throws.
 *
 * <p>Being a separate bean is not stylistic either: a self-invocation would not
 * pass through the proxy and the propagation would be silently ignored.
 */
@Service
public class SessionRevoker {

    private static final Logger log = LoggerFactory.getLogger(SessionRevoker.class);

    private final SessionRepository sessions;
    private final AuditLog audit;
    private final RevokedSessions revokedSessions;

    public SessionRevoker(SessionRepository sessions, AuditLog audit, RevokedSessions revokedSessions) {
        this.sessions = sessions;
        this.audit = audit;
        this.revokedSessions = revokedSessions;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void revoke(UUID sessionId, SessionRevocationReason reason, Instant at) {
        sessions.findById(sessionId).ifPresent(session -> {
            session.revoke(reason, at);
            sessions.save(session);
            // So that the access tokens this session issued stop working at the next
            // request rather than when the cached verdict expires (#587).
            revokedSessions.revocationCommitting();
            // Inside the ifPresent, so that revoking a session that is not there
            // records nothing. Nothing was withdrawn, and a row saying otherwise
            // would make a stale client look like a security event.
            //
            // In this transaction rather than independently: this method is already
            // REQUIRES_NEW precisely so the revocation survives the caller's
            // rollback, and the record belongs to the revocation.
            audit.record(
                    AuditAction.SESSION_REVOKED,
                    sessionId,
                    actorFor(reason, session.getUserId()),
                    AuditOutcome.SUCCEEDED,
                    "reason " + reason);
        });

        if (reason == SessionRevocationReason.TOKEN_REUSE) {
            // Worth a line at this level. A rotated refresh token being
            // presented again means two parties hold one credential, and
            // whoever reads the logs afterwards needs to find this.
            log.warn("Refresh token reuse detected; session {} revoked.", sessionId);
        }
    }

    /**
     * Kills every live session a user has, in one statement.
     *
     * <p>Used when the password changes and after a theft. One statement rather
     * than a loop because a loop leaves a window in which some sessions are
     * dead and some are not, and whoever is holding a survivor uses exactly
     * that window.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public int revokeAllFor(UUID userId, SessionRevocationReason reason, Instant at) {
        int revoked = sessions.revokeAllForUser(userId, reason, at);
        if (revoked > 0) {
            revokedSessions.revocationCommitting();
            // One row for the statement rather than one per session, because one
            // statement is what happened: the whole point of doing this in a single
            // UPDATE is that there is no instant at which some are dead and some are
            // not, and a row per session would describe a loop that does not exist.
            audit.record(
                    AuditAction.SESSIONS_REVOKED,
                    userId,
                    actorFor(reason, userId),
                    AuditOutcome.SUCCEEDED,
                    revoked + " sessions, reason " + reason);
        }
        return revoked;
    }

    /**
     * Who a revocation is attributed to, derived from why it happened.
     *
     * <p>The reason is the only thing this class is told, and it is enough. A user
     * signing out or clearing a device from the list did it themselves; a reused
     * refresh token, a password change and a support intervention are the platform
     * acting on an account rather than the account acting.
     *
     * <p>{@link SessionRevocationReason#ADMIN_ACTION} is recorded as
     * {@link AuditActor#system()} and not as the member of staff who caused it,
     * because nothing tells this method who that was. When epic #100 gives support
     * a way to revoke somebody's session, the actor becomes theirs and this is where
     * it changes — the row already has the column.
     */
    private static AuditActor actorFor(SessionRevocationReason reason, UUID userId) {
        return switch (reason) {
            case SIGNED_OUT, USER_REVOKED -> AuditActor.user(userId);
            case TOKEN_REUSE, PASSWORD_CHANGED, ADMIN_ACTION -> AuditActor.system();
        };
    }

    /**
     * Ends every session an account holds because trust and safety stopped it —
     * §4.11's AD-04 (#104).
     *
     * <p><strong>A method rather than a reason another module passes in.</strong>
     * {@link SessionRevocationReason} is this module's domain vocabulary and
     * {@code ModuleBoundaryTests} keeps it here; the admin module knows it is banning
     * somebody and has no business choosing which of five enum constants that is
     * recorded as. Naming the case in the method is also what makes the choice
     * reviewable in one place — the day a suspension deserves a reason of its own, it
     * gains one here and nothing else changes.
     *
     * @return how many sessions this ended, which the caller records on its audit row
     */
    public int revokeForSuspension(UUID userId, Instant at) {
        return revokeAllFor(userId, SessionRevocationReason.USER_REVOKED, at);
    }
}
