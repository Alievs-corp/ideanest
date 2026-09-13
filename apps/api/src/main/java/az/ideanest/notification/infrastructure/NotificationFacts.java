package az.ideanest.notification.infrastructure;

import az.ideanest.notification.application.NotificationMessage;
import az.ideanest.notification.domain.NotificationType;
import az.ideanest.shared.money.Money;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.web.util.UriUtils;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * What a notification is about, read once for every channel that has to say it.
 *
 * <h2>Why this was extracted, and what it prevents</h2>
 *
 * <p>It was {@code EmailComposer}'s private half until #87 gave push a transport. Both
 * channels answer the same two questions — <em>which facts may this type's copy mention</em>
 * and <em>where does tapping it go</em> — and the answers are properties of the
 * notification rather than of email or of push.
 *
 * <p>Left where it was, the switch below would have been copied into a push composer, and
 * the copy would have been correct on the day it was made. The failure it prevents is not
 * hypothetical: {@code PAYMENT_FAILED} reads {@code attempt} into slot {@code 3}, and a
 * second extraction that read it into {@code 2} would produce a push notification saying
 * "we tried to collect 3 and the payment was declined" — from copy that is right, using
 * facts that are wrong, in a message about somebody's money.
 *
 * <p><strong>The paths are relative</strong>, and that is the one thing that genuinely
 * differs between the two channels: email resolves them against
 * {@code ideanest.notification.email.base-url} so a preview environment's mail does not
 * send readers to production, and push resolves them against the {@code ideanest://}
 * scheme so a tap opens the application rather than a browser. Returning a path rather
 * than a URL is what lets one method serve both.
 */
@Component
public class NotificationFacts {

    private final ObjectMapper json;

    public NotificationFacts(ObjectMapper json) {
        this.json = json;
    }

    /**
     * The rendering document.
     *
     * <p>An unreadable one yields an empty object rather than throwing, so that the
     * message still goes out — with the facts missing and the copy's fallbacks showing.
     * The schema already refuses a non-object ({@code notifications_params_is_an_object}),
     * so reaching this means something rewrote the column by hand.
     */
    public JsonNode paramsOf(String params) {
        if (params == null || params.isBlank()) {
            return json.createObjectNode();
        }
        try {
            JsonNode node = json.readTree(params);
            return node == null || !node.isObject() ? json.createObjectNode() : node;
        } catch (JacksonException malformed) {
            return json.createObjectNode();
        }
    }

    /**
     * Which facts this type's copy may refer to.
     *
     * <p>Only the keys the producing event actually writes are read. A type whose
     * producer does not exist yet reads nothing and gets copy that needs nothing, rather
     * than a guess about the shape of a payload nobody has written.
     *
     * <p>There is no {@code default}. Adding a constant to {@link NotificationType}
     * therefore fails to compile until somebody has decided what its copy may say, which
     * is the one property worth having here.
     */
    public EmailFacts factsFor(NotificationType type, JsonNode params, String recipientName) {
        // Read for every type rather than per branch, because it is not a fact any one type
        // carries -- it is what the message is about, and the branch below is only about
        // which further facts the copy may mention. Absent on a row written before #249, on
        // a message that is not about a campaign at all, and on one whose campaign could not
        // be found; in all three the `.named` copy is simply not used.
        EmailFacts facts = EmailFacts.of(recipientName).about(text(params, "projectTitle"));

        return switch (type) {
            // Produced today. The params are NotificationEventListener's, and the
            // names below are the names it writes.
            case PLEDGE_CONFIRMED, PLEDGE_EDITED -> facts.withAmount(money(params, "total"));
            case PAYMENT_FAILED -> facts.withAmount(money(params, "amount"))
                    .withDetail(text(params, "attempt"));
            case GOAL_REACHED -> facts.withAmount(money(params, "goal"));
            case CAMPAIGN_SUCCEEDED, CAMPAIGN_UNSUCCESSFUL -> facts.withAmount(money(params, "pledged"))
                    .withDetail(text(params, "backersCount"));
            case PROJECT_APPROVED -> facts;
            // IDN-EXT-01 (#34). The new deadline is the whole of the message: backers are
            // told, not asked, so the copy leads with the date and needs nothing else.
            case CAMPAIGN_EXTENDED -> facts.withDetail(text(params, "extendedUntil"));
            // #437's warning. `dueAt` is the date the copy leads with -- "soon" is what a
            // reminder says when it does not know, and this one does.
            case UPDATE_DUE_SOON -> facts.withDetail(text(params, "dueAt"));
            // Produced since #64 and #65 built the collection. The two lines below did not
            // change when the producer arrived, which was the point of writing them
            // against the params the future event was going to carry: `amount` and
            // `attempt` are what `CollectionEvents` writes, and the copy in
            // `messages.properties` was already written to read them.
            case PAYMENT_COLLECTED -> facts.withAmount(money(params, "amount"));
            case FINAL_PAYMENT_WARNING -> facts.withAmount(money(params, "amount"))
                    .withDetail(text(params, "attempt"));

            // Not produced yet. #69 owns the payout, #74 the surveys, #80 fulfilment, #83
            // updates, #84 comments, and #90 saving and following. Each reads the amount
            // its future event will carry where an amount is the point of the message, and
            // nothing where it is not.
            case PAYOUT_SENT -> facts.withAmount(money(params, "amount"));
            case NEW_UPDATE_PUBLISHED,
                    COMMENT_REPLY,
                    DIRECT_MESSAGE,
                    SURVEY_AVAILABLE,
                    SURVEY_OVERDUE,
                    REWARD_SHIPPED,
                    FOLLOWED_CREATOR_LAUNCHED,
                    LAUNCH_REMINDER,
                    SAVED_PROJECT_ENDING_SOON,
                    NEW_DEVICE_SIGN_IN -> facts;

            // The deadline reminders need no fact: how long is left is what the type is,
            // so the copy says it rather than reading it out of a document.
            //
            // DEADLINE_24H is here and has copy, and it can never be sent by email — §4.10
            // gives it no email column. It is a push row and nothing else, which is the
            // first time since NotificationType was written that the branch is reachable.
            case DEADLINE_48H, DEADLINE_24H -> facts;
        };
    }

    /**
     * Where tapping the message goes, as a path.
     *
     * <p>Five sources, in this order, and the order is the point:
     *
     * <ol>
     *   <li>The type, when the message is not about a campaign at all. Only
     *       {@code NEW_DEVICE_SIGN_IN} is: it is about the account, and what a person who
     *       did not recognise that sign-in needs is the session list.
     *   <li>The campaign's public path, {@code /projects/{creatorSlug}/{projectSlug}}, from
     *       the two slugs #249 puts in {@code params}. <strong>This is the only one of
     *       these that addresses the campaign page.</strong>
     *   <li>{@code params.projectId}, which the pledge-shaped types carry.
     *   <li>The subject, when it is a campaign.
     *   <li>The root. A message with nowhere specific to go still gives the reader
     *       somewhere to go, and a button pointing at nothing is worse than the home page.
     * </ol>
     *
     * <p><strong>The third and fourth are kept, and they are wrong.</strong> §10.2's
     * campaign page takes two slugs, so {@code /projects/{uuid}} matches no route and
     * answers 404 — which is what every email the platform had sent did, and what the rows
     * written before #249 will keep doing, because their documents hold no slugs and
     * nothing here can invent them. Removing them would send those readers to the home page
     * instead; that is arguably better and it is a change to what old messages do, so it is
     * left to whoever decides that rather than taken quietly here. Every row written from
     * now on takes the second branch.
     *
     * <p><strong>It matters more on push than it ever did on email.</strong> A browser
     * shown a 404 renders a page saying so. {@code apps/mobile}'s {@code lib/links.ts}
     * refuses a path it does not recognise outright, so a push notification built on the
     * third branch opens the application and goes nowhere at all — see
     * {@link PushComposer}, which is why it sends only the second.
     *
     * @return a path beginning with {@code /}, never empty and never a whole URL
     */
    public String pathFor(NotificationType type, JsonNode params, String subjectType, UUID subjectId) {
        if (type == NotificationType.NEW_DEVICE_SIGN_IN) {
            return "/settings/sessions";
        }

        String campaign = campaignPath(params);
        if (campaign != null) {
            return campaign;
        }

        UUID projectId = uuid(params);
        if (projectId != null) {
            return "/projects/" + projectId;
        }
        if ("project".equals(subjectType) && subjectId != null) {
            return "/projects/" + subjectId;
        }
        return "/";
    }

    /**
     * The campaign's public path from the two slugs, or null when the document has neither.
     *
     * <p>Separate from {@link #pathFor} because push needs exactly this and none of the
     * fallbacks: the fallbacks resolve to paths the mobile application has no screen for.
     */
    public String campaignPath(JsonNode params) {
        String creatorSlug = text(params, "creatorSlug");
        String projectSlug = text(params, "projectSlug");
        if (creatorSlug.isEmpty() || projectSlug.isEmpty()) {
            return null;
        }
        // Encoded although the shape check on both columns already restricts them to
        // lowercase, digits and hyphens. The value reaches here through a jsonb document,
        // and a link built by concatenation is the wrong place to rely on a constraint
        // several tables away.
        return "/projects/" + encode(creatorSlug) + "/" + encode(projectSlug);
    }

    /** Everything a message carries, in one call, for a channel that wants both halves. */
    public EmailFacts factsOf(NotificationMessage message, String recipientName) {
        return factsFor(message.type(), paramsOf(message.params()), recipientName);
    }

    /**
     * An amount from the document, formatted for reading, or empty when it is not there.
     *
     * <p>{@code amount + " " + currency}: unambiguous, stable, and free of the locale
     * question. A currency symbol and a thousands separator are a rendering decision that
     * differs per reader, and the reader here has no locale attached.
     *
     * <p>Read through the application's {@code ObjectMapper} so that {@link Money}'s own
     * deserialiser applies — §10.3 puts the amount in the document as a string, and
     * reading it as anything else is how a pledge becomes a double.
     */
    private String money(JsonNode params, String field) {
        JsonNode node = params.get(field);
        if (node == null || node.isNull()) {
            return "";
        }
        try {
            Money money = json.treeToValue(node, Money.class);
            return money.amount().toPlainString() + " " + money.currency();
        } catch (JacksonException notMoney) {
            // Not fatal, and deliberately so: the alternative is that one malformed
            // rendering document stops a person being told their payment failed. The
            // message goes out with the amount missing rather than not at all, and the
            // document is on the notification row for whoever investigates.
            return "";
        }
    }

    /**
     * One path segment, safe to concatenate.
     *
     * <p>{@link java.net.URLEncoder} is not used: it is written for form bodies, so it
     * encodes a space as {@code +}, which in a path is a plus sign rather than a space.
     */
    private static String encode(String segment) {
        return UriUtils.encodePathSegment(segment, StandardCharsets.UTF_8);
    }

    /** A scalar from the document as text, or empty when it is not there. */
    public static String text(JsonNode params, String field) {
        JsonNode node = params.get(field);
        return node == null || node.isNull() ? "" : node.asString();
    }

    /** {@code params.projectId} as an identifier, or null when it is absent or not one. */
    private static UUID uuid(JsonNode params) {
        JsonNode node = params.get("projectId");
        if (node == null || !node.isString()) {
            return null;
        }
        try {
            return UUID.fromString(node.asString());
        } catch (IllegalArgumentException notAnIdentifier) {
            // Same argument as money() above: a link that falls back to the site is a
            // worse message, and no message at all is a worse outcome than a worse one.
            return null;
        }
    }
}
