package az.ideanest.notification.application;

import az.ideanest.notification.application.NotificationEvents.CampaignEndingSoon;
import az.ideanest.notification.application.NotificationEvents.CampaignMessageSent;
import az.ideanest.notification.application.NotificationEvents.CampaignSucceeded;
import az.ideanest.notification.application.NotificationEvents.CampaignUnsuccessful;
import az.ideanest.notification.application.NotificationEvents.GoalReached;
import az.ideanest.notification.application.NotificationEvents.PaymentFailed;
import az.ideanest.notification.application.NotificationEvents.PledgeConfirmed;
import az.ideanest.notification.application.NotificationEvents.PledgeEdited;
import az.ideanest.notification.application.NotificationEvents.ProjectApproved;
import az.ideanest.notification.application.NotificationEvents.CampaignExtended;
import az.ideanest.notification.application.NotificationEvents.ProjectLaunched;
import az.ideanest.notification.application.NotificationEvents.UpdateDueSoon;
import az.ideanest.notification.domain.NotificationType;
import az.ideanest.shared.audience.AudienceProperties;
import az.ideanest.shared.audience.ProjectAudience;
import az.ideanest.shared.audience.ProjectAudiences;
import az.ideanest.shared.audience.SegmentAudience;
import az.ideanest.shared.outbox.OutboxMessage;
import az.ideanest.shared.project.ProjectSummaries;
import az.ideanest.shared.project.ProjectSummary;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

/**
 * How the notification module hears that something happened.
 *
 * <p>A listener on {@code OutboxMessage}, switching on {@link OutboxMessage#eventType()},
 * because that is the shape {@code ApplicationEventOutboxDispatcher} prescribes in its
 * own class comment: the dispatcher stays untyped so that no per-event Java class
 * becomes a compile-time coupling between the relay and every module's events, and so
 * that nothing has to be rebuilt the day these messages arrive from another service
 * instead of from a table.
 *
 * <p><strong>This is the whole of the coupling between notifications and the modules
 * that produce these events, and it is a string.</strong> {@code ModuleBoundaryTests}
 * forbids reaching into another module's domain or infrastructure; a listener on a
 * published event reaches into neither. Nothing in this file imports anything from
 * {@code az.ideanest.pledge} or {@code az.ideanest.project}, which is checkable, is
 * checked, and is asserted directly by {@code NotificationBoundaryTests}.
 *
 * <p>{@link NotificationEvents} says which of §4.10's rows have a producer and which are still
 * waiting for one, event by event.
 *
 * <h2>Translation, and what this module is allowed to know</h2>
 *
 * <p>Each branch below turns one payload into {@link NotificationRequest}s: who to tell,
 * which of §4.10's rows it is, and what a template will need. It does not decide which
 * channels — that is §4.10's table, on {@link NotificationType} — and it does not decide
 * whether to send, which is the recipient's preference and {@code NotificationFanOut}'s
 * job.
 *
 * <p><strong>A recipient comes out of the payload, or out of a published port. Never out of
 * another module's tables.</strong> A translation may not look up who ought to be told by
 * reading {@code pledges} or {@code project_reminders}; that is the coupling this whole
 * arrangement exists to prevent, and nothing in this file imports anything from
 * {@code az.ideanest.pledge} or {@code az.ideanest.project}.
 *
 * <p>#85 stopped there, which meant {@link GoalReached} notified the creator and nobody else —
 * the least useful half of that event, since the people who funded the campaign heard nothing.
 * #245 is the port that fixes it: {@code shared.audience.ProjectAudiences} is a question the
 * module owning the rows answers, so the audience is <em>asked for</em> rather than read.
 * {@link #audienceOf} is the one call site, and it is where the bound on a computed audience is
 * applied and logged.
 *
 * <p><strong>#245 is finished here, and #90 is what finished it.</strong> The port shipped with
 * one audience — {@code BACKERS}, from {@code pledges} — because {@code saves} and
 * {@code follows} did not exist, so §4.10's "followed creator launched" and "saved project
 * ending soon" had copy, channels and a preference category and no audience at all. Both are
 * translated below now, from {@code FOLLOWERS} and {@code SAVERS}, which the community module
 * answers.
 *
 * <p>#249 is the second port and the same shape again. A translation may not read
 * {@code projects} to find out what a campaign is called, so {@code shared.project.ProjectSummaries}
 * publishes the question; {@link #about} is the one call site, and what it puts in the
 * document is the title <em>as it was when the event happened</em> rather than as it is when
 * somebody opens the message.
 *
 * <p><strong>Set arithmetic across two audiences happens here and nowhere else.</strong>
 * {@link #endingSoon} sends "saved project ending soon" to the savers who are not backers, and
 * that subtraction is a decision about what the messages mean rather than a query optimisation
 * — see the method. It is the one place two audiences of one event meet, and
 * {@link #concat} states why deduplicating them is load-bearing.
 *
 * <h2>Failure</h2>
 *
 * <p>Three kinds, and they are answered differently on purpose.
 *
 * <ul>
 *   <li><strong>An event this module does not recognise.</strong> Ignored, silently, and
 *       that is the only correct answer: the dispatcher publishes every event to every
 *       listener, so a comment being posted reaches this method too, and treating an
 *       unrecognised type as a fault would make every module's events every other
 *       module's problem.
 *   <li><strong>The notifications failed to write.</strong> It throws, the dispatch
 *       transaction rolls back with it, the event stays {@code PENDING}, and the relay
 *       tries again. That is what an at-least-once transport is for and it is the reason
 *       {@code NotificationFanOut} is {@code MANDATORY}.
 *   <li><strong>The payload cannot be read, or is missing something this module needs.</strong>
 *       It throws too, and that is a deliberate choice rather than an oversight. An
 *       event whose body this module does not understand will not be understood on the
 *       next attempt either, so the retries are wasted and the eighth one dead-letters
 *       it — which is exactly right: a producer and a consumer that disagree about a
 *       payload is a fault somebody has to see, and swallowing it would mean people
 *       silently not being told things, with nothing anywhere saying so. A notification
 *       nobody receives and nobody misses is the worst failure this module has.
 * </ul>
 */
@Component
public class NotificationEventListener {

    private static final Logger log = LoggerFactory.getLogger(NotificationEventListener.class);

    /** §7.2's aggregate names, as they appear on a notification's subject. */
    private static final String PLEDGE = "pledge";

    private static final String PROJECT = "project";

    private final NotificationFanOut fanOut;
    private final ProjectAudiences audiences;
    private final SegmentAudience segments;
    private final ProjectSummaries campaigns;
    private final AudienceProperties properties;
    private final ObjectMapper json;

    public NotificationEventListener(
            NotificationFanOut fanOut,
            ProjectAudiences audiences,
            SegmentAudience segments,
            ProjectSummaries campaigns,
            AudienceProperties properties,
            ObjectMapper json) {

        this.fanOut = fanOut;
        this.audiences = audiences;
        this.segments = segments;
        this.campaigns = campaigns;
        this.properties = properties;
        this.json = json;
    }

    /**
     * Fans out the event this message describes, and ignores every other event.
     *
     * <p>Synchronous, and it has to be: {@code ApplicationEventOutboxDispatcher}'s
     * comment states that an {@code @Async} listener would make every event look
     * delivered the instant it was handed over, which is the one behaviour the
     * dispatcher asks an implementation not to have. It also runs inside the dispatch
     * transaction, which is what {@code NotificationFanOut}'s {@code MANDATORY}
     * propagation depends on.
     */
    @EventListener
    public void on(OutboxMessage message) {
        List<NotificationRequest> requests = translate(message);
        if (requests == null) {
            return;
        }
        if (message.deliveryAttempt() > 1) {
            // Never in itself an error — OutboxMessage says so — and worth a line,
            // because a redelivery that keeps happening is the shape of a poisoned
            // event and this is where it would be visible.
            log.info("Fanning out {} on delivery attempt {}", message, message.deliveryAttempt());
        }
        fanOut.fanOut(message.id(), requests);
    }

    /**
     * The requests this event owes, or null when the event is not this module's.
     *
     * <p>Null rather than an empty list, because the two are different facts and only
     * one of them is worth logging: "not mine" is every other module's traffic, and
     * "mine, and it concerns nobody" is a translation that decided something.
     */
    private List<NotificationRequest> translate(OutboxMessage message) {
        return switch (message.eventType()) {
            case PledgeConfirmed.EVENT_TYPE -> {
                PledgeConfirmed event = read(message, PledgeConfirmed.class);
                yield List.of(NotificationRequest.about(
                        required(event.backerId(), "backerId", message),
                        NotificationType.PLEDGE_CONFIRMED,
                        PLEDGE,
                        required(event.pledgeId(), "pledgeId", message),
                        about(event.projectId(), "total", event.total()),
                        at(event.confirmedAt(), message)));
            }
            case PledgeEdited.EVENT_TYPE -> {
                PledgeEdited event = read(message, PledgeEdited.class);
                yield List.of(NotificationRequest.about(
                        required(event.backerId(), "backerId", message),
                        NotificationType.PLEDGE_EDITED,
                        PLEDGE,
                        required(event.pledgeId(), "pledgeId", message),
                        about(event.projectId(), "total", event.total()),
                        at(event.editedAt(), message)));
            }
            case PaymentFailed.EVENT_TYPE -> {
                PaymentFailed event = read(message, PaymentFailed.class);
                yield List.of(NotificationRequest.about(
                        required(event.backerId(), "backerId", message),
                        NotificationType.PAYMENT_FAILED,
                        PLEDGE,
                        required(event.pledgeId(), "pledgeId", message),
                        about(event.projectId(), "amount", event.amount(), "attempt", event.attempt()),
                        at(event.failedAt(), message)));
            }
            case NotificationEvents.PledgeCollected.EVENT_TYPE -> {
                NotificationEvents.PledgeCollected event =
                        read(message, NotificationEvents.PledgeCollected.class);
                yield List.of(NotificationRequest.about(
                        required(event.backerId(), "backerId", message),
                        NotificationType.PAYMENT_COLLECTED,
                        PLEDGE,
                        required(event.pledgeId(), "pledgeId", message),
                        about(event.projectId(), "amount", event.amount()),
                        at(event.collectedAt(), message)));
            }
            case NotificationEvents.FinalPaymentWarning.EVENT_TYPE -> {
                NotificationEvents.FinalPaymentWarning event =
                        read(message, NotificationEvents.FinalPaymentWarning.class);
                yield List.of(NotificationRequest.about(
                        required(event.backerId(), "backerId", message),
                        NotificationType.FINAL_PAYMENT_WARNING,
                        PLEDGE,
                        required(event.pledgeId(), "pledgeId", message),
                        // `droppedAt` is what makes this different from the three
                        // PAYMENT_FAILED messages before it: the backer is told the date
                        // their pledge stops standing, not merely that something failed
                        // again.
                        about(
                                event.projectId(),
                                "amount",
                                event.amount(),
                                "attempt",
                                event.attempt(),
                                "droppedAt",
                                event.droppedAt()),
                        at(event.failedAt(), message)));
            }
            case GoalReached.EVENT_TYPE -> {
                GoalReached event = read(message, GoalReached.class);
                UUID projectId = required(event.projectId(), "projectId", message);
                UUID creatorId = required(event.creatorId(), "creatorId", message);
                yield everybody(
                        // The creator first, and never dropped by the bound below: it is their
                        // campaign, and a truncated audience that lost the one recipient who is
                        // certain to want the message would be the wrong thing to cut.
                        concat(creatorId, audienceOf(projectId, ProjectAudience.BACKERS, message)),
                        NotificationType.GOAL_REACHED,
                        projectId,
                        about(projectId, "goal", event.goal()),
                        at(event.reachedAt(), message));
            }
            case CampaignSucceeded.EVENT_TYPE -> {
                CampaignSucceeded event = read(message, CampaignSucceeded.class);
                yield finalised(
                        message,
                        NotificationType.CAMPAIGN_SUCCEEDED,
                        required(event.projectId(), "projectId", message),
                        required(event.creatorId(), "creatorId", message),
                        event.goal(),
                        event.pledged(),
                        event.backersCount(),
                        at(event.finalisedAt(), message));
            }
            case CampaignUnsuccessful.EVENT_TYPE -> {
                CampaignUnsuccessful event = read(message, CampaignUnsuccessful.class);
                yield finalised(
                        message,
                        NotificationType.CAMPAIGN_UNSUCCESSFUL,
                        required(event.projectId(), "projectId", message),
                        required(event.creatorId(), "creatorId", message),
                        event.goal(),
                        event.pledged(),
                        event.backersCount(),
                        at(event.finalisedAt(), message));
            }
            case ProjectApproved.EVENT_TYPE -> {
                ProjectApproved event = read(message, ProjectApproved.class);
                yield List.of(NotificationRequest.about(
                        required(event.creatorId(), "creatorId", message),
                        NotificationType.PROJECT_APPROVED,
                        PROJECT,
                        required(event.projectId(), "projectId", message),
                        about(event.projectId()),
                        at(event.approvedAt(), message)));
            }
            case UpdateDueSoon.EVENT_TYPE -> {
                UpdateDueSoon event = read(message, UpdateDueSoon.class);
                UUID projectId = required(event.projectId(), "projectId", message);
                // The creator alone. See NotificationEvents.UpdateDueSoon on why the backers of
                // a campaign are not told that their creator is nearly late.
                yield List.of(NotificationRequest.about(
                        required(event.creatorId(), "creatorId", message),
                        NotificationType.UPDATE_DUE_SOON,
                        PROJECT,
                        projectId,
                        // A date and not an instant: this reaches the copy as {3} and is read
                        // by a person, and an ISO timestamp with a Z on the end in the middle of
                        // an Azerbaijani sentence is the platform showing its plumbing.
                        about(projectId, "dueAt", dueDate(event.dueAt())),
                        at(event.dueAt(), message)));
            }
            case CampaignExtended.EVENT_TYPE -> {
                CampaignExtended event = read(message, CampaignExtended.class);
                UUID projectId = required(event.projectId(), "projectId", message);
                // Backers only. The creator extended it and needs no message about their own
                // decision; a creator who also backed the campaign is excluded by the same rule.
                UUID creatorId = required(event.creatorId(), "creatorId", message);
                yield everybody(
                        audienceOf(projectId, ProjectAudience.BACKERS, message).stream()
                                .filter(recipient -> !recipient.equals(creatorId))
                                .toList(),
                        NotificationType.CAMPAIGN_EXTENDED,
                        projectId,
                        // Dates, not instants, for dueAt's reason: the email prints them in a sentence.
                        about(
                                projectId,
                                "deadline",
                                dueDate(event.deadline()),
                                "extendedUntil",
                                dueDate(event.extendedUntil())),
                        at(event.extendedAt(), message));
            }
            case ProjectLaunched.EVENT_TYPE -> {
                ProjectLaunched event = read(message, ProjectLaunched.class);
                UUID projectId = required(event.projectId(), "projectId", message);
                // The creator is deliberately *not* in this audience, unlike GoalReached's:
                // they pressed the button. `follows_is_not_self` means they cannot be in it
                // by accident either.
                yield everybody(
                        audienceOf(projectId, ProjectAudience.FOLLOWERS, message),
                        NotificationType.FOLLOWED_CREATOR_LAUNCHED,
                        projectId,
                        about(projectId, "deadline", event.deadline()),
                        at(event.launchedAt(), message));
            }
            case CampaignEndingSoon.EVENT_TYPE -> {
                CampaignEndingSoon event = read(message, CampaignEndingSoon.class);
                yield endingSoon(message, event);
            }
            case CampaignMessageSent.EVENT_TYPE -> {
                CampaignMessageSent event = read(message, CampaignMessageSent.class);
                UUID projectId = required(event.projectId(), "projectId", message);
                UUID messageId = required(event.messageId(), "messageId", message);
                // The segment or every backer, which is the whole of the branching here. The
                // sender is not added: they chose the audience, and a creator receiving their
                // own message would look like the platform had misunderstood the request.
                List<UUID> recipients = event.segmentId() == null
                        ? audienceOf(projectId, ProjectAudience.BACKERS, message)
                        : segmentAudienceOf(projectId, event.segmentId(), message);

                yield recipients.stream()
                        .map(recipientId -> NotificationRequest.about(
                                recipientId,
                                NotificationType.DIRECT_MESSAGE,
                                // The subject is the message rather than the campaign, unlike
                                // every other type here, and it is what lets an inbox link a
                                // reader back to what they were sent.
                                "message",
                                messageId,
                                about(
                                        projectId,
                                        "subject",
                                        required(event.subject(), "subject", message),
                                        "body",
                                        required(event.body(), "body", message)),
                                at(event.sentAt(), message)))
                        .toList();
            }
            case NotificationEvents.SurveySent.EVENT_TYPE -> {
                NotificationEvents.SurveySent event = read(message, NotificationEvents.SurveySent.class);
                UUID projectId = required(event.projectId(), "projectId", message);
                UUID surveyId = required(event.surveyId(), "surveyId", message);

                // The audience is resolved here rather than carried, exactly as a bulk
                // message's is: the platform stores no list of who a survey went to, and
                // SurveySentEvent argues why storing one would be worse than the drift.
                yield audienceOf(projectId, ProjectAudience.BACKERS, message).stream()
                        .map(recipientId -> NotificationRequest.about(
                                recipientId,
                                NotificationType.SURVEY_AVAILABLE,
                                // The subject is the survey, so an inbox can link a reader
                                // straight to the form rather than to the campaign page.
                                "survey",
                                surveyId,
                                about(
                                        projectId,
                                        "surveyTitle",
                                        required(event.title(), "title", message),
                                        "respondBy",
                                        event.respondBy() == null ? "" : event.respondBy().toString()),
                                at(event.sentAt(), message)))
                        .toList();
            }
            case NotificationEvents.SurveyNudged.EVENT_TYPE -> {
                NotificationEvents.SurveyNudged event = read(message, NotificationEvents.SurveyNudged.class);
                UUID projectId = required(event.projectId(), "projectId", message);
                UUID surveyId = required(event.surveyId(), "surveyId", message);
                UUID backerId = required(event.backerId(), "backerId", message);

                // One recipient, named in the payload. The sweep already decided who has
                // not answered, and resolving the audience again here would chase the
                // people who answered since.
                yield List.of(NotificationRequest.about(
                        backerId,
                        NotificationType.SURVEY_OVERDUE,
                        "survey",
                        surveyId,
                        about(
                                projectId,
                                "surveyTitle",
                                required(event.title(), "title", message),
                                "respondBy",
                                event.respondBy() == null ? "" : event.respondBy().toString()),
                        at(event.sentAt(), message)));
            }
            default -> null;
        };
    }

    /**
     * The payload, as this module's contract for it.
     *
     * <p>Read with the application's own {@code ObjectMapper}, so that the money in it
     * is subject to §10.3's rules — an amount as a string, never a JSON number — without
     * this class knowing that is what it is asking for.
     */
    private <T> T read(OutboxMessage message, Class<T> shape) {
        try {
            T event = json.readValue(message.payload(), shape);
            if (event == null) {
                // A payload of the four characters `null` parses successfully and yields
                // nothing. Caught here so the failure names the event rather than
                // surfacing as a NullPointerException three lines later.
                throw new IllegalStateException(
                        "A " + message.eventType() + " event " + message.id() + " has an empty body");
            }
            return event;
        } catch (JacksonException malformed) {
            // Unchecked in Jackson 3, and still caught, for Outbox's reason: a raw
            // databind error surfacing from the middle of a dispatch says nothing about
            // which event it was about. It must fail — see the class comment for why
            // swallowing it would be worse — but it must fail saying so.
            throw new IllegalStateException(
                    "A " + message.eventType() + " event " + message.id() + " could not be read as one", malformed);
        }
    }

    /**
     * §5.1's outcome, to the creator and to everybody who backed the campaign.
     *
     * <p>Shared by the two outcomes because the audience, the subject, and the rendering
     * document are identical and only the {@link NotificationType} differs — which is the
     * whole of the difference between the two messages, and writing it twice would be two
     * places for the audience rule to drift apart. The type is a parameter rather than
     * derived from the event, so the {@code switch} above stays the only thing that maps
     * an event type to a notification row.
     *
     * <p>Nothing here decides whether the campaign succeeded. That was decided at the
     * deadline, in another module, and is recorded on the campaign; this module is told.
     */
    private List<NotificationRequest> finalised(
            OutboxMessage message,
            NotificationType type,
            UUID projectId,
            UUID creatorId,
            Object goal,
            Object pledged,
            Integer backersCount,
            Instant finalisedAt) {

        return everybody(
                // The creator first and never dropped by the bound, for GoalReached's
                // reason: a truncated audience that lost the one person whose campaign it
                // is would be the wrong thing to cut.
                concat(creatorId, audienceOf(projectId, ProjectAudience.BACKERS, message)),
                type,
                projectId,
                about(projectId, "goal", goal, "pledged", pledged, "backersCount", backersCount),
                finalisedAt);
    }

    /**
     * The same notification, to several people.
     *
     * <p>One {@link NotificationRequest} each, because a request is one person — the fan-out
     * resolves preferences per recipient, so a broadcast has to be several requests or it would
     * be one message that ignored everybody's settings but the first person's.
     */
    private static List<NotificationRequest> everybody(
            List<UUID> recipients,
            NotificationType type,
            UUID projectId,
            Map<String, Object> params,
            Instant occurredAt) {

        return recipients.stream()
                .map(recipientId ->
                        NotificationRequest.about(recipientId, type, PROJECT, projectId, params, occurredAt))
                .toList();
    }

    /**
     * One recipient in front of a list, without repeating anybody.
     *
     * <p><strong>The deduplication is load-bearing rather than tidy.</strong>
     * {@code notifications_event_recipient_channel_key} is unique on (event, recipient, channel),
     * so a creator who has also backed their own campaign would appear twice, the second insert
     * would violate the index, and the whole dispatch would roll back and be retried — for ever,
     * because no redelivery changes the audience. A {@link LinkedHashSet} so the order stays the
     * one written here.
     */
    private static List<UUID> concat(UUID first, List<UUID> rest) {
        Set<UUID> recipients = new LinkedHashSet<>();
        recipients.add(first);
        recipients.addAll(rest);
        return List.copyOf(recipients);
    }

    /**
     * §4.10's deadline thresholds, which are one event and up to three of §4.10's rows.
     *
     * <p><strong>The savers are the savers who are not backers</strong>, and the subtraction is
     * the point rather than an optimisation. §4.10 gives "48 hours remaining" and "saved project
     * ending soon" separate rows because they are separate messages: one tells somebody who has
     * committed that their campaign is closing, the other invites somebody who has not. Sending
     * the invitation to a backer reads as though their pledge had not been noticed — and it
     * would also put the same person in two audiences of one event, which
     * {@code notifications_event_recipient_channel_key} does not forbid across different types
     * but which is two messages about one fact.
     *
     * <p><strong>Only at 48 hours.</strong> A saver is being invited, not chased, and §4.10 gives
     * them one row rather than two. The creator and the backers get both thresholds.
     */
    private List<NotificationRequest> endingSoon(OutboxMessage message, CampaignEndingSoon event) {
        UUID projectId = required(event.projectId(), "projectId", message);
        UUID creatorId = required(event.creatorId(), "creatorId", message);
        Integer hoursRemaining = required(event.hoursRemaining(), "hoursRemaining", message);
        Instant crossedAt = at(event.crossedAt(), message);

        NotificationType type = deadlineTypeFor(hoursRemaining, message);
        Map<String, Object> params = about(projectId, "hoursRemaining", hoursRemaining, "endsAt", event.endsAt());

        List<UUID> backers = audienceOf(projectId, ProjectAudience.BACKERS, message);
        List<NotificationRequest> requests = new ArrayList<>(everybody(
                // The creator first and never dropped by the bound, for GoalReached's reason.
                concat(creatorId, backers), type, projectId, params, crossedAt));

        if (type == NotificationType.DEADLINE_48H) {
            Set<UUID> alreadyTold = new LinkedHashSet<>(backers);
            alreadyTold.add(creatorId);
            List<UUID> savers = audienceOf(projectId, ProjectAudience.SAVERS, message).stream()
                    .filter(saver -> !alreadyTold.contains(saver))
                    .toList();
            requests.addAll(everybody(
                    savers, NotificationType.SAVED_PROJECT_ENDING_SOON, projectId, params, crossedAt));
        }
        return List.copyOf(requests);
    }

    /**
     * Which of §4.10's two deadline rows a threshold is.
     *
     * <p>An unrecognised threshold throws, and that is the same decision the class comment makes
     * about a payload this module cannot read: {@code deadline_notices_threshold_known} bounds
     * the producer to 48 and 24, so a third value means the producer and this consumer disagree
     * about the contract — which is a fault somebody has to see, and no redelivery fixes.
     * Quietly writing nothing would mean an entire campaign's backers not being told, with
     * nothing anywhere saying so.
     */
    private static NotificationType deadlineTypeFor(int hoursRemaining, OutboxMessage message) {
        return switch (hoursRemaining) {
            case 48 -> NotificationType.DEADLINE_48H;
            case 24 -> NotificationType.DEADLINE_24H;
            default -> throw new IllegalStateException("A " + message.eventType() + " event " + message.id()
                    + " reports " + hoursRemaining + " hours remaining, which is not one of §4.10's thresholds");
        };
    }

    /**
     * One of a campaign's computed audiences, from the port the module that owns the rows
     * publishes — #245.
     *
     * <p><strong>The bound is applied here and never silently.</strong> One more than the ceiling
     * is asked for, so "there were more" is a fact this method knows rather than one it infers
     * from a full page; when there were, it logs at {@code ERROR} naming the campaign and the
     * count, because the notifications that fall off the end are people the platform decided not
     * to tell. {@code AudienceProperties} argues the number and says what removes
     * the bound rather than raising it.
     *
     * <p>Not a failure, for {@code NotificationFanOut}'s reason: this listener shares the dispatch
     * transaction with every other consumer of the event, so throwing would destroy their writes
     * over a condition no redelivery can fix.
     *
     * <p><strong>The ceiling is per audience, not per event.</strong> An event that asks for two
     * audiences may therefore reach twice the ceiling, which is the right reading of a bound whose
     * purpose is to keep one query and one fan-out loop from becoming unbounded — and it is worth
     * stating, because the alternative reading would silently halve each audience on exactly the
     * events that have two.
     */
    private List<UUID> audienceOf(UUID projectId, ProjectAudience audience, OutboxMessage message) {
        int ceiling = properties.maxRecipients();
        List<UUID> members = audiences.membersOf(projectId, audience, ceiling + 1);

        if (members.size() <= ceiling) {
            return members;
        }
        log.error(
                "Campaign {} has more than {} members in its {} audience, so a notification from event {} reaches"
                        + " the first {} of them and the rest are not told; the fan-out has to be chunked to remove"
                        + " this bound",
                projectId,
                ceiling,
                audience,
                message.id(),
                ceiling);
        return members.subList(0, ceiling);
    }

    /**
     * The backers a saved segment matches, from the port the pledge module publishes — #98.
     *
     * <p>The same bound and the same {@code ERROR} as {@link #audienceOf}, through a different
     * port because a segment is identified by a row rather than named by a word;
     * {@code SegmentAudience} argues why one interface could not carry both questions.
     *
     * <p><strong>A segment deleted between the send and the delivery reaches nobody</strong>,
     * and this is not treated as a failure — {@code PledgeSegmentAudience} makes the argument.
     * It is also why {@code campaign_messages} freezes its recipient count when the message is
     * sent rather than leaving "who did this reach" to be recovered from here afterwards.
     */
    private List<UUID> segmentAudienceOf(UUID projectId, UUID segmentId, OutboxMessage message) {
        int ceiling = properties.maxRecipients();
        List<UUID> members = segments.membersOf(projectId, segmentId, ceiling + 1);

        if (members.size() <= ceiling) {
            return members;
        }
        log.error(
                "Segment {} on campaign {} matches more than {} backers, so the message from event {} reaches the"
                        + " first {} of them and the rest are not told; the fan-out has to be chunked to remove this"
                        + " bound",
                segmentId,
                projectId,
                ceiling,
                message.id(),
                ceiling);
        return members.subList(0, ceiling);
    }

    /**
     * A field the translation cannot proceed without.
     *
     * <p>Separate from the parse so that the message names the field. "Cannot read the
     * payload" and "read it, and there is nobody to tell" are different faults for
     * whoever has to fix the producer, and the first one wearing the second's name costs
     * an hour.
     */
    private static <T> T required(T value, String field, OutboxMessage message) {
        if (value == null) {
            throw new IllegalStateException(
                    "A " + message.eventType() + " event " + message.id() + " carries no " + field);
        }
        return value;
    }

    /** The instant the event reports, which every type of event must carry. */
    private static Instant at(Instant occurredAt, OutboxMessage message) {
        return required(occurredAt, "occurrence instant", message);
    }

    /**
     * The rendering document for a message about a campaign: what the campaign is, then
     * whatever else this type carries.
     *
     * <p>#249. Every notification about a campaign used to call it "this campaign", because
     * {@code params} had no title in it and the events behind these translations carry
     * identifiers and money and no title. {@code shared.project.ProjectSummaries} is the port
     * that supplies one, in the same shape as {@code ProjectAudiences} beside it: a question
     * the project module answers about its own rows, so the name is <em>asked for</em> rather
     * than read.
     *
     * <p><strong>Asked here, at translation time, and stored.</strong> The alternative —
     * looking the title up when the message is sent — is argued against in full on the port:
     * the short version is that it would render the title as it is now rather than as it was
     * when the thing happened, and it would put a cross-module read inside the delivery loop
     * for every recipient of every attempt.
     *
     * <p><strong>The public path goes in beside the title.</strong> §10.2's campaign page is
     * {@code /projects/{creatorSlug}/{projectSlug}}, so an identifier alone addresses no page
     * — which is what {@code EmailComposer} was building links out of. Both slugs or neither;
     * {@code ProjectSummary.hasPublicPath} decides.
     *
     * <p><strong>A campaign that cannot be found contributes nothing and is not an
     * error.</strong> The keys are simply absent, every reader falls back to the copy that
     * needs no title, and the notification is still written — which is the only acceptable
     * outcome for a lookup that exists to improve wording.
     *
     * @param projectId the campaign, which is also written into the document as
     *     {@code projectId} — including on the types whose subject is already the campaign,
     *     so that every reader finds the campaign in one place rather than in two depending
     *     on the type
     */
    /**
     * The due date as a person reads it: {@code 2026-10-05}, in UTC.
     *
     * <p>UTC and not the recipient's zone, because the platform does not know it — §21 has four
     * languages and no timezone preference — and a date that is a day out for somebody in Baku is
     * better than a timestamp nobody can read at all. The obligation has a week of slack in it,
     * so a day either way changes nothing a creator would act on.
     */
    private static String dueDate(Instant dueAt) {
        return dueAt == null ? "" : dueAt.atZone(java.time.ZoneOffset.UTC).toLocalDate().toString();
    }

    private Map<String, Object> about(UUID projectId, Object... facts) {
        Map<String, Object> params = new LinkedHashMap<>();
        if (projectId != null) {
            params.put("projectId", projectId);
        }

        ProjectSummary campaign = campaigns.summaryOf(projectId).orElse(null);
        if (campaign != null) {
            params.put("projectTitle", campaign.title());
            if (campaign.hasPublicPath()) {
                params.put("creatorSlug", campaign.creatorSlug());
                params.put("projectSlug", campaign.slug());
            }
        }

        params.putAll(params(facts));
        return params;
    }

    /**
     * The rendering document, as pairs.
     *
     * <p>A {@link LinkedHashMap} so the JSON comes out in the order written here, which
     * makes a stored document readable by whoever is debugging a template. Null values
     * are dropped rather than written: an absent key and a null one mean the same thing
     * to a template, and only one of them survives a round trip through jsonb
     * predictably.
     */
    private static Map<String, Object> params(Object... pairs) {
        if (pairs.length % 2 != 0) {
            throw new IllegalArgumentException("Parameters are name and value pairs");
        }
        Map<String, Object> params = new LinkedHashMap<>();
        for (int index = 0; index < pairs.length; index += 2) {
            Object value = pairs[index + 1];
            if (value != null) {
                params.put(Objects.toString(pairs[index]), value);
            }
        }
        return params;
    }
}
