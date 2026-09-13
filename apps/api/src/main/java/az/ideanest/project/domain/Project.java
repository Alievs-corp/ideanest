package az.ideanest.project.domain;

import az.ideanest.shared.Identifiers;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.Generated;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.generator.EventType;
import org.hibernate.type.SqlTypes;

/**
 * A campaign.
 *
 * <p><strong>There is no {@code setState}.</strong> The only way the state
 * changes is {@link #applyTransition(ProjectState, Instant)}, which refuses any
 * edge {@link ProjectStateMachine} does not allow, and the only caller of that
 * is {@code ProjectTransitionService} — which additionally writes the audit row
 * inside the same transaction. A setter would make a state change reachable from
 * anywhere, and the transitions table would then be a record of the changes
 * somebody remembered to record.
 *
 * <p>The creator, the category, and the subcategory are held as identifiers
 * rather than as associations. {@code users} belongs to another module and
 * mapping a {@code @ManyToOne} to it would reach into that module's domain,
 * which is the boundary {@code ModuleBoundaryTests} exists to keep. The
 * taxonomy is in this module, but nothing here needs a category's name, and an
 * association would load one on every editor request that only wanted to echo
 * the identifier back.
 *
 * <p>Money is {@link BigDecimal} against a {@code numeric(14,2)} column, never a
 * double. On a funding platform a rounding error is somebody's pledge.
 */
@Entity
@Table(name = "projects")
public class Project {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "creator_id", nullable = false, updatable = false)
    private UUID creatorId;

    @Column(name = "slug", nullable = false)
    private String slug;

    @Column(name = "title", nullable = false)
    private String title;

    @Column(name = "blurb")
    private String blurb;

    @Column(name = "category_id")
    private UUID categoryId;

    @Column(name = "subcategory_id")
    private UUID subcategoryId;

    @Enumerated(EnumType.STRING)
    @Column(name = "state", nullable = false)
    private ProjectState state;

    @Column(name = "goal_amount")
    private BigDecimal goalAmount;

    @Column(name = "currency", nullable = false)
    private String currency;

    /**
     * Denormalised from the pledge ledger and maintained by the pledge module.
     * Read here and never written: the ledger is the source of truth, and a
     * campaign that could adjust its own total would be a campaign that can
     * decide it succeeded.
     */
    @Generated(event = EventType.INSERT)
    @Column(name = "pledged_amount", nullable = false, insertable = false, updatable = false)
    private BigDecimal pledgedAmount;

    @Generated(event = EventType.INSERT)
    @Column(name = "backers_count", nullable = false, insertable = false, updatable = false)
    private int backersCount;

    @Column(name = "duration_days")
    private Integer durationDays;

    @Column(name = "scheduled_launch_at")
    private Instant scheduledLaunchAt;

    @Column(name = "launched_at")
    private Instant launchedAt;

    @Column(name = "deadline")
    private Instant deadline;

    /**
     * The story document, as JSON. Opaque to this module until #35, which owns
     * its schema and validates it — mapped as a string so that autosave can
     * store a draft document before that validator exists, and as {@code jsonb}
     * in the database so it can be queried and indexed without a rewrite.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "story")
    private String story;

    @Column(name = "risks")
    private String risks;

    @Column(name = "cover_image_url")
    private String coverImageUrl;

    @Column(name = "cover_image_width")
    private Integer coverImageWidth;

    @Column(name = "cover_image_height")
    private Integer coverImageHeight;

    /**
     * The uploaded file behind the three columns above, when there is one.
     *
     * <p>A plain identifier and not a JPA association, deliberately. {@code media} belongs to
     * another module and {@code ModuleBoundaryTests} refuses this one its entities; a mapped
     * relationship would also make every campaign read a join for a row that is only needed
     * when somebody wants the placeholder.
     *
     * <p>Null for every campaign that predates the pipeline and for any cover supplied as a
     * typed URL. See V61 on why the three text columns stay beside it.
     */
    @Column(name = "cover_media_id")
    private UUID coverMediaId;

    @Column(name = "late_pledge_enabled", nullable = false)
    private boolean latePledgeEnabled;

    @Column(name = "late_pledge_ends_at")
    private Instant latePledgeEndsAt;

    /**
     * §5.1's decision, frozen — V29's four columns, written once by
     * {@link #finalise} and never again.
     *
     * <p>They are copies of {@link #goalAmount}, {@link #pledgedAmount} and
     * {@link #backersCount} taken at the deadline, and V29's header argues at
     * length why copies rather than a comparison anybody can redo: the pledged
     * total keeps moving after the campaign closes, as collections fail and
     * pledges are refunded, so a campaign that closed above its goal would
     * gradually appear to have failed. #63's own sentence is the rule — a later
     * collection failure reduces the payout, never the outcome.
     *
     * <p>All four or none, which the database also states.
     */
    /**
     * IDN-EXT-01 (#32, V74): where the one extension ends. {@link #deadline} stays the first
     * deadline, because the seven-day window and the D+60 limit are both measured from it.
     * Read by the finaliser (#33); written only by the extension (#34).
     */
    @Column(name = "extended_until")
    private Instant extendedUntil;

    /** IDN-EXT-01 (#32, V74): when the creator extended. Set once, with {@link #extendedUntil}. */
    @Column(name = "extension_used_at")
    private Instant extensionUsedAt;

    @Column(name = "finalized_at")
    private Instant finalizedAt;

    @Column(name = "outcome_goal_amount")
    private BigDecimal outcomeGoalAmount;

    @Column(name = "outcome_pledged_amount")
    private BigDecimal outcomePledgedAmount;

    @Column(name = "outcome_backers_count")
    private Integer outcomeBackersCount;

    /**
     * Both timestamps belong to the database — {@code created_at} to a default and
     * {@code updated_at} to a trigger, so that an application which forgot to set
     * one could not produce a row that lies about when it changed.
     *
     * <p>{@link Generated} is what makes them readable in the same request that
     * wrote them. Without it Hibernate never selects the columns back, and the
     * response to a create or a save would report {@code null} for both — which the
     * editor shows as "never saved" immediately after saving.
     */
    @Generated(event = EventType.INSERT)
    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Generated(event = {EventType.INSERT, EventType.UPDATE})
    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected Project() {
        // JPA.
    }

    private Project(UUID id, UUID creatorId, String title, String slug, String currency) {
        this.id = id;
        this.creatorId = creatorId;
        this.title = title;
        this.slug = slug;
        this.currency = currency;
        this.state = ProjectStateMachine.initial();
        this.latePledgeEnabled = false;
    }

    /**
     * A new draft, with a title and nothing else.
     *
     * <p>Everything §5.3 requires is absent and nullable, deliberately: the
     * editor's first screen is reached by creating the campaign, so a draft that
     * could not exist without a goal, a category, and a cover image would mean
     * the creator had to fill a form before they could open the form. The
     * checklist (#37) is what refuses to submit an incomplete one.
     *
     * @param currency what the goal and every pledge is denominated in. Fixed at
     *     creation because changing it later would reprice commitments already
     *     made
     */
    public static Project open(UUID creatorId, String title, String slug, String currency) {
        return new Project(Identifiers.newIdentifier(), creatorId, title, slug, currency);
    }

    /**
     * Moves the campaign, refusing any edge §6.1 does not permit.
     *
     * <p><strong>Call this through {@code ProjectTransitionService} and nowhere
     * else.</strong> That service validates the edge before it gets here, so the
     * check below is the second of two — kept because it is the one that cannot
     * be forgotten by a future caller, and because the entity refusing an
     * impossible state is what makes the invariant a property of the object
     * rather than of one service method.
     *
     * <p>Entering {@link ProjectState#LIVE} is the one transition with side
     * effects on other columns: it stamps the launch and computes the deadline
     * from the duration the creator chose. Both are then frozen — §5.3 makes the
     * goal and the deadline immutable after launch — which is why the deadline
     * is stored rather than derived on read.
     *
     * @throws IllegalStateException when the edge is not allowed, or when going
     *     live without the duration a deadline is computed from. Both are bugs
     *     in the caller by the time they reach here, which is why neither is a
     *     checked or a translated exception
     */
    public void applyTransition(ProjectState next, Instant at) {
        Objects.requireNonNull(next, "A transition needs a target state");
        Objects.requireNonNull(at, "A transition needs the moment it happened");

        if (!ProjectStateMachine.isAllowed(state, next)) {
            throw new IllegalStateException(
                    "A project cannot move from " + state + " to " + next + "; §6.1 does not allow it");
        }

        if (next == ProjectState.LIVE) {
            if (durationDays == null) {
                throw new IllegalStateException("A project cannot go live without a duration to end from");
            }
            this.launchedAt = at;
            // Days rather than a period in months: a campaign is a countdown the
            // page shows in hours near the end, and adding days to an instant
            // keeps that arithmetic exact regardless of the viewer's zone.
            this.deadline = at.plus(durationDays, ChronoUnit.DAYS);
        }

        this.state = next;
    }

    /**
     * §5.1 applied to this campaign's own numbers, right now.
     *
     * <p>Asked before the transition rather than derived from it, so that the state a
     * campaign is moved to and the numbers frozen against it are one reading of one row
     * — see {@link #freezeOutcome}.
     *
     * @param successThreshold the share of the goal that succeeds, from configuration. Passed
     *     in rather than read here because this is an entity and the number is an operator's
     */
    public CampaignOutcome outcome(BigDecimal successThreshold) {
        return CampaignOutcome.of(pledgedAmount, goalAmount, successThreshold);
    }

    /**
     * Records what decided this campaign, after {@link #applyTransition} has moved it.
     *
     * <p><strong>Once, and only onto a campaign that has been decided.</strong> Both
     * refusals are {@link IllegalStateException} for {@link #applyTransition}'s reason:
     * by the time this is reached, {@code CampaignFinalizer} has claimed the row and
     * checked the state, so either failure means a caller went around it.
     *
     * <p><strong>The columns are copied, not computed on read.</strong> V29's header is
     * the argument in full and it is the whole of #63's "freeze the outcome":
     * {@link #pledgedAmount} keeps moving after the deadline as collections fail and
     * pledges are refunded, so a campaign that closed above its goal would drift below
     * it and appear — to a backer, on a page, weeks later — to have failed all along.
     *
     * @param at when the decision was made. The finaliser's instant for the whole pass,
     *     not a second reading of the clock, so a campaign's state row and its outcome
     *     agree about when it closed
     */
    public void freezeOutcome(Instant at) {
        Objects.requireNonNull(at, "A frozen outcome needs the moment it was decided");

        // WITHDRAWN too since IDN-EXT-01 (#41): a creator at 80% may withdraw before the deadline,
        // and withdrawal is the decision — its numbers are frozen as a deadline's would be.
        if (state != ProjectState.SUCCESSFUL && state != ProjectState.UNSUCCESSFUL && state != ProjectState.WITHDRAWN) {
            throw new IllegalStateException(
                    "A campaign in " + state + " has no outcome to freeze; §5.1 decides only at the deadline");
        }
        if (finalizedAt != null) {
            throw new IllegalStateException("Campaign " + id + " was already finalised at " + finalizedAt);
        }

        this.finalizedAt = at;
        this.outcomeGoalAmount = goalAmount;
        this.outcomePledgedAmount = pledgedAmount;
        this.outcomeBackersCount = backersCount;
    }

    /** Whether §5.1 has already been applied to this campaign. */
    public boolean isFinalised() {
        return finalizedAt != null;
    }

    /** Whether this account is the campaign's creator. Authorisation is decided in {@code ProjectAccess}. */
    public boolean isCreatedBy(UUID accountId) {
        return creatorId.equals(accountId);
    }

    public boolean isLive() {
        return state == ProjectState.LIVE;
    }

    public UUID getId() {
        return id;
    }

    public UUID getCreatorId() {
        return creatorId;
    }

    public String getSlug() {
        return slug;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getBlurb() {
        return blurb;
    }

    public void setBlurb(String blurb) {
        this.blurb = blurb;
    }

    public UUID getCategoryId() {
        return categoryId;
    }

    public UUID getSubcategoryId() {
        return subcategoryId;
    }

    /**
     * Files the campaign under a category, and optionally a subcategory.
     *
     * <p>Both together, never separately: the database refuses a subcategory
     * whose parent is not this category, and two setters would let a caller
     * write the halves in an order that violates it — or leave a subcategory
     * behind after the category moved.
     */
    public void file(UUID categoryId, UUID subcategoryId) {
        if (categoryId == null && subcategoryId != null) {
            throw new IllegalArgumentException("A subcategory without a category is not a filing");
        }
        this.categoryId = categoryId;
        this.subcategoryId = subcategoryId;
    }

    public ProjectState getState() {
        return state;
    }

    public BigDecimal getGoalAmount() {
        return goalAmount;
    }

    public void setGoalAmount(BigDecimal goalAmount) {
        this.goalAmount = goalAmount;
    }

    public String getCurrency() {
        return currency;
    }

    public void setCurrency(String currency) {
        this.currency = currency;
    }

    public BigDecimal getPledgedAmount() {
        return pledgedAmount;
    }

    public int getBackersCount() {
        return backersCount;
    }

    public Integer getDurationDays() {
        return durationDays;
    }

    public void setDurationDays(Integer durationDays) {
        this.durationDays = durationDays;
    }

    public Instant getScheduledLaunchAt() {
        return scheduledLaunchAt;
    }

    public void setScheduledLaunchAt(Instant scheduledLaunchAt) {
        this.scheduledLaunchAt = scheduledLaunchAt;
    }

    public Instant getLaunchedAt() {
        return launchedAt;
    }

    public Instant getDeadline() {
        return deadline;
    }

    /** Where the one extension ends, or null when the campaign was never extended. */
    public Instant getExtendedUntil() {
        return extendedUntil;
    }

    /** When the creator extended, or null. */
    public Instant getExtensionUsedAt() {
        return extensionUsedAt;
    }

    public String getStory() {
        return story;
    }

    public void setStory(String story) {
        this.story = story;
    }

    public String getRisks() {
        return risks;
    }

    public void setRisks(String risks) {
        this.risks = risks;
    }

    /** The cover image, or null when none has been set. The columns move together. */
    public CoverImage getCoverImage() {
        if (coverImageUrl == null || coverImageWidth == null || coverImageHeight == null) {
            return null;
        }
        return new CoverImage(coverImageUrl, coverImageWidth, coverImageHeight, coverMediaId);
    }

    /**
     * Sets all four together, {@code coverMediaId} included — which is null for a cover
     * supplied as a typed URL, and clearing it in that case is the point.
     *
     * <p>Leaving a stale identifier beside a URL that no longer comes from it would mean a
     * campaign whose recorded dimensions came from one image and whose placeholder came from
     * another. That is exactly the kind of half-updated row the expand phase is prone to, so
     * it is refused here rather than reasoned about at the call sites.
     */
    public void setCoverImage(CoverImage coverImage) {
        if (coverImage == null) {
            this.coverImageUrl = null;
            this.coverImageWidth = null;
            this.coverImageHeight = null;
            this.coverMediaId = null;
            return;
        }
        this.coverImageUrl = coverImage.url();
        this.coverImageWidth = coverImage.width();
        this.coverImageHeight = coverImage.height();
        this.coverMediaId = coverImage.mediaId();
    }

    public boolean isLatePledgeEnabled() {
        return latePledgeEnabled;
    }

    /**
     * §4.5's PL-16: whether this creator offers late pledges at all.
     *
     * <p>Set from the campaign editor, at any point in the campaign's life —
     * {@link ProjectEditLocks} deliberately does not freeze it at launch, because the
     * decision is usually taken after the campaign has closed and the creator is
     * counting what they can still manufacture.
     *
     * <p><strong>Switching it off closes any open window immediately</strong>, without
     * moving the campaign's state: {@code PledgeAcceptance} requires all three facts, so
     * a creator who has run out of stock has a switch that takes effect on the next
     * request rather than a transition they have to make and cannot undo. The campaign
     * stays in {@link ProjectState#LATE_PLEDGE} until they decide to start delivering.
     *
     * <p><strong>The window is cleared with it, and it has to be.</strong>
     * {@code projects_late_pledge_window_needs_the_feature} refuses a window on a
     * campaign that does not offer late pledges, so leaving the instant behind would
     * turn one checkbox into a constraint violation — a 500 for a creator doing
     * something entirely reasonable. What is lost is the date they had planned to stop
     * on; what keeps it is {@code project_state_transitions}, where the note on the
     * edge into {@code LATE_PLEDGE} records the window that was announced.
     */
    public void setLatePledgeEnabled(boolean latePledgeEnabled) {
        this.latePledgeEnabled = latePledgeEnabled;
        if (!latePledgeEnabled) {
            this.latePledgeEndsAt = null;
        }
    }

    public Instant getLatePledgeEndsAt() {
        return latePledgeEndsAt;
    }

    public void extendUntil(Instant until, Instant at) {
        // IDN-EXT-01 (#34). Only ever written beside the edge into EXTENDED, by
        // `ProjectTransitionService.extend`, which is the one place that checks the window, the
        // threshold and the D+60 limit. Both columns together: V74 refuses one without the other,
        // and `extensionUsedAt` is what makes "once" a fact on the row.
        if (this.extensionUsedAt != null) {
            throw new IllegalStateException("A campaign is extended once");
        }
        this.extendedUntil = Objects.requireNonNull(until, "An extension ends at some point");
        this.extensionUsedAt = Objects.requireNonNull(at, "An extension happens at some instant");
    }

    public Instant getFinalizedAt() {
        return finalizedAt;
    }

    public BigDecimal getOutcomeGoalAmount() {
        return outcomeGoalAmount;
    }

    public BigDecimal getOutcomePledgedAmount() {
        return outcomePledgedAmount;
    }

    public Integer getOutcomeBackersCount() {
        return outcomeBackersCount;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    @Override
    public boolean equals(Object other) {
        // The identifier, which is assigned before persistence, so an unsaved
        // and a reloaded instance of the same campaign compare equal.
        if (this == other) {
            return true;
        }
        return other instanceof Project project && Objects.equals(id, project.id);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(id);
    }

    @Override
    public String toString() {
        // No title: an unlaunched campaign is confidential, and this lands in
        // logs. The state is here because it is what log lines about a project
        // are almost always asking about.
        return "Project[id=" + id + ", state=" + state + "]";
    }
}
