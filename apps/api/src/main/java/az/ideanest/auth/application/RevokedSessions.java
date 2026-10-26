package az.ideanest.auth.application;

import az.ideanest.auth.infrastructure.SessionRepository;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Whether the session behind an access token has ended — the {@code sid} check §4.11
 * describes (#587).
 *
 * <h2>Why the token is no longer simply trusted for its fifteen minutes</h2>
 *
 * <p>An access token is signed and short-lived, and the filter chain used to believe
 * one until it expired. That made every way of ending a session — signing out, a
 * password change or reset, a stolen refresh token being replayed, and above all a
 * trust-and-safety suspension — take effect up to fifteen minutes late, during which a
 * banned account could keep pledging, posting and messaging on the token it already
 * held. {@code SecurityConfiguration} now asks this class about the token's
 * {@code sid} on every authenticated request, and refuses a token whose session is
 * revoked.
 *
 * <h2>What it costs</h2>
 *
 * <p>A primary-key probe on {@code sessions}, and most of the time not even that: a
 * session found live is believed for {@link #LIVE_FOR} before it is asked about again,
 * and a revoked one is remembered for good, because a revocation is never undone. A
 * page that fires six requests at once costs one query, not six.
 *
 * <p>The cached "live" is the one place a revocation can lag, and two things bound it.
 * Every revocation made by this process clears the cache when its transaction
 * commits — {@link #revocationCommitting()} — so on the single instance the platform
 * runs, a suspension stops the account's next request. And a second instance, which
 * would not hear about another's revocations, is still bounded by {@link #LIVE_FOR}
 * rather than by the token's lifetime.
 *
 * <p>A session that does not exist is not revoked. Nothing was withdrawn, and the token
 * naming it was signed by us; the rows are kept through anonymisation precisely so
 * that "which session was this" can still be answered.
 */
@Component
public class RevokedSessions {

    /**
     * How long a session found live is believed without asking again.
     *
     * <p>Seconds rather than minutes: this is the lag a revocation made on another
     * instance can have, and the only reason for a cache at all is the burst of
     * requests one page makes.
     */
    static final Duration LIVE_FOR = Duration.ofSeconds(10);

    /** A bound on memory. Past it the live verdicts are dropped and simply asked again. */
    private static final int MAX_TRACKED = 50_000;

    private final SessionRepository sessions;

    /** Session to the {@link System#nanoTime()} its live verdict stops being believed. */
    private final Map<UUID, Long> liveUntil = new ConcurrentHashMap<>();

    private final Set<UUID> revoked = ConcurrentHashMap.newKeySet();

    public RevokedSessions(SessionRepository sessions) {
        this.sessions = sessions;
    }

    /**
     * Whether the session has been revoked.
     *
     * <p>The monotonic clock rather than the application's, on purpose: the suite
     * freezes and moves the application clock, and a cache whose expiry depended on it
     * would hold a verdict for as long as a test happened to keep it still.
     */
    public boolean isRevoked(UUID sessionId) {
        if (revoked.contains(sessionId)) {
            return true;
        }
        long now = System.nanoTime();
        Long until = liveUntil.get(sessionId);
        if (until != null && now - until < 0) {
            return false;
        }

        if (sessions.existsByIdAndRevokedAtIsNotNull(sessionId)) {
            if (revoked.size() >= MAX_TRACKED) {
                revoked.clear();
            }
            revoked.add(sessionId);
            liveUntil.remove(sessionId);
            return true;
        }
        if (liveUntil.size() >= MAX_TRACKED) {
            liveUntil.clear();
        }
        liveUntil.put(sessionId, now + LIVE_FOR.toNanos());
        return false;
    }

    /**
     * Forgets every live verdict once the revocation in progress commits.
     *
     * <p>All of them rather than the revoked session's, because most revocations are
     * by account — a suspension, a password change — and the statement that makes them
     * does not say which sessions it touched. Revocations are rare and a cleared cache
     * costs one query per active session, so precision is not worth a query of its own.
     *
     * <p>After commit, not now: cleared before the revocation is visible, a request
     * arriving in between would read the session as live again and cache that.
     */
    public void revocationCommitting() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    liveUntil.clear();
                }
            });
        } else {
            liveUntil.clear();
        }
    }
}
