package az.ideanest.project.application;

import az.ideanest.project.domain.Capability;
import az.ideanest.project.domain.Project;
import az.ideanest.project.domain.ProjectEditLocks;
import az.ideanest.project.domain.ProjectRevision;
import az.ideanest.project.domain.RevisionContent;
import az.ideanest.project.domain.RevisionStatus;
import az.ideanest.project.infrastructure.ProjectRepository;
import az.ideanest.project.infrastructure.ProjectRevisionRepository;
import az.ideanest.shared.money.Money;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.UnaryOperator;
import java.util.stream.Collectors;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * A launched campaign's writing is edited in a revision and published by a moderator (#558).
 *
 * <p>Once the public has seen a campaign, an edit to its title, summary, story, risks, cover,
 * video, countries or category is not written to {@code projects}. It goes into the one open
 * revision, which the creator keeps working on, submits, and may discard; the public page shows
 * the last approved version until a moderator applies it. The fields §5.3 freezes are not part
 * of it and are refused as before.
 *
 * <p><strong>The editor is handed a copy of the campaign.</strong> {@link #workingCopy} detaches
 * the entity and writes the draft onto it, so the editing code that validates and assigns fields
 * runs unchanged and nothing it assigns is flushed. {@link #stage} then reads the result back
 * into the revision. The entity must not be used as the campaign after that.
 *
 * <p><strong>Every change to the reward tiers goes into the same revision (#559, #569).</strong>
 * An approved tier's new state is staged by {@link #stageReward}, a deletion or a new order by
 * {@link #stageRewards}, and all of it is read back by {@link #heldRewards}; the tier keeps what
 * the public sees until approval. A tier created after launch is a row the public does not see,
 * and {@link #touchRewards} keeps the revision naming it. {@link #publishRewards} applies the
 * lot on approval, and a refusal or a discard deletes the created rows. The tier's price and
 * its counts are not held: the price is frozen and the counts are backers'.
 *
 * <p><strong>And so does every change to an item a backer can see, and to the shipping regions
 * (#587).</strong> {@link #stageItem} holds an item's proposed state, {@link #stageZones} the
 * regions as a whole; {@link #publishCatalogue} applies both on approval, before the tiers.
 * Nothing about either is a row until then, so a refusal or a discard has nothing to delete.
 */
@Service
public class ProjectRevisionService {

    /** What a moderator is told happened to a tier. */
    public static final String CREATED = "created";

    public static final String DELETED = "deleted";
    public static final String REORDERED = "reordered";
    public static final String CHANGED = "changed";

    private static final ObjectMapper JSON = new ObjectMapper();

    private final ProjectRevisionRepository revisions;
    private final ProjectRepository projects;
    private final ProjectAccess access;
    private final RewardWritings rewardWritings;
    private final EntityManager entityManager;
    private final Clock clock;

    public ProjectRevisionService(
            ProjectRevisionRepository revisions,
            ProjectRepository projects,
            ProjectAccess access,
            RewardWritings rewardWritings,
            EntityManager entityManager,
            Clock clock) {
        this.revisions = revisions;
        this.projects = projects;
        this.access = access;
        this.rewardWritings = rewardWritings;
        this.entityManager = entityManager;
        this.clock = clock;
    }

    /** What the editor needs to know about the revision a campaign has open. */
    public record Summary(
            UUID id, RevisionStatus status, List<String> changedFields, Instant submittedAt, Instant updatedAt) {}

    /** The refusal a moderator gave to the creator's latest revision. */
    public record Rejection(UUID id, String reason, Instant decidedAt) {}

    /**
     * One reward tier a revision touches, as the public sees it and as proposed.
     *
     * @param changes {@link #CREATED}, {@link #DELETED}, or one or both of {@link #CHANGED}
     *     and {@link #REORDERED}
     * @param livePosition where the public sees it now, or null for a created tier
     * @param proposedPosition where it would be, or null for a deleted tier
     * @param live null for a created tier
     * @param proposed null for a deleted tier
     * @param changedFields what {@link RewardWriting#changedFrom} names, for a changed tier
     */
    public record RewardChange(
            UUID rewardId,
            List<String> changes,
            Integer livePosition,
            Integer proposedPosition,
            Money price,
            RewardWriting live,
            RewardWriting proposed,
            List<String> changedFields) {}

    /**
     * The campaign as its creator is editing it: the entity itself for a campaign nobody has
     * seen, and a detached copy with the open draft written onto it for one they have.
     */
    @Transactional
    public Project workingCopy(Project project) {
        if (!ProjectEditLocks.isLaunched(project.getState())) {
            return project;
        }
        entityManager.detach(project);
        revisions.findOpenByProjectId(project.getId()).ifPresent(open -> contentOf(open).copyOnto(project));
        return project;
    }

    /**
     * Keeps what the creator has made of the working copy as the open revision.
     *
     * <p>A copy that has come back to what the campaign shows closes the revision instead: an
     * unsent draft is deleted and a submitted one is withdrawn, so a moderator is never asked to
     * approve nothing.
     */
    @Transactional
    public void stage(Project workingCopy, UUID authorId) {
        Project live = projects.findByIdForUpdate(workingCopy.getId())
                .orElseThrow(() -> new ProjectNotFoundException(workingCopy.getId()));
        Optional<ProjectRevision> open = openAfterLock(live.getId());
        RevisionContent proposed = RevisionContent.of(workingCopy, storyOf(workingCopy), Map.of(), Map.of(), null);
        if (open.isPresent()) {
            proposed = proposed.withRewardsOf(contentOf(open.get()));
        }

        keep(live, liveContent(live), open, proposed, authorId);
    }

    /**
     * Locks the campaign before a change to a launched campaign's tiers writes a row, so that
     * the write and the revision that names it are serialised against approval and against the
     * creator's other saves, and taken in the same order by all of them.
     */
    @Transactional
    public void lockForRewards(UUID projectId) {
        projects.findByIdForUpdate(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));
    }

    /**
     * Applies an edit to one approved reward tier's proposed state in the open revision, opening
     * one if there is none, and answers the state the tier now has in it.
     *
     * <p>{@code edit} is given the tier as the revision holds it, or as the tier shows it, read
     * after the campaign is locked, so two editors saving different fields of one tier do not
     * undo each other. It validates as it goes and may throw. An edit that changes nothing
     * leaves the revision alone, so an autosave does not take a submitted revision back to a
     * draft.
     */
    @Transactional
    public RewardWriting stageReward(UUID projectId, UUID rewardId, UUID authorId, UnaryOperator<RewardWriting> edit) {
        Project live = projects.findByIdForUpdate(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));
        Optional<ProjectRevision> open = openAfterLock(projectId);
        RevisionContent liveContent = liveContent(live);
        RevisionContent.Reward shown = liveContent.rewards().get(rewardId);
        if (shown == null) {
            throw new IllegalStateException("Reward " + rewardId + " is not an approved tier of project " + projectId);
        }

        RevisionContent current = open.map(this::contentOf).orElse(liveContent).heldAgainst(liveContent);
        RewardWriting before = RewardWriting.of(current.rewards().getOrDefault(rewardId, shown));
        RewardWriting after = edit.apply(before);
        if (!after.equals(before)) {
            keep(live, liveContent, open, current.withReward(rewardId, after.held()), authorId);
        }
        return after;
    }

    /**
     * Applies an edit to what the open revision holds about the campaign's tiers as a whole — a
     * deletion, its undoing, a new order — opening a revision if there is none. Read and kept
     * as {@link #stageReward} does, and left alone when the edit changes nothing.
     */
    @Transactional
    public HeldRewards stageRewards(UUID projectId, UUID authorId, UnaryOperator<HeldRewards> edit) {
        Project live = projects.findByIdForUpdate(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));
        Optional<ProjectRevision> open = openAfterLock(projectId);
        RevisionContent liveContent = liveContent(live);

        RevisionContent current = open.map(this::contentOf).orElse(liveContent).heldAgainst(liveContent);
        HeldRewards before = heldOf(current);
        HeldRewards after = edit.apply(before);
        if (!after.equals(before)) {
            Map<UUID, RevisionContent.Reward> changed = new LinkedHashMap<>();
            after.changed().forEach((rewardId, writing) -> changed.put(rewardId, writing.held()));
            keep(
                    live,
                    liveContent,
                    open,
                    current.withRewardChanges(changed, after.deleted(), current.createdRewards(), after.order()),
                    authorId);
        }
        return after;
    }

    /**
     * Keeps the open revision in step after a tier created on the launched campaign was
     * created, changed or deleted: the tier is the row itself, so the revision has nothing of
     * it to hold but its name, and a submitted revision goes back to a draft because what a
     * moderator would approve has changed. A revision left with nothing is closed.
     */
    @Transactional
    public void touchRewards(UUID projectId, UUID authorId) {
        Project live = projects.findByIdForUpdate(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));
        Optional<ProjectRevision> open = openAfterLock(projectId);
        RevisionContent liveContent = liveContent(live);
        keep(live, liveContent, open, open.map(this::contentOf).orElse(liveContent), authorId);
    }

    /**
     * Takes the campaign's row lock until the caller's transaction ends (#587), for a caller that
     * has to ask what the public sees of the campaign's catalogue before deciding where an edit
     * goes. A moderator's decision on the revision takes the same lock, so what the caller reads
     * after this is not overtaken by an approval before it writes.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void lockCampaign(UUID projectId) {
        projects.findByIdForUpdate(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));
    }

    /**
     * Applies an edit to one public item's proposed state in the open revision, opening one if
     * there is none, and answers the state the item now has in it (#587). Read and kept as
     * {@link #stageReward} does: {@code edit} is given the item as the revision holds it, or as
     * it shows, and validates as it goes; an edit that changes nothing leaves the revision alone.
     *
     * @throws IllegalStateException when no approved tier contains the item, which the caller
     *     asks first, under {@link #lockCampaign}: an item the public cannot see is written directly
     */
    @Transactional
    public CatalogueWriting.Item stageItem(
            UUID projectId, UUID itemId, UUID authorId, UnaryOperator<CatalogueWriting.Item> edit) {
        Project live = projects.findByIdForUpdate(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));
        Optional<ProjectRevision> open = openAfterLock(projectId);
        RevisionContent liveContent = liveContent(live);
        RevisionContent.Item shown = liveContent.items().get(itemId);
        if (shown == null) {
            throw new IllegalStateException("Item " + itemId + " is not in an approved tier of project " + projectId);
        }

        RevisionContent current = open.map(this::contentOf).orElse(liveContent).heldAgainst(liveContent);
        CatalogueWriting.Item before = CatalogueWriting.Item.of(current.items().getOrDefault(itemId, shown));
        CatalogueWriting.Item after = edit.apply(before);
        if (!after.equals(before)) {
            keep(live, liveContent, open, current.withItem(itemId, after.held()), authorId);
        }
        return after;
    }

    /**
     * Applies an edit to the campaign's shipping regions as a whole in the open revision, opening
     * one if there is none, and answers the regions the revision now proposes (#587).
     * {@code edit} is given the regions as the revision proposes them, or as they are.
     */
    @Transactional
    public List<CatalogueWriting.Zone> stageZones(
            UUID projectId, UUID authorId, UnaryOperator<List<CatalogueWriting.Zone>> edit) {
        Project live = projects.findByIdForUpdate(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));
        Optional<ProjectRevision> open = openAfterLock(projectId);
        RevisionContent liveContent = liveContent(live);

        RevisionContent current = open.map(this::contentOf).orElse(liveContent).heldAgainst(liveContent);
        List<CatalogueWriting.Zone> before = zonesOf(
                current.shippingZones() == null ? liveContent.shippingZones() : current.shippingZones());
        List<CatalogueWriting.Zone> after = zonesOf(
                edit.apply(before).stream().map(CatalogueWriting.Zone::held).toList());
        if (!after.equals(before)) {
            keep(
                    live,
                    liveContent,
                    open,
                    current.withShippingZones(after.stream().map(CatalogueWriting.Zone::held).toList()),
                    authorId);
        }
        return after;
    }

    /** What the open revision proposes for the campaign's public items, by item (#587). Empty when nothing is open. */
    @Transactional(readOnly = true)
    public Map<UUID, CatalogueWriting.Item> heldItems(UUID projectId) {
        Map<UUID, CatalogueWriting.Item> held = new LinkedHashMap<>();
        revisions.findOpenByProjectId(projectId)
                .flatMap(open -> projects.findById(projectId)
                        .map(live -> contentOf(open).heldAgainst(liveContent(live))))
                .ifPresent(content -> content.items()
                        .forEach((itemId, item) -> held.put(itemId, CatalogueWriting.Item.of(item))));
        return held;
    }

    /** The shipping regions the open revision proposes, when it proposes any (#587). */
    @Transactional(readOnly = true)
    public Optional<List<CatalogueWriting.Zone>> heldZones(UUID projectId) {
        return revisions.findOpenByProjectId(projectId)
                .flatMap(open -> projects.findById(projectId)
                        .map(live -> contentOf(open).heldAgainst(liveContent(live))))
                .map(RevisionContent::shippingZones)
                .map(ProjectRevisionService::zonesOf);
    }

    /** One public item a revision changes, as the public sees it and as proposed (#587). */
    public record ItemChange(UUID itemId, CatalogueWriting.Item live, CatalogueWriting.Item proposed, List<String> changedFields) {}

    /** The shipping regions a revision proposes, beside the ones the campaign has (#587). */
    public record ZoneChange(List<CatalogueWriting.Zone> live, List<CatalogueWriting.Zone> proposed) {}

    /** Every public item a revision changes, in the order the campaign has them. */
    public List<ItemChange> itemChanges(RevisionContent proposed, RevisionContent live) {
        RevisionContent held = proposed.heldAgainst(live);
        return held.changedItemsFrom(live).stream()
                .map(itemId -> {
                    CatalogueWriting.Item shown = CatalogueWriting.Item.of(live.items().get(itemId));
                    CatalogueWriting.Item wanted = CatalogueWriting.Item.of(held.items().get(itemId));
                    return new ItemChange(itemId, shown, wanted, wanted.changedFrom(shown));
                })
                .toList();
    }

    /** The regions a revision proposes, or empty when it leaves them alone. */
    public Optional<ZoneChange> zoneChange(RevisionContent proposed, RevisionContent live) {
        RevisionContent held = proposed.heldAgainst(live);
        if (held.shippingZones() == null) {
            return Optional.empty();
        }
        return Optional.of(new ZoneChange(zonesOf(live.shippingZones()), zonesOf(held.shippingZones())));
    }

    /**
     * Applies an approved revision's items and shipping regions. Part of approving it, and
     * before {@link #publishRewards}, so a tier rate for a region created here finds it.
     */
    public void publishCatalogue(UUID projectId, RevisionContent approved, RevisionContent live) {
        RevisionContent held = approved.heldAgainst(live);
        Map<UUID, CatalogueWriting.Item> items = new LinkedHashMap<>();
        held.items().forEach((itemId, item) -> items.put(itemId, CatalogueWriting.Item.of(item)));
        List<CatalogueWriting.Zone> zones = held.shippingZones() == null ? null : zonesOf(held.shippingZones());
        if (!items.isEmpty() || zones != null) {
            rewardWritings.publishCatalogue(projectId, items, zones);
        }
    }

    /** What the open revision holds about the campaign's tiers. {@link HeldRewards#NONE} when nothing is open. */
    @Transactional(readOnly = true)
    public HeldRewards heldRewards(UUID projectId) {
        return revisions.findOpenByProjectId(projectId)
                .flatMap(open -> projects.findById(projectId)
                        .map(live -> heldOf(contentOf(open).heldAgainst(liveContent(live)))))
                .orElse(HeldRewards.NONE);
    }

    /**
     * Every tier a revision would create, delete, move or change, beside what it shows now:
     * the kept and created ones in the order proposed, and then the deleted ones.
     *
     * <p>A tier counts as moved when its place among the approved tiers that stay is not the
     * place it has now, so creating a tier in the middle of the list moves nothing else.
     */
    public List<RewardChange> rewardChanges(UUID projectId, RevisionContent proposed, RevisionContent live) {
        RevisionContent held = proposed.heldAgainst(live);
        Map<UUID, RewardWritings.Tier> liveTiers = byId(rewardWritings.liveTiersOf(projectId));
        Map<UUID, RewardWritings.Tier> createdTiers = byId(rewardWritings.createdTiersOf(projectId));

        List<UUID> liveOrder = List.copyOf(live.rewards().keySet());
        List<UUID> proposedOrder = held.proposedRewardOrder(live).stream()
                .filter(id -> live.rewards().containsKey(id) || createdTiers.containsKey(id))
                .toList();
        List<UUID> kept = liveOrder.stream().filter(proposedOrder::contains).toList();
        List<UUID> keptProposed = proposedOrder.stream().filter(kept::contains).toList();

        List<RewardChange> changes = new ArrayList<>();
        for (UUID rewardId : proposedOrder) {
            RewardWritings.Tier created = createdTiers.get(rewardId);
            if (created != null) {
                changes.add(new RewardChange(
                        rewardId,
                        List.of(CREATED),
                        null,
                        proposedOrder.indexOf(rewardId),
                        created.price(),
                        null,
                        created.writing(),
                        List.of()));
                continue;
            }
            RewardWriting shown = RewardWriting.of(live.rewards().get(rewardId));
            RevisionContent.Reward entry = held.rewards().get(rewardId);
            RewardWriting wanted = entry == null ? shown : RewardWriting.of(entry);
            List<String> fields = wanted.changedFrom(shown);
            List<String> kinds = new ArrayList<>();
            if (!fields.isEmpty()) {
                kinds.add(CHANGED);
            }
            if (kept.indexOf(rewardId) != keptProposed.indexOf(rewardId)) {
                kinds.add(REORDERED);
            }
            if (!kinds.isEmpty()) {
                changes.add(new RewardChange(
                        rewardId,
                        List.copyOf(kinds),
                        liveOrder.indexOf(rewardId),
                        proposedOrder.indexOf(rewardId),
                        priceOf(liveTiers.get(rewardId)),
                        shown,
                        wanted,
                        fields));
            }
        }
        for (UUID rewardId : held.deletedRewardsFrom(live)) {
            changes.add(new RewardChange(
                    rewardId,
                    List.of(DELETED),
                    liveOrder.indexOf(rewardId),
                    null,
                    priceOf(liveTiers.get(rewardId)),
                    RewardWriting.of(live.rewards().get(rewardId)),
                    null,
                    List.of()));
        }
        return List.copyOf(changes);
    }

    /** The names of the campaign's items and shipping zones, which a tier's lines name by identifier. */
    public Map<UUID, String> rewardNames(UUID projectId) {
        return rewardWritings.namesOf(projectId);
    }

    /**
     * Applies an approved revision to the campaign's tiers. Part of approving it.
     *
     * @return the tiers it deleted that are kept because somebody has backed them since
     */
    public List<UUID> publishRewards(UUID projectId, RevisionContent approved, RevisionContent live) {
        RevisionContent held = approved.heldAgainst(live);
        HeldRewards rewards = heldOf(held);
        if (rewards.isEmpty()) {
            return List.of();
        }
        HeldRewards ordered = new HeldRewards(
                rewards.changed(),
                rewards.deleted(),
                rewards.created(),
                held.rewardOrder() == null ? null : held.proposedRewardOrder(live));
        return rewardWritings.publish(projectId, ordered);
    }

    /** Deletes the tiers created for a revision that will not be approved. Part of refusing it. */
    public void discardRewards(UUID projectId) {
        rewardWritings.discardCreated(projectId);
    }

    /**
     * The open revision, read again now that the campaign is locked: the editor may have loaded
     * it earlier in this transaction, before another save committed.
     */
    private Optional<ProjectRevision> openAfterLock(UUID projectId) {
        Optional<ProjectRevision> open = revisions.findOpenByProjectId(projectId);
        open.ifPresent(entityManager::refresh);
        return open;
    }

    /**
     * Keeps {@code proposed} as the open revision, or closes the revision when it has come back
     * to what the campaign shows: an unsent draft is deleted and a submitted one is withdrawn,
     * so a moderator is never asked to approve nothing.
     *
     * <p>The tiers it names as created are read here, from the rows that wait for it, rather
     * than trusted from the caller: a created tier is created and deleted as a row, and the
     * revision is what has to keep up with it.
     */
    private void keep(
            Project live,
            RevisionContent liveContent,
            Optional<ProjectRevision> open,
            RevisionContent proposed,
            UUID authorId) {
        List<UUID> created = rewardWritings.createdTiersOf(live.getId()).stream()
                .map(RewardWritings.Tier::id)
                .toList();
        RevisionContent held = proposed.withCreatedRewards(created).heldAgainst(liveContent);
        if (held.changedFrom(liveContent).isEmpty()) {
            open.ifPresent(revision -> {
                if (revision.getStatus() == RevisionStatus.DRAFT) {
                    revisions.delete(revision);
                } else {
                    revision.withdraw();
                }
            });
            return;
        }

        String content = write(held);
        if (open.isPresent()) {
            open.get().rewrite(content, authorId);
        } else {
            revisions.save(ProjectRevision.draft(live.getId(), content, authorId));
        }
    }

    /** Sends the open draft to the moderators. */
    @Transactional
    public ProjectRevision submit(UUID projectId, UUID accountId) {
        access.requireEditableForAll(projectId, accountId, Set.of(Capability.SUBMIT_FOR_REVIEW));
        ProjectRevision open = revisions.findOpenByProjectId(projectId)
                .orElseThrow(() -> new RevisionNotAvailableException(RevisionNotAvailableException.Reason.NO_OPEN_REVISION));
        if (open.getStatus() == RevisionStatus.PENDING) {
            throw new RevisionNotAvailableException(RevisionNotAvailableException.Reason.ALREADY_SUBMITTED);
        }
        // A revision whose only change was to a reward tier deleted since changes nothing.
        Project live = projects.findById(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));
        if (contentOf(open).changedFrom(liveContent(live)).isEmpty()) {
            throw new RevisionNotAvailableException(RevisionNotAvailableException.Reason.NO_CHANGES);
        }
        open.submit(clock.instant().truncatedTo(ChronoUnit.MICROS));
        return open;
    }

    /** Throws the open revision away, and the tiers created for it. The campaign is unchanged. */
    @Transactional
    public void discard(UUID projectId, UUID accountId) {
        access.requireEditable(projectId, accountId);
        lockForRewards(projectId);
        ProjectRevision open = openAfterLock(projectId)
                .orElseThrow(() -> new RevisionNotAvailableException(RevisionNotAvailableException.Reason.NO_OPEN_REVISION));
        open.withdraw();
        discardRewards(projectId);
    }

    /** The open revision, described against what the campaign shows now. */
    @Transactional(readOnly = true)
    public Optional<Summary> summaryOf(UUID projectId) {
        return revisions.findOpenByProjectId(projectId).flatMap(open -> projects.findById(projectId)
                .map(live -> new Summary(
                        open.getId(),
                        open.getStatus(),
                        contentOf(open).changedFrom(liveContent(live)),
                        open.getSubmittedAt(),
                        open.getUpdatedAt())));
    }

    /** The newest closed revision, when it was refused and nothing has been started since. */
    @Transactional(readOnly = true)
    public Optional<Rejection> latestRejection(UUID projectId) {
        if (revisions.findOpenByProjectId(projectId).isPresent()) {
            return Optional.empty();
        }
        return revisions.findHistory(projectId, PageRequest.of(0, 1)).stream()
                .filter(revision -> revision.getStatus() == RevisionStatus.REJECTED)
                .map(revision -> new Rejection(revision.getId(), revision.getReason(), revision.getDecidedAt()))
                .findFirst();
    }

    /**
     * The content a campaign shows the public now, with every approved reward tier, every item
     * one of them contains, and its shipping regions.
     */
    public RevisionContent liveContent(Project live) {
        Map<UUID, RevisionContent.Reward> rewards = new LinkedHashMap<>();
        rewardWritings.liveTiersOf(live.getId()).forEach(tier -> rewards.put(tier.id(), tier.writing().held()));
        Map<UUID, RevisionContent.Item> items = new LinkedHashMap<>();
        rewardWritings.liveItemsOf(live.getId()).forEach((itemId, item) -> items.put(itemId, item.held()));
        List<RevisionContent.Zone> zones =
                rewardWritings.liveZonesOf(live.getId()).stream().map(CatalogueWriting.Zone::held).toList();
        return RevisionContent.of(live, storyOf(live), rewards, items, zones);
    }

    /** Regions as the reward module reads them, in the order their names sort. */
    private static List<CatalogueWriting.Zone> zonesOf(List<RevisionContent.Zone> zones) {
        if (zones == null) {
            return List.of();
        }
        return zones.stream()
                .map(CatalogueWriting.Zone::of)
                .sorted(Comparator.comparing((CatalogueWriting.Zone zone) -> zone.name().toLowerCase(Locale.ROOT))
                        .thenComparing(zone -> zone.id().toString()))
                .toList();
    }

    /** What a revision read against the live content holds about the tiers. */
    private static HeldRewards heldOf(RevisionContent held) {
        Map<UUID, RewardWriting> changed = new LinkedHashMap<>();
        held.rewards().forEach((rewardId, reward) -> changed.put(rewardId, RewardWriting.of(reward)));
        return new HeldRewards(changed, held.deletedRewards(), held.createdRewards(), held.rewardOrder());
    }

    private static Map<UUID, RewardWritings.Tier> byId(List<RewardWritings.Tier> tiers) {
        return tiers.stream().collect(Collectors.toMap(RewardWritings.Tier::id, Function.identity()));
    }

    private static Money priceOf(RewardWritings.Tier tier) {
        return tier == null ? null : tier.price();
    }

    public RevisionContent contentOf(ProjectRevision revision) {
        try {
            return JSON.readValue(revision.getContent(), RevisionContent.class);
        } catch (JacksonException e) {
            throw new IllegalStateException("Revision " + revision.getId() + " holds content that cannot be read", e);
        }
    }

    private static String write(RevisionContent content) {
        try {
            return JSON.writeValueAsString(content);
        } catch (JacksonException e) {
            throw new IllegalStateException("Revision content could not be written", e);
        }
    }

    private static JsonNode storyOf(Project project) {
        if (project.getStory() == null) {
            return null;
        }
        try {
            return JSON.readTree(project.getStory());
        } catch (JacksonException e) {
            throw new IllegalStateException("Project " + project.getId() + " holds a story that is not JSON", e);
        }
    }
}
