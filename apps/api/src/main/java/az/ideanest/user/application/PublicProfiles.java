package az.ideanest.user.application;

import az.ideanest.user.domain.ProfileVisibility;
import az.ideanest.user.domain.User;
import az.ideanest.user.infrastructure.ProfileLocations;
import az.ideanest.user.infrastructure.UserRepository;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Whether an account has a public page, and the one switch that decides it — §4.2's P-04
 * and P-07 (#274, #282).
 *
 * <p><strong>The counterpart of {@code project.application.PublicProjects}, and built to
 * the same shape.</strong> That class answers "may a stranger see this campaign" and
 * keeps the answer in one place so that no public endpoint states the rule for itself;
 * this answers "may a stranger see this account", and it has the same reason to exist and
 * a stronger one. There are three public reads of a profile — the profile itself, the
 * campaigns this account created, the campaigns it backed — and they live in three
 * different modules, because {@code projects} and {@code pledges} are not this module's
 * tables. Written inline, the rule would be three copies in three modules, and the first
 * one that forgot {@link ProfileVisibility#PRIVATE} would publish the archive of somebody
 * who asked for no page at all.
 *
 * <p><strong>The read and the write are in one file, which is unusual here and is right
 * for this pair.</strong> {@link #requireVisible} enforces exactly what
 * {@link #setVisibility} sets, and nothing else in the service reads the column. Splitting
 * them would put a setting and the only rule that consults it in two files, which is how a
 * setting comes to be honoured on two surfaces out of three. The write is P-07's control
 * and it is the only write in this whole feature.
 *
 * <p><strong>404 and never 403</strong>, for all three of {@link ProfileNotFoundException}'s
 * cases. That file carries the argument.
 *
 * <h2>Why there is no {@code createdProjectsCount} and no {@code backedProjectsCount}</h2>
 *
 * <p>§4.2 puts both numbers on the page and neither is served, which is a decision worth
 * stating plainly rather than leaving as a gap somebody re-derives.
 *
 * <p>They cannot be answered from here. {@code projects} belongs to the project module and
 * {@code pledges} to the pledge module; {@code ModuleBoundaryTests} forbids reaching into
 * either, and the dependency it would take is one this module has never had — {@code user}
 * depends on nothing but {@code audit} and {@code shared} today, and every other module
 * depends on it. Making it depend on two of them turns the leaf of the graph into its
 * root, which is a cycle away from the modules stopping being extractable at all.
 *
 * <p>The sanctioned way across — a question published in {@code shared} and answered by
 * the module that owns the rows, as {@code ProjectSummaries} and {@code ProjectAudiences}
 * both are — was considered and refused for this. Those exist because a notification
 * <em>cannot</em> be written without the answer; a profile page can, and the count is
 * available to the client from the list it is already rendering. A published contract is a
 * permanent surface, and adding one to save a client an array length is how {@code shared}
 * acquires a feature.
 *
 * <p>Putting a {@code total} on the two list endpoints instead was the other candidate and
 * is worse in a way that only shows on the archive. The backed list drops what the reader
 * may not see — a campaign trust and safety has stopped, and a pledge the backer asked to
 * keep anonymous (§4.5's PL-12) — and a count that included them would be a number sitting
 * above a shorter list, which is the profile telling the reader that something is being
 * withheld from them. Reproducing every one of those exclusions in a second query is two
 * statements of one rule, and the one that falls behind is the one nobody reads. So the
 * lists are the count: what a client can show is what it was given.
 */
@Service
public class PublicProfiles {

    private final UserRepository users;
    private final ProfileLocations locations;
    private final ProfileEditing profiles;

    /**
     * <p><strong>{@link ProfileEditing} is injected for one method and that is on purpose.</strong>
     * A public profile shows §4.2's P-03 links and the owner's editor writes them, and the
     * one thing both need is "this account's links, in order". Reading them here through a
     * second copy of that query is how a rule — the ordering, and one day whatever it grows
     * into — comes to be honoured on one of the two surfaces. It is the same argument this
     * class makes about itself for {@link ProfileVisibility}, one table down.
     */
    public PublicProfiles(UserRepository users, ProfileLocations locations, ProfileEditing profiles) {
        this.users = users;
        this.locations = locations;
        this.profiles = profiles;
    }

    /**
     * The account behind a public profile path, if a stranger may see it.
     *
     * <p>Loading and checking are one call, as in {@code PublicProjects}: a method that
     * only answered {@code boolean} would leave the load in the callers, and one of the
     * three callers is in another module and would eventually load a profile and forget to
     * ask.
     *
     * <p><strong>The entity is not returned</strong>, for the reason {@link UserAccount}
     * gives about itself: it is a live JPA instance and every column on {@code users} is
     * one field-mapping mistake away from a public page. {@link PublicProfile} is the
     * shape §4.2 asks for and has nowhere to put an address.
     *
     * @param slug the profile's half of its URL. A null or blank one is not found rather
     *     than rejected — it reaches here only from a path that did not match, and a 400
     *     would distinguish a malformed request from a missing profile for no benefit
     * @throws ProfileNotFoundException for a slug nobody holds, for one whose account
     *     §17.4 has anonymised, and for one whose owner chose {@link ProfileVisibility#PRIVATE}
     *     — identically, on purpose
     */
    @Transactional(readOnly = true)
    public PublicProfile requireVisible(String slug) {
        if (slug == null || slug.isBlank()) {
            throw new ProfileNotFoundException(slug);
        }

        // Excludes soft-deleted rows, like every finder in this repository, which is what
        // makes the anonymised case fall out here rather than needing its own check: §17.4
        // stamps deleted_at at the same moment it overwrites the name.
        User account = users.findBySlugAndDeletedAtIsNull(slug).orElseThrow(() -> new ProfileNotFoundException(slug));

        if (account.getProfileVisibility() != ProfileVisibility.PUBLIC) {
            throw new ProfileNotFoundException(slug);
        }
        return new PublicProfile(
                account.getId(),
                account.getSlug(),
                account.getName(),
                account.getAvatarUrl(),
                account.getBio(),
                account.getCreatedAt(),
                account.getWebsiteUrl(),
                locations.findById(account.getLocationId()).orElse(null),
                profiles.socialLinksOf(account.getId()));
    }

    /**
     * The names a stranger may see beside things these accounts wrote — #255, for the
     * comments on a campaign page.
     *
     * <p><strong>The same rule as {@link #requireVisible}, applied to a batch.</strong> An
     * account that chose {@link ProfileVisibility#PRIVATE}, and one §17.4 has anonymised,
     * is simply absent from the answer, and the caller draws no name for it. A comment is
     * a public page too, and a private profile whose name still appeared under every
     * comment its owner wrote would be a setting honoured on one surface out of two —
     * the failure this class exists to prevent.
     *
     * <p>One query for the page, not one per row: the caller is a list.
     *
     * @return the visible accounts among {@code accountIds}, keyed by identifier
     */
    @Transactional(readOnly = true)
    public Map<UUID, PublicName> publicNames(Collection<UUID> accountIds) {
        if (accountIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, PublicName> names = new LinkedHashMap<>();
        for (User account : users.findAllByIdInAndDeletedAtIsNull(accountIds)) {
            if (account.getProfileVisibility() == ProfileVisibility.PUBLIC) {
                names.put(account.getId(), new PublicName(account.getName(), account.getAvatarUrl()));
            }
        }
        return names;
    }

    /**
     * P-07's control: turns the profile page on or off.
     *
     * <p><strong>Idempotent, and it is worth saying why that is not merely convenient.</strong>
     * Setting the value it already holds does nothing and reports success, so a client that
     * retries after a dropped connection, or a second tab that submits the switch again,
     * leaves the account where the user put it. A refusal would make the safe direction —
     * turning the page <em>off</em> — the one that can fail on a retry.
     *
     * <p>No audit row. {@code AuditLog} records privileged actions taken over an account,
     * and this is the account's owner changing a preference about their own page; the
     * deletion endpoints beside it are audited because they destroy data on a schedule and
     * an appeal has to be readable afterwards. A visibility flip destroys nothing and is
     * reversible by the person who made it in the same request they made it with.
     *
     * @throws AccountNotFoundException for a genuine token whose account is no longer
     *     there — deleted between issue and use. The token is ours and the account is not,
     *     which is 404 rather than 401, the same answer {@code GET /v1/me} gives
     */
    @Transactional
    public void setVisibility(UUID accountId, ProfileVisibility visibility) {
        User account = users.findByIdAndDeletedAtIsNull(accountId)
                .orElseThrow(() -> new AccountNotFoundException(accountId));
        // Through the entity's setter rather than an UPDATE, so that the null check the
        // domain makes is the one that runs -- users_profile_visibility_known would refuse
        // the same value one layer down, as a 500.
        account.setProfileVisibility(visibility);
    }
}
