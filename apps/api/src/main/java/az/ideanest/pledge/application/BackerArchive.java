package az.ideanest.pledge.application;

import az.ideanest.pledge.domain.PledgeState;
import az.ideanest.pledge.infrastructure.BackerArchiveRows;
import az.ideanest.project.application.ProfileCampaign;
import az.ideanest.project.application.ProfileCampaigns;
import az.ideanest.reward.application.RewardTitles;
import az.ideanest.user.application.ProfileNotFoundException;
import az.ideanest.user.application.PublicProfile;
import az.ideanest.user.application.PublicProfiles;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What somebody has backed — §4.2's P-04 archive (#274), and §4.8's own pledge list (#287).
 *
 * <p><strong>Two lists over one table, and they are not the same list.</strong> One is
 * public and is somebody else's page; the other is behind a bearer token and is the
 * caller's own. Everything that differs between them is a privacy rule, and each of them is
 * stated once, here:
 *
 * <ul>
 *   <li><strong>No amounts on the archive.</strong> §4.2's P-04 makes the backed tab a list
 *       of campaigns and never a list of pledges. How much somebody gave is between them,
 *       the creator and the platform, and a profile page that published it would let anyone
 *       who could guess a slug read a stranger's spending. The guarantee is structural
 *       rather than remembered: {@link #backedBy} returns
 *       {@link ProfileCampaign} — the same card the created tab renders — and there is
 *       nowhere in it for a number to go. {@code PublicBacker} takes the same shape for
 *       PL-12, and says why that is stronger than filtering.
 *   <li><strong>Anonymous pledges are absent from the archive.</strong> §4.5's PL-12, and it
 *       is applied in the statement rather than after it — see {@code BackerArchiveRows}.
 *       A backer who asked not to be named on a campaign has not agreed to be named on
 *       their own profile instead, which is the same page, one link away.
 *   <li><strong>Only the states that are a backing.</strong> {@link PublicBackers#COUNTED},
 *       reused rather than restated: a draft is a five-minute reservation (§4.5's PL-13),
 *       and an archive that counted one would list a campaign somebody opened a checkout on
 *       and wandered away from. The backer's <em>own</em> list has no state filter at all,
 *       because the pledge they cancelled and the one whose card was refused are exactly
 *       what they opened that screen to find.
 *   <li><strong>Only campaigns a stranger may see.</strong> Applied by the project module,
 *       which owns the states — see below.
 * </ul>
 *
 * <h2>Three modules answer one page, and none of them reads another's table</h2>
 *
 * <p>This service holds identifiers and asks:
 *
 * <ul>
 *   <li>{@link PublicProfiles} whether there is a profile at this slug at all. §4.2's P-07
 *       withdraws the page <em>and its archives</em>, so a backed tab that answered 200 for
 *       an account whose page answers 404 would publish through a second URL what the first
 *       withholds. {@code users} is not this module's table and the setting is not this
 *       module's to interpret.
 *   <li>{@link ProfileCampaigns} what those campaigns are. {@code projects} is the project
 *       module's; {@code SavedListResponse} names reading it from outside as the reason its
 *       own response has no cover image and refuses to close the gap that way. It also
 *       applies §6.1's nine public states, which is the fourth rule above and belongs where
 *       the vocabulary is.
 *   <li>{@link RewardTitles} what a tier is called, for the backer's own list only.
 *       {@code reward_tiers} is the reward module's, and {@code BackerListRepository} makes
 *       this exact argument about the creator's report three files away.
 * </ul>
 *
 * <p>Three extra reads per page, each bounded by the page size rather than by anything the
 * caller controls. That is what the module boundary costs and it is the price named in each
 * of those three files.
 *
 * <h2>Why the archive's page can come back short</h2>
 *
 * <p>The cursor advances over {@code pledges} and the cards are filtered over
 * {@code projects}, so a page of twenty pledges yields at most twenty cards and sometimes
 * fewer — a campaign trust and safety has suspended is dropped, and so is one whose creator
 * has left. That is deliberate. Backfilling to a full page would mean reading further into
 * the pledge list on every request, which makes the cost of a page depend on how many
 * campaigns somebody backed that were later withdrawn, and makes the cursor's meaning
 * depend on the filter's outcome. A short page with a cursor is a correct page; the client
 * asks for the next one, exactly as it would have anyway.
 */
@Service
public class BackerArchive {

    /**
     * How many rows a page holds when the client does not say.
     *
     * <p>Twenty, matching {@code ProfileCampaigns} and {@code ProjectUpdateService}. The two
     * lists share it because they are rendered on facing tabs of one page, and a created tab
     * that paged in twenties beside a backed tab that paged in tens would look like a bug.
     */
    private static final int DEFAULT_PAGE_SIZE = 20;

    /** The ceiling, whatever a client asks for. Clamped rather than refused. */
    private static final int MAX_PAGE_SIZE = 50;

    /**
     * §6.2's states in which a pledge is somebody having backed a campaign, by name.
     *
     * <p>Derived from {@link PublicBackers#COUNTED} rather than written out. That set is
     * where the rule is argued — {@code DRAFT} is out because it is a reservation —
     * and a second literal here would be the copy that falls behind. The archive and the
     * public backer count must answer the same question, or a campaign's page and a backer's
     * page disagree about whether that person backed it.
     *
     * <p>As names because the comparison happens in SQL against {@code pledges.state}, which
     * is text.
     */
    private static final Set<String> BACKED_STATES =
            PublicBackers.COUNTED.stream().map(PledgeState::name).collect(Collectors.toUnmodifiableSet());

    private final BackerArchiveRows rows;
    private final PublicProfiles profiles;
    private final ProfileCampaigns campaigns;
    private final RewardTitles rewards;

    public BackerArchive(
            BackerArchiveRows rows, PublicProfiles profiles, ProfileCampaigns campaigns, RewardTitles rewards) {

        this.rows = rows;
        this.profiles = profiles;
        this.campaigns = campaigns;
        this.rewards = rewards;
    }

    /**
     * One page of the campaigns this account has publicly backed — §4.2's backed tab.
     *
     * <p>The profile is resolved first and its absence is the whole of the authorisation.
     *
     * <p><strong>An empty page is not a 404.</strong> Somebody who has backed nothing, and
     * somebody every one of whose pledges was anonymous, both have a profile and an empty
     * tab. Answering 404 for the second would turn the empty tab into a statement about
     * what they had chosen to hide.
     *
     * @throws ProfileNotFoundException for a slug nobody holds, an account §17.4 has
     *     anonymised, and one whose owner chose {@code PRIVATE} — identically
     */
    @Transactional(readOnly = true)
    public BackedPage backedBy(String slug, BackerCursor cursor, Integer limit) {
        PublicProfile profile = profiles.requireVisible(slug);
        int pageSize = pageSizeOf(limit);

        // One more than the page, which answers "is there another" without a second COUNT
        // over the same predicate -- and without the count and the list being able to
        // disagree about a pledge cancelled between the two statements.
        List<BackerArchiveRows.BackedProject> backed =
                rows.backedBy(profile.id(), BACKED_STATES, cursor, pageSize + 1);

        boolean more = backed.size() > pageSize;
        List<BackerArchiveRows.BackedProject> page = more ? backed.subList(0, pageSize) : backed;

        // The cursor is taken from the pledge list before the campaigns are filtered, and
        // that is the whole reason a short page is correct: paging is over pledges, and a
        // campaign the reader may not see is a row that was there and was not shown.
        BackerCursor next = more ? cursorAfter(page) : null;

        List<UUID> projectIds = page.stream()
                .map(BackerArchiveRows.BackedProject::projectId)
                .toList();
        return new BackedPage(campaigns.publiclyVisible(projectIds), next);
    }

    /**
     * One page of the caller's own pledges, newest first — §4.8's list.
     *
     * <p><strong>The account comes from the caller's token and never from a parameter</strong>,
     * which is enforced by this method taking an identifier that the controller reads from
     * the signature we made. There is no slug form of this read and there must not be: the
     * public archive is the slug-addressed one, and it is a different list precisely because
     * it is somebody else's.
     *
     * <p>Every state, and the campaign in whatever state it is in — see the class comment
     * and {@link ProfileCampaigns#ofAnyState}. A backer whose campaign was suspended still
     * has a pledge on it, and blanking the campaign would leave them holding a row about
     * nothing at the moment they most need to know what happened.
     */
    @Transactional(readOnly = true)
    public PledgePage pledgesOf(UUID backerId, BackerCursor cursor, Integer limit) {
        int pageSize = pageSizeOf(limit);
        List<BackerPledge> found = rows.pledgesOf(backerId, cursor, pageSize + 1);

        boolean more = found.size() > pageSize;
        List<BackerPledge> page = more ? found.subList(0, pageSize) : found;
        BackerPledge last = page.isEmpty() ? null : page.get(page.size() - 1);
        BackerCursor next = more && last != null ? new BackerCursor(last.createdAt(), last.id()) : null;

        Map<UUID, ProfileCampaign> byProject = campaigns
                .ofAnyState(page.stream().map(BackerPledge::projectId).toList())
                .stream()
                .collect(Collectors.toMap(ProfileCampaign::id, campaign -> campaign));

        Map<UUID, RewardTitles.RewardTitle> titles = rewards.titlesOfTiers(page.stream()
                .map(BackerPledge::rewardTierId)
                .filter(Objects::nonNull)
                .toList());

        List<PledgeEntry> entries = new ArrayList<>(page.size());
        for (BackerPledge pledge : page) {
            RewardTitles.RewardTitle tier = pledge.rewardTierId() == null ? null : titles.get(pledge.rewardTierId());
            entries.add(new PledgeEntry(
                    pledge,
                    // Null when the campaign row is gone. Not an error: a pledge outliving
                    // its campaign is the same ordinary case ProjectSummaries names, and a
                    // page of pledges must not fail because one of them has nothing to point
                    // at.
                    byProject.get(pledge.projectId()),
                    tier == null ? null : tier.title()));
        }
        return new PledgePage(entries, next);
    }

    /** The bottom row of the page just built, as the key to the one after it. */
    private static BackerCursor cursorAfter(List<BackerArchiveRows.BackedProject> page) {
        if (page.isEmpty()) {
            return null;
        }
        BackerArchiveRows.BackedProject last = page.get(page.size() - 1);
        return new BackerCursor(last.createdAt(), last.pledgeId());
    }

    private static int pageSizeOf(Integer limit) {
        if (limit == null || limit < 1) {
            return DEFAULT_PAGE_SIZE;
        }
        return Math.min(limit, MAX_PAGE_SIZE);
    }

    /**
     * One page of somebody's public backed archive.
     *
     * @param campaigns the cards, newest pledge first, and never more than were asked for.
     *     Possibly fewer — see the class comment
     * @param next where the following page starts, or null when this is the last. Over
     *     pledges rather than over campaigns, which is why it can be non-null on a page that
     *     came back short
     */
    public record BackedPage(List<ProfileCampaign> campaigns, BackerCursor next) {

        public BackedPage {
            campaigns = List.copyOf(campaigns);
        }
    }

    /**
     * One page of a backer's own pledges.
     *
     * @param next null on the last page rather than absent, for {@code SavedListResponse}'s
     *     reason: a client tests one thing
     */
    public record PledgePage(List<PledgeEntry> pledges, BackerCursor next) {

        public PledgePage {
            pledges = List.copyOf(pledges);
        }
    }

    /**
     * A pledge, the campaign it is on, and what its tier is called.
     *
     * <p>Three modules' answers joined in memory rather than in a statement, which is what
     * the boundary buys and what {@code BackerReportService} already does with two of them.
     *
     * @param campaign null when the campaign row no longer exists. A client renders the
     *     pledge without a link rather than dropping it: it is the backer's money, and it is
     *     still theirs when the thing they backed has been removed
     * @param rewardTitle null on §4.5's PL-02, support with no reward, and also on a tier
     *     the campaign has since deleted — which is indistinguishable to a reader and is
     *     deliberately not distinguished here
     */
    public record PledgeEntry(BackerPledge pledge, ProfileCampaign campaign, String rewardTitle) {
    }
}
