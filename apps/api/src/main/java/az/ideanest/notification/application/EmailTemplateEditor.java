package az.ideanest.notification.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.notification.domain.EmailTemplateVersion;
import az.ideanest.notification.domain.NotificationType;
import az.ideanest.notification.infrastructure.EmailTemplateVersionRepository;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.MessageSource;
import org.springframework.context.NoSuchMessageException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AD-15's third verb — §12.3, issue #315.
 *
 * <p>#86 built preview and test send and said what was missing in as many words: "editing
 * means storing a template, versioning it, and deciding who may change what a
 * payment-failure notice says; that is a screen and a schema". V52 is the schema, this is
 * the rule, and {@code EmailTemplateController} is the screen.
 *
 * <h2>The decision #315 was blocked on</h2>
 *
 * <p>"No decision on who may rewrite a payment-failure notice." It has two halves and only
 * one of them is a role question.
 *
 * <ul>
 *   <li><strong>Who.</strong> {@link StaffCapability#CONFIGURE_PLATFORM}, which only
 *       {@code SUPER_ADMIN} holds. Narrower than any other editorial permission on the
 *       platform, because this changes what the running service writes to everybody.
 *   <li><strong>What may not be removed.</strong> A payment-failure notice that no longer
 *       says which card was declined, or no longer carries the link to fix it, is worse
 *       than no override at all — and <em>no role check catches that</em>, because the
 *       administrator editing it is exactly the person who is allowed to. So the shipped
 *       copy's placeholders are extracted and the override must keep every one of them.
 * </ul>
 *
 * <p>That is a narrow answer to a narrow question. It does not settle the larger one —
 * whether a transactional notice should be editable at all — and #315's follow-up can
 * argue that now there is a screen to argue about.
 *
 * <h2>Every edit is a new version</h2>
 *
 * <p>Nothing is updated in place. "What did the notice say in March" is asked when somebody
 * claims they were never told their card had failed, and {@code email_deliveries} records
 * what was sent while this records what it was sent from.
 */
@Service
public class EmailTemplateEditor {

    private static final Logger log = LoggerFactory.getLogger(EmailTemplateEditor.class);

    /** Where {@code messages.properties} keeps this module's copy. Mirrors {@code EmailComposer}. */
    private static final String PREFIX = "email.";

    /**
     * A {@code MessageFormat} argument index.
     *
     * <p>{@code {0}} and {@code {1,number}} alike — the index is what has to survive an
     * edit, and the format is what the editor is allowed to change. Anchored on the digits
     * so that a body writing {@code {0,number,#.##}} still counts as carrying {@code 0}.
     */
    private static final Pattern PLACEHOLDER = Pattern.compile("\\{(\\d+)");

    private final EmailTemplateVersionRepository versions;
    private final TemplateOverrides overrides;
    private final MessageSource messages;
    private final PlatformStaff staff;
    private final AuditLog audit;

    public EmailTemplateEditor(
            EmailTemplateVersionRepository versions,
            TemplateOverrides overrides,
            MessageSource messages,
            PlatformStaff staff,
            AuditLog audit) {
        this.versions = versions;
        this.overrides = overrides;
        this.messages = messages;
        this.staff = staff;
        this.audit = audit;
    }

    /**
     * The shipped copy and the override, side by side.
     *
     * <p>Both, because an editor that showed only the current text would give somebody no
     * way to see what they had changed it from — and the shipped copy is what an override
     * is withdrawn back to.
     */
    @Transactional(readOnly = true)
    public TemplateDraft read(UUID staffId, NotificationType type, String locale) {
        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);

        String shippedSubject = shipped(type, "subject");
        String shippedBody = shipped(type, "body");

        return new TemplateDraft(
                type,
                locale,
                shippedSubject,
                shippedBody,
                placeholdersOf(shippedSubject, shippedBody),
                overrides.liveFor(type.name(), locale).orElse(null));
    }

    /** Every version ever written for this template and locale, newest first. */
    @Transactional(readOnly = true)
    public List<EmailTemplateVersion> history(UUID staffId, NotificationType type, String locale) {
        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);
        return versions.historyOf(type.name(), locale);
    }

    /**
     * Writes a new version and makes it live.
     *
     * <p>The previous live version is withdrawn in the same transaction, because V52
     * permits at most one live version per template and locale — so a write that committed
     * without the withdrawal would violate the index, and a withdrawal that committed
     * without the write would silently revert the platform to the shipped copy.
     *
     * @throws MissingTemplatePlaceholderException when the override drops a placeholder the
     *     shipped copy carries. The rule the class comment argues for
     */
    @Transactional
    public EmailTemplateVersion edit(
            UUID staffId, NotificationType type, String locale, String subject, String body, String note) {

        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);

        Set<String> required = placeholdersOf(shipped(type, "subject"), shipped(type, "body"));
        Set<String> present = placeholdersOf(subject, body);

        Set<String> missing = new LinkedHashSet<>(required);
        missing.removeAll(present);
        if (!missing.isEmpty()) {
            throw new MissingTemplatePlaceholderException(type, locale, missing);
        }

        versions.liveFor(type.name(), locale).ifPresent(EmailTemplateVersion::withdraw);

        int version = versions.highestVersionOf(type.name(), locale) + 1;
        EmailTemplateVersion written = versions.saveAndFlush(new EmailTemplateVersion(
                type.name(), locale, version, subject, body, List.copyOf(required), note, staffId));

        overrides.reload();

        audit.record(
                AuditAction.EMAIL_TEMPLATE_EDITED,
                written.id(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "template=%s; locale=%s; version=%d".formatted(type, locale, version));

        log.info("Email template {} ({}) edited to version {} by {}", type, locale, version, staffId);
        return written;
    }

    /**
     * Takes the override out of service, so the shipped copy renders again.
     *
     * <p>The versions stay. Withdrawing is not deleting — the history is what answers "what
     * did the notice say in March", and an override that was live for a month and then
     * removed is exactly the case that question is about.
     *
     * @return the version that was withdrawn, or empty when there was no override
     */
    @Transactional
    public Optional<EmailTemplateVersion> withdraw(UUID staffId, NotificationType type, String locale) {
        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);

        Optional<EmailTemplateVersion> live = versions.liveFor(type.name(), locale);
        live.ifPresent(version -> {
            version.withdraw();
            audit.record(
                    AuditAction.EMAIL_TEMPLATE_EDITED,
                    version.id(),
                    AuditActor.moderator(staffId),
                    AuditOutcome.SUCCEEDED,
                    "withdrawn; template=%s; locale=%s".formatted(type, locale));
        });

        overrides.reload();
        return live;
    }

    /**
     * The copy as it is shipped, for one key of one type.
     *
     * <p>{@link Locale#ROOT}, matching {@code EmailComposer}: the catalogue has one
     * language today and #123 is what gives it more. When it does, the shipped copy an
     * editor is shown will be the one in the locale they are editing, and this method takes
     * a locale — the argument is already threaded through every caller for that reason.
     */
    private String shipped(NotificationType type, String suffix) {
        try {
            return messages.getMessage(PREFIX + type.name() + "." + suffix, null, Locale.ROOT);
        } catch (NoSuchMessageException e) {
            // A type whose copy is missing is a build failure caught by EmailCopyTests, not
            // something a screen should crash on — so the editor shows an empty shipped
            // version and the override becomes the whole of it.
            return "";
        }
    }

    /** Every {@code MessageFormat} argument index used across the two strings. */
    private static Set<String> placeholdersOf(String subject, String body) {
        Set<String> found = new LinkedHashSet<>();
        for (String text : List.of(subject, body)) {
            Matcher matcher = PLACEHOLDER.matcher(text);
            while (matcher.find()) {
                found.add(matcher.group(1));
            }
        }
        return found;
    }

    /**
     * What an editor is shown.
     *
     * @param override the live version, or null when the shipped copy is what is being sent
     * @param requiredPlaceholders the argument indices an override must keep. Sent to the
     *     screen so it can say which are missing before the service refuses
     */
    public record TemplateDraft(
            NotificationType type,
            String locale,
            String shippedSubject,
            String shippedBody,
            Set<String> requiredPlaceholders,
            EmailTemplateVersion override) {
    }
}
