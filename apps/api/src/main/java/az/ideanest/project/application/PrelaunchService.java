package az.ideanest.project.application;

import az.ideanest.project.domain.Project;
import az.ideanest.project.domain.ProjectState;
import az.ideanest.project.infrastructure.ProjectRepository;
import az.ideanest.project.infrastructure.ReminderRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.SecureTokens;
import az.ideanest.user.application.UserAccount;
import az.ideanest.user.application.UserAccounts;
import java.util.EnumSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The pre-launch page, and the people who asked to be told when it opens.
 *
 * <p><strong>Nothing here is behind {@link ProjectAccess}, and that is the
 * point.</strong> Every other service in this module starts by asking who the
 * caller is; these three methods are read and written by the public, most of whom
 * have no account. What stands in for authorisation is the campaign's state:
 * {@link RemindersClosedException#ACCEPTED_IN} is the whole access rule, and it is
 * checked on the read as well as on the write so that a draft cannot be inspected
 * by anybody who guesses an identifier.
 *
 * <p><strong>Two kinds of follower, one row each.</strong> §17.4 decided the
 * shape. An account is stored as a reference, so anonymisation reaches it without
 * this table being swept; somebody with no account is stored as an address,
 * because there is nowhere else it could go. The reasoning, and the alternative
 * that was rejected, are in the header of {@code V10}. The consequence here is
 * {@link #register}: a signed-in caller's reminder is their account's, and the
 * address in the body — if a client sends one — is ignored rather than trusted,
 * because the account's address is the one registration verified and an address
 * taken from the request is one the caller chose.
 *
 * <p><strong>Consent is the row.</strong> There is no separate consent record and
 * there does not need to be one: the row exists because somebody asked for exactly
 * one message, {@code created_at} is when they asked, and it is deleted the moment
 * they say otherwise — see {@link #withdraw}, and the note in {@code V10} on why
 * withdrawal is a delete rather than §7.3's soft delete. What is <em>not</em>
 * settled is how long a row that has already been notified may be kept. That is a
 * retention question with a legal answer (§22.1, "Personal data"), and until it
 * has one the rows stay rather than being purged to a guessed period — stated here
 * rather than quietly implemented one way or the other.
 */
@Service
public class PrelaunchService {

    private static final Logger log = LoggerFactory.getLogger(PrelaunchService.class);

    /**
     * The states in which a campaign has no public pre-launch page and never had
     * one that this service can prove. See {@link #requireCollectingReminders}.
     */
    private static final Set<ProjectState> NEVER_ANNOUNCED = EnumSet.of(
            ProjectState.DRAFT,
            ProjectState.SUBMITTED,
            ProjectState.CHANGES_REQUESTED,
            ProjectState.APPROVED);

    private final ProjectRepository projects;
    private final ReminderRepository reminders;
    private final UserAccounts users;

    public PrelaunchService(ProjectRepository projects, ReminderRepository reminders, UserAccounts users) {
        this.projects = projects;
        this.reminders = reminders;
        this.users = users;
    }

    /**
     * What a pre-launch page shows, to anybody.
     *
     * <p>Refuses with {@link ProjectNotFoundException} — a 404 — for a campaign in
     * any other state, including one that exists and is still a draft. That is the
     * same answer {@code ProjectAccess} gives a stranger, and for the same reason:
     * an unlaunched campaign is confidential, and an endpoint that distinguished
     * "not open yet" from "no such campaign" would report on what other people are
     * preparing.
     */
    @Transactional(readOnly = true)
    public PrelaunchPage page(UUID projectId) {
        Project project = projects.findById(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));
        if (!RemindersClosedException.ACCEPTED_IN.contains(project.getState())) {
            throw new ProjectNotFoundException(projectId);
        }
        return new PrelaunchPage(project, reminders.countByProjectId(projectId));
    }

    /**
     * Adds somebody to a campaign's launch list, or confirms that they are already
     * on it.
     *
     * <p><strong>Idempotent in the database, not here.</strong> The insert is an
     * {@code ON CONFLICT DO NOTHING} against the unique indexes of {@code V10}, so
     * two clicks arriving together produce one row and one obligation. A check in
     * this method would read no row twice and insert twice, and the campaign would
     * owe that person two emails — which is exactly the failure that makes people
     * mark mail as spam.
     *
     * <p><strong>The answer does not depend on whether the row was new.</strong>
     * This endpoint needs no credential and accepts an arbitrary address, so a
     * response that distinguished the two would answer "does this address follow
     * this campaign" for anybody who asked — which is the fact §17.4 keeps private.
     * That is also why no unsubscribe token is minted here: a token handed back
     * only on a first registration would leak the same thing by being present. The
     * token is minted with the launch notice instead; see {@code V10}.
     *
     * <p><strong>The gap that leaves</strong> is real and is named rather than
     * hidden: somebody with no account who asks to be reminded, and then changes
     * their mind before the campaign opens, has no way to withdraw. Closing it
     * needs a message to carry a link, which is #86, and until #86 exists no
     * message is sent at all — so what they are waiting to withdraw from is a row
     * in our database rather than mail arriving. A signed-in follower has the
     * {@code DELETE} at any time.
     *
     * @param accountId the signed-in caller, or null
     * @param email the address a caller with no account gave. Ignored when
     *     {@code accountId} is present; see the class comment
     */
    @Transactional
    public ReminderRegistration register(UUID projectId, UUID accountId, EmailAddress email) {
        Project project = projects.findById(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));
        requireCollectingReminders(project);

        boolean created =
                accountId == null
                        ? registerAddress(projectId, requireEmail(email))
                        : registerAccount(projectId, accountId);

        // No address and no account identifier in the line: §17.4 keeps both out
        // of logs, and what an operator asks of this log is how many people a
        // pre-launch page collected, not who they were.
        log.debug("Launch reminder on project {} {}.", projectId, created ? "registered" : "already existed");

        return new ReminderRegistration(created, reminders.countByProjectId(projectId));
    }

    /**
     * An account's reminder, keyed by the account.
     *
     * <p>The anonymous row for this account's <em>verified</em> address is removed
     * first, when there is one. It is the single case in which an address row and
     * an account row are provably one person — the address came from our own
     * {@code users} row rather than from the request — and closing it here is what
     * keeps somebody who signed up while signed out, and again while signed in,
     * from being told twice.
     */
    private boolean registerAccount(UUID projectId, UUID accountId) {
        Optional<UserAccount> account = users.findById(accountId);
        account.ifPresent(known -> {
            int superseded = reminders.deleteForEmail(projectId, known.email());
            if (superseded > 0) {
                log.debug(
                        "Reminder on project {} registered anonymously was superseded by account {}.",
                        projectId,
                        accountId);
            }
        });

        return reminders.insertIfAbsent(Identifiers.newIdentifier(), projectId, accountId, null) == 1;
    }

    private boolean registerAddress(UUID projectId, EmailAddress email) {
        return reminders.insertIfAbsent(Identifiers.newIdentifier(), projectId, null, email.value()) == 1;
    }

    /**
     * Takes somebody off a campaign's launch list.
     *
     * <p>Idempotent, and deliberately silent about whether it removed anything.
     * The caller asked to not be on a list and they are not on it; answering "you
     * were not on it anyway" would turn an unauthenticated endpoint into a way to
     * ask whether a given address follows a given campaign, which is precisely the
     * fact §17.4 exists to keep private.
     *
     * <p>Not restricted by state. A campaign that has already launched still has
     * rows, and the person who wants out of a list they are already on must not be
     * refused because the campaign moved on — a 409 on an unsubscribe is how a
     * platform ends up in a spam folder.
     *
     * @param accountId the signed-in caller, or null
     * @param unsubscribeToken the token from the caller's own registration or from
     *     the message they received. Required when there is no account
     */
    @Transactional
    public void withdraw(UUID projectId, UUID accountId, String unsubscribeToken) {
        if (accountId != null) {
            reminders.deleteForAccount(projectId, accountId);
            return;
        }
        if (unsubscribeToken == null || unsubscribeToken.isBlank()) {
            throw new ProjectFieldRejectedException(
                    "token", "Removing a reminder needs the link that was sent with it.");
        }

        // By the token alone, and not by the project in the path, so that a link
        // whose campaign identifier was mistyped still removes the row it names.
        // The token is 256 bits and unique, so it identifies one row exactly; the
        // path is there because the endpoint is about a campaign, not because the
        // pair is the key.
        reminders.deleteByToken(SecureTokens.hash(unsubscribeToken));
    }

    /**
     * Whether this account asked to be told when this campaign opens — #137's {@code reminded}.
     *
     * <p><strong>The account's row only.</strong> A reminder registered with a bare address is
     * not counted even when the address is this account's: {@link #withdraw} with an account
     * removes the account's row and nothing else, so reporting the address row as "reminded"
     * would draw a control that cannot be switched off. Not restricted by state either, for
     * {@link #withdraw}'s reason — a row that is there is there, launched or not.
     */
    @Transactional(readOnly = true)
    public boolean hasReminder(UUID projectId, UUID accountId) {
        return reminders.existsByProjectIdAndUserId(projectId, accountId);
    }

    /** How many people are waiting for this campaign. */
    @Transactional(readOnly = true)
    public long followerCount(UUID projectId) {
        return reminders.countByProjectId(projectId);
    }

    /**
     * The one rule that stands in for authorisation on the write path, and the
     * place the 404/409 line is drawn.
     *
     * <p>A campaign that <em>has</em> a public pre-launch page and has moved past
     * it gets a 409 naming the state, because the caller was looking at that page a
     * moment ago and there is nothing left to hide. A campaign that has never
     * opened one gets the same 404 {@link #page} gives, because a 409 would tell a
     * stranger that the identifier they hold is a draft somebody is preparing —
     * which is exactly what {@code ProjectAccess} refuses to reveal on the
     * creator's endpoints, and it would be odd for the public one to be less
     * careful.
     *
     * <p>The states that produce a 404 are the ones before a campaign is
     * announced — {@code DRAFT} — and the ones in which it has withdrawn its page
     * for review: {@code SUBMITTED}, {@code CHANGES_REQUESTED}, {@code APPROVED}.
     * That last group is a known rough edge: a creator who shares a pre-launch link
     * and then submits for review has a dead link for the days moderation takes. It
     * is the price of not showing the public a page a moderator may be about to
     * send back, and the alternative — a {@code prelaunch_opened_at} column that
     * keeps the page up through review — is a change of design rather than a fix,
     * so it is named here rather than guessed at.
     */
    private static void requireCollectingReminders(Project project) {
        if (RemindersClosedException.ACCEPTED_IN.contains(project.getState())) {
            return;
        }
        if (NEVER_ANNOUNCED.contains(project.getState())) {
            throw new ProjectNotFoundException(project.getId());
        }
        throw new RemindersClosedException(project.getState());
    }

    private static EmailAddress requireEmail(EmailAddress email) {
        if (email == null) {
            throw new ProjectFieldRejectedException(
                    "email", "Tell us where to write, or sign in and we will use your account.");
        }
        return email;
    }

    /**
     * A campaign as its pre-launch page shows it, and how many people are waiting.
     *
     * <p>The entity rather than a projection type, because the mapping to JSON is
     * an API concern and lives in {@code api} with the response record — the same
     * arrangement as {@code ProjectEditResponses}. What this record adds is the
     * count, which is not on the campaign and deliberately is not denormalised onto
     * it; see {@code ReminderRepository#countByProjectId}.
     */
    public record PrelaunchPage(Project project, long followerCount) {
    }

    /**
     * @param created false when the reminder was already there, which is a success
     *     and not a conflict. Internal: it decides what is logged, and it is
     *     deliberately not in the response — see {@link #register}
     * @param followerCount after this call, so the page can show the number without
     *     a second request
     */
    public record ReminderRegistration(boolean created, long followerCount) {
    }
}
