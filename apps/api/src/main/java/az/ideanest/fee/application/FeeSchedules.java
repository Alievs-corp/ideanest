package az.ideanest.fee.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.fee.FeeProperties;
import az.ideanest.fee.domain.FeeSchedule;
import az.ideanest.fee.domain.FeeScope;
import az.ideanest.fee.infrastructure.FeeScheduleRepository;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What the platform charges, read and changed — §9 and §4.11's AD-11, issue #311.
 *
 * <h2>Two audiences, and they need different things</h2>
 *
 * <p>{@link #priceOf} is called by the payout run and is the reason this module exists.
 * {@link #replace} is called by one screen, a handful of times a year. The first must
 * never throw for a reason the operator could have prevented; the second must refuse
 * anything it does not understand. That asymmetry is deliberate and shows up in every
 * decision below.
 *
 * <h2>Resolution is most-specific-wins</h2>
 *
 * <p>A campaign's own schedule beats its category's, which beats the platform's. Three
 * queries rather than one with a {@code CASE} ordering, because two of the three are
 * usually misses against an index and the alternative is a scan that sorts before it
 * filters.
 *
 * <h2>No configured schedule is zero fees, not an exception</h2>
 *
 * <p>The tempting alternative is to refuse: a platform that has not decided what it
 * charges should not be paying anybody out. It is wrong because of when the failure
 * lands. The payout run is a scheduled job over every campaign that closed; an exception
 * there stops the run for all of them, on the day somebody forgot to write a row, and the
 * symptom is that nobody gets paid rather than that one figure is wrong. Zero fees
 * overpays a creator, which is visible on the payout screen before anybody approves it —
 * and every payout above the threshold is approved by two people who see the breakdown.
 * So it fails towards a recoverable mistake.
 */
@Service
public class FeeSchedules {

    private static final Logger log = LoggerFactory.getLogger(FeeSchedules.class);

    private final FeeScheduleRepository schedules;
    private final CampaignCategories categories;
    private final PlatformStaff staff;
    private final AuditLog audit;
    private final Clock clock;
    private final FeeProperties properties;

    public FeeSchedules(
            FeeScheduleRepository schedules,
            CampaignCategories categories,
            PlatformStaff staff,
            AuditLog audit,
            Clock clock,
            FeeProperties properties) {
        this.schedules = schedules;
        this.categories = categories;
        this.staff = staff;
        this.audit = audit;
        this.clock = clock;
        this.properties = properties;
    }

    /**
     * Prices a sum against the terms that were in force at an instant.
     *
     * @param at <strong>the moment being priced, and not "now".</strong> A payout
     *     recalculated next year has to reach the schedule it reached when it was
     *     approved, which is the whole reason V49 stores a window
     * @param projectId the campaign. Its own schedule is tried first, then its category's,
     *     then the platform's — the category is looked up through {@link CampaignCategories}
     *     rather than passed in, because a caller that had to supply it would eventually
     *     pass null and switch off every category exception with no symptom
     */
    @Transactional(readOnly = true)
    public FeeBreakdown priceOf(Money gross, Instant at, UUID projectId) {
        Optional<FeeSchedule> schedule = resolve(at, projectId);

        if (schedule.isEmpty()) {
            // IDN-EXT-01 (#42): §5.2's default — 15%, the bank inside it — rather than zero fees.
            log.debug("No fee schedule in force at {}; pricing {} at the default terms", at, gross.currency());
            return applyDefault(gross);
        }

        return apply(gross, schedule.get());
    }

    /** §5.2's fee when no schedule is in force: {@code ideanest.fee}. IDN-EXT-01 (#42). */
    public DefaultFeeTerms defaultTerms() {
        return new DefaultFeeTerms(
                properties.defaultPlatformRate(), properties.defaultProcessingRate(), properties.defaultCurrency());
    }

    /**
     * The default terms' arithmetic, with the net as the remainder for {@link #apply}'s reason: a
     * third multiplication could disagree with the two fees by a minor unit.
     */
    FeeBreakdown applyDefault(Money gross) {
        Money platformFee = gross.times(properties.defaultPlatformRate());
        Money processingFee = gross.times(properties.defaultProcessingRate());
        return new FeeBreakdown(gross, platformFee, processingFee, gross.minus(platformFee.plus(processingFee)), null);
    }

    /**
     * The arithmetic, separated so that it can be tested without a database.
     *
     * <p><strong>The net is the remainder, not a third multiplication.</strong> Computing
     * it as {@code gross * (1 - platformRate - processingRate)} would round a fourth time
     * and could disagree with the two fees by a minor unit — money that exists on a
     * statement and in no account. Subtraction makes {@link FeeBreakdown#balances()} true
     * by construction.
     *
     * <p>The currency check is {@link Money}'s: a schedule denominated in one currency
     * cannot price a collection in another, and §21.2 gives nothing to convert with. The
     * fixed processing amount is therefore only added when the currencies agree — and
     * when they do not, {@link Money#plus} throws, which is correct: a payout priced with
     * the wrong currency's terms is not a payout anybody should approve.
     */
    FeeBreakdown apply(Money gross, FeeSchedule schedule) {
        Money platformFee = gross.times(schedule.platformRate());
        Money processingFee = gross.times(schedule.processingRate())
                .plus(Money.of(schedule.processingFixed(), schedule.currency()));

        // Fees that exceed what was collected would produce a negative net, which V55's
        // CHECK refuses and which is nonsense besides. Clamped rather than thrown, for
        // the reason the class comment gives about the payout run — and logged, because
        // it means a schedule is misconfigured.
        Money fees = platformFee.plus(processingFee);
        if (fees.isGreaterThan(gross)) {
            log.warn(
                    "Fee schedule {} charges {} against a gross of {}; clamping to the gross",
                    schedule.id(),
                    fees,
                    gross);
            return new FeeBreakdown(gross, platformFee, gross.minus(platformFee), Money.zero(gross.currency()),
                    schedule.id());
        }

        return new FeeBreakdown(gross, platformFee, processingFee, gross.minus(fees), schedule.id());
    }

    /**
     * Most specific wins: the campaign's own schedule, then its category's, then the
     * platform's.
     *
     * <p>Three queries rather than one with a {@code CASE} ordering, because two of the
     * three are usually misses against an index and the alternative is a scan that sorts
     * before it filters.
     */
    private Optional<FeeSchedule> resolve(Instant at, UUID projectId) {
        if (projectId != null) {
            Optional<FeeSchedule> own = schedules.inForceAt(FeeScope.PROJECT, projectId, at);
            if (own.isPresent()) {
                return own;
            }

            Optional<UUID> categoryId = categories.categoryOf(projectId);
            if (categoryId.isPresent()) {
                Optional<FeeSchedule> category = schedules.inForceAt(FeeScope.CATEGORY, categoryId.get(), at);
                if (category.isPresent()) {
                    return category;
                }
            }
        }
        return schedules.platformInForceAt(at);
    }

    /**
     * What a campaign is priced under right now, for the disclosure §22.3 requires — #439.
     *
     * <p><strong>Public, and it has to be.</strong> §22.3 lists "clear fee disclosure" among six
     * product requirements, and the audience is a backer deciding whether to pledge and a creator
     * deciding whether to launch. A disclosure only staff can read is not one.
     *
     * <p><strong>Derived rather than written down, which is the whole point of #439's fee
     * section.</strong> Until this existed the platform's fee copy was a sentence in a message
     * catalogue saying that everything is free — true today, because no schedule is seeded, and
     * <em>false the day one is</em>, silently, because nothing checks a catalogue against a table.
     * A number a creator can check against the payout they get is a disclosure; a sentence about
     * the platform's intentions is not.
     *
     * <p><strong>Empty means no schedule, and not "no fees".</strong> The caller decides what to
     * say about that: {@link #priceOf} treats it as zero fees because a payout run must not stop,
     * and a page has the opposite obligation — it must not claim a rate the platform has not
     * committed to. Returning an empty optional rather than a zero breakdown is what keeps the
     * two callers from having to share one answer.
     *
     * @param projectId the campaign whose terms to disclose, or null for the platform-wide ones.
     *     Most-specific-wins, exactly as {@link #priceOf} resolves — so a campaign with its own
     *     schedule discloses its own schedule, and a disclosure that quoted the platform rate to
     *     a creator on different terms would be the disclosure §22.3 is trying to prevent
     */
    @Transactional(readOnly = true)
    public Optional<FeeSchedule> inForceFor(UUID projectId) {
        return resolve(clock.instant(), projectId);
    }

    /** Every window ever written, for AD-11's screen. */
    @Transactional(readOnly = true)
    public List<FeeSchedule> history(UUID staffId) {
        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);
        return schedules.history();
    }

    /**
     * Closes the open schedule for a scope and opens a new one, in one transaction.
     *
     * <p><strong>Replace rather than update, which is the whole of V49's argument.</strong>
     * There is no endpoint that edits a rate: what was charged in March stays readable,
     * and a change is a new row whose window begins now.
     *
     * <p>The two statements are one transaction because V49 permits exactly one open
     * schedule per scope — so a close that committed without its successor would leave the
     * platform with no terms at all, and a successor that committed without the close
     * would violate the index. Both happen or neither does.
     *
     * @throws OverlappingFeeScheduleException when another request opened one first. V49's
     *     partial unique index is what detects it, rather than a lock: this screen is used
     *     a handful of times a year, and serialising it would be ceremony
     */
    @Transactional
    public FeeSchedule replace(
            UUID staffId,
            FeeScope scope,
            UUID scopeRef,
            BigDecimal platformRate,
            BigDecimal processingRate,
            BigDecimal processingFixed,
            String currency,
            String note) {

        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);

        // **Flushed before the insert, and that is not a detail.** V49's
        // `fee_schedules_one_open_per_scope` is a partial unique index over the rows with no
        // `effective_to`, and Hibernate's action queue orders every INSERT ahead of every UPDATE
        // in a flush. So closing the open schedule and then saving its successor put two open
        // rows in front of the index at once, and the second fee change a scope ever received
        // came back as OverlappingFeeScheduleException — a 409 telling an administrator that
        // somebody else had got there first, on a screen only they were using.
        //
        // Found by #439's disclosure test, which is the first thing in the build to change a
        // schedule twice.
        schedules.openFor(scope, scopeRef).ifPresent(open -> {
            open.close(now);
            schedules.saveAndFlush(open);
        });

        FeeSchedule opened = new FeeSchedule(
                Identifiers.newIdentifier(),
                scope,
                scopeRef,
                platformRate,
                processingRate,
                processingFixed,
                currency,
                now,
                note,
                staffId);

        FeeSchedule saved;
        try {
            saved = schedules.saveAndFlush(opened);
        } catch (DataIntegrityViolationException e) {
            // Two administrators replaced the same scope's schedule at once. The index
            // caught it; the loser is told to reload rather than shown a 500.
            throw new OverlappingFeeScheduleException(scope, scopeRef);
        }

        audit.record(
                AuditAction.FEE_SCHEDULE_CHANGED,
                saved.id(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "scope=%s; ref=%s; platform=%s; processing=%s+%s %s"
                        .formatted(scope, scopeRef, platformRate, processingRate, processingFixed, currency));

        log.info("Fee schedule {} opened for {} {} by {}", saved.id(), scope, scopeRef, staffId);
        return saved;
    }
}
