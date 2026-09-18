package az.ideanest.admin.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.auth.application.SessionRevoker;
import az.ideanest.pledge.application.BackerArchive;
import az.ideanest.pledge.application.BackerCursor;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.user.application.AccountNotFoundException;
import az.ideanest.user.application.AdministeredAccount;
import az.ideanest.user.application.UserDirectory;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * §4.11's AD-04 (#104): searching, inspecting, and stopping accounts.
 *
 * <h2>What this module adds, and why it is a module</h2>
 *
 * <p>Every fact here belongs to somebody else: {@code users} is the user module's table,
 * sessions are the auth module's, and staff identity is {@code shared.access}'s. What is
 * left is exactly what administration <em>is</em> — the authorisation, the audit row, and
 * the ordering between the two writes — and it is the reason this is a module rather than
 * three endpoints scattered across the modules that own the tables.
 *
 * <p><strong>A ban is two writes and they are one transaction.</strong> The account is
 * stopped and every session it holds is revoked. Either alone is a hole: an account
 * marked suspended whose refresh tokens still work is an account that can still be used
 * for as long as somebody keeps refreshing, and revoked sessions on an account that can
 * sign in again is an inconvenience rather than a ban.
 *
 * <p><strong>What a ban does not do is expire an access token that has already been
 * issued.</strong> They are signed and short-lived, {@code SecurityConfiguration} does not
 * consult the database on every request, and adding a lookup there would put a query on
 * the hot path of every endpoint to close a window of minutes. The window is stated rather
 * than hidden: a suspended account is refused at sign-in and at refresh, and its current
 * access token stops working when it expires.
 *
 * <h2>Why the search is audited</h2>
 *
 * <p>{@link AuditAction#ACCOUNTS_SEARCHED} carries the argument. It is the one endpoint
 * that hands somebody else's email address to an account with no relationship to it, and
 * "who looked up whom" cannot be asked afterwards of a read nobody recorded.
 */
@Service
public class UserAdministrationService {

    private static final Logger log = LoggerFactory.getLogger(UserAdministrationService.class);

    private final UserDirectory accounts;
    private final SessionRevoker sessions;
    private final BackerArchive pledges;
    private final PlatformStaff staff;
    private final AuditLog audit;
    private final Clock clock;

    public UserAdministrationService(
            UserDirectory accounts,
            SessionRevoker sessions,
            BackerArchive pledges,
            PlatformStaff staff,
            AuditLog audit,
            Clock clock) {

        this.accounts = accounts;
        this.sessions = sessions;
        this.pledges = pledges;
        this.staff = staff;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * AD-04's search.
     *
     * <p>Audited independently of the read, following {@code BackerExportService}: there
     * is no write to be atomic with, and the row must commit whether or not the response
     * reaches the client — an over-record beats a gap in the one table that answers "who
     * looked at this".
     *
     * @throws az.ideanest.staff.application.NotAModeratorException for a caller who is
     *     not platform staff
     */
    public List<AdministeredAccount> search(
            UUID staffId, String term, boolean suspendedOnly, UUID after, Integer limit) {

        staff.requireCapability(staffId, StaffCapability.ADMINISTER_ACCOUNTS);
        List<AdministeredAccount> found = accounts.search(term, suspendedOnly, after, limit);

        // What was asked and how much came back, never who came back and never the term:
        // staff search by email address, and this table has no retention rule.
        audit.recordIndependently(
                AuditAction.ACCOUNTS_SEARCHED,
                staffId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "results=%d; filtered=%s; suspendedOnly=%s"
                        .formatted(found.size(), term != null && !term.isBlank(), suspendedOnly));

        return found;
    }

    /**
     * One account, inspected.
     *
     * <p>Audited like the search and for the same reason: a targeted read of one person's
     * account by somebody with no relationship to them is the read an investigation into a
     * leak is most interested in.
     *
     * @throws AccountNotFoundException for an identifier that names nothing, and for a
     *     deleted account — deliberately the same answer
     */
    public AdministeredAccount inspect(UUID staffId, UUID userId) {
        staff.requireCapability(staffId, StaffCapability.ADMINISTER_ACCOUNTS);
        AdministeredAccount account = accounts.find(userId).orElseThrow(() -> new AccountNotFoundException(userId));

        audit.recordIndependently(
                AuditAction.ACCOUNTS_SEARCHED,
                userId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "inspected");

        return account;
    }

    /**
     * What one account has backed — #404.
     *
     * <h2>The context a suspension was being decided without</h2>
     *
     * <p>{@code /admin/users} offered one control per row — suspend — and nothing else: no
     * link, no detail, no history. The screen's own copy told a moderator that suspending
     * "changes nothing about the campaigns they created or the pledges they made", which is
     * exactly the context needed to decide, and none of it was reachable from anywhere in
     * the console. This is the pledges half of that; the campaigns half is
     * {@code CampaignDirectory}'s new creator filter, and the standing was already served by
     * {@link #inspect}.
     *
     * <p><strong>The same list the person sees of themselves</strong>, from
     * {@link BackerArchive#pledgesOf}, unchanged. Not a narrower staff view: a moderator
     * about to stop somebody's account is deciding about the money that account has
     * committed, and a summary of it would be a second description that the decision would
     * then be taken against. Every state, and the campaign in whatever state it is in, for
     * the reason that method gives — a cancelled pledge and a refused card are what make the
     * row worth reading.
     *
     * <p><strong>Audited, and it has to be more carefully than the search is.</strong> This
     * hands one person's whole funding history to somebody with no relationship to them,
     * which is a sharper disclosure than the address {@link AuditAction#ACCOUNTS_SEARCHED}
     * exists for. The action is that same one — a read of an account, recorded against the
     * account rather than the reader, exactly as {@link #inspect} records itself — and the
     * detail says which read it was, so the trail can tell "looked them up" from "read
     * everything they have ever paid for".
     *
     * <p><strong>The account is checked first.</strong> An identifier naming nothing is a 404
     * rather than an empty page: "this person has backed nothing" and "there is no such
     * person" are different answers, and a moderator acting on the first when the second is
     * true is acting on a typo.
     *
     * @param staffId whoever is asking, from their token
     * @param userId whose pledges. From the path here, unlike {@code GET /v1/me/pledges}
     *     where taking it from anywhere but the signature would serve anybody's pledges to
     *     anybody — the difference is the capability check on the line above
     * @param cursor the previous page's {@code nextCursor}, or null for the first
     * @param limit clamped by the archive, which is where a request's shape is decided
     * @throws AccountNotFoundException for an identifier that names nothing, and for a
     *     deleted account — deliberately the same answer {@link #inspect} gives
     * @throws az.ideanest.staff.application.NotAModeratorException for a caller who is not
     *     platform staff
     */
    public BackerArchive.PledgePage pledgesOf(UUID staffId, UUID userId, BackerCursor cursor, Integer limit) {
        staff.requireCapability(staffId, StaffCapability.ADMINISTER_ACCOUNTS);
        if (accounts.find(userId).isEmpty()) {
            throw new AccountNotFoundException(userId);
        }

        BackerArchive.PledgePage page = pledges.pledgesOf(userId, cursor, limit);

        // How many rows, never which campaigns and never an amount. The trail records that
        // somebody read this list, which is the fact an investigation needs; copying its
        // contents into a table with no retention rule would make the audit row the
        // disclosure it exists to record.
        audit.recordIndependently(
                AuditAction.ACCOUNTS_SEARCHED,
                userId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "pledges=%d".formatted(page.pledges().size()));

        return page;
    }

    /**
     * AD-04's ban: stops the account and ends its sessions.
     *
     * <p>One transaction for both, and the audit row inside it — a ban that rolled back
     * must not leave a row saying it happened, which is the rule every privileged write on
     * this platform follows.
     *
     * @throws AccountNotFoundException for an identifier that names nothing or a deleted
     *     account
     * @throws IllegalArgumentException when staff try to suspend themselves
     */
    @Transactional
    public AdministeredAccount suspend(UUID staffId, UUID userId, String reason) {
        staff.requireCapability(staffId, StaffCapability.ADMINISTER_ACCOUNTS);

        AdministeredAccount suspended = accounts.suspend(userId, staffId, reason);
        Instant at = clock.instant().truncatedTo(ChronoUnit.MICROS);
        int revoked = sessions.revokeForSuspension(userId, at);

        audit.record(
                AuditAction.ACCOUNT_SUSPENDED,
                userId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "sessionsRevoked=" + revoked);

        log.info("Account {} suspended by {}; {} sessions revoked", userId, staffId, revoked);
        return suspended;
    }

    /**
     * AD-04's reversal: lets the account back in.
     *
     * <p><strong>Sessions are not restored</strong>, and could not be: revocation is
     * terminal for a session, and the person signs in again. That is the correct cost —
     * the alternative would be a suspension that leaves live credentials lying around in
     * case somebody changes their mind.
     */
    @Transactional
    public AdministeredAccount reinstate(UUID staffId, UUID userId) {
        staff.requireCapability(staffId, StaffCapability.ADMINISTER_ACCOUNTS);
        AdministeredAccount reinstated = accounts.reinstate(userId);

        audit.record(
                AuditAction.ACCOUNT_REINSTATED,
                userId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "reinstated");

        log.info("Account {} reinstated by {}", userId, staffId);
        return reinstated;
    }
}
