package az.ideanest.notification.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.notification.domain.EmailTemplateVersion;
import az.ideanest.notification.domain.NotificationChannel;
import az.ideanest.notification.domain.NotificationType;
import az.ideanest.notification.infrastructure.EmailTemplateVersionRepository;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
 * <p>An edit is also refused when it would not render — {@link TemplateCopyMalformedException}
 * — because the place that discovered an unbalanced brace used to be the sender, on a
 * background thread, with real mail.
 *
 * <h2>Every edit is a new version</h2>
 *
 * <p>Nothing is updated in place. "What did the notice say in March" is asked when somebody
 * claims they were never told their card had failed, and {@code email_deliveries} records
 * what was sent while this records what it was sent from.
 *
 * <h2>Per language</h2>
 *
 * <p>Every method takes one of §21.1's four locales and works on that language's override
 * only. A recipient gets the live override for their language when there is one and the
 * shipped copy of their language otherwise — {@code TemplateOverrides.localeOf} is the one
 * rule for which language that is.
 */
@Service
public class EmailTemplateEditor {

    private static final Logger log = LoggerFactory.getLogger(EmailTemplateEditor.class);

    private final EmailTemplateVersionRepository versions;
    private final TemplateOverrides overrides;
    private final ShippedCopy shipped;
    private final PlatformStaff staff;
    private final AuditLog audit;
    private final Clock clock;

    public EmailTemplateEditor(
            EmailTemplateVersionRepository versions,
            TemplateOverrides overrides,
            ShippedCopy shipped,
            PlatformStaff staff,
            AuditLog audit,
            Clock clock) {
        this.versions = versions;
        this.overrides = overrides;
        this.shipped = shipped;
        this.staff = staff;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * The shipped copy and the override, side by side, in one language.
     *
     * <p>Both, because an editor that showed only the current text would give somebody no
     * way to see what they had changed it from — and the shipped copy is what an override
     * is withdrawn back to.
     */
    @Transactional(readOnly = true)
    public TemplateDraft read(UUID staffId, NotificationType type, String locale) {
        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);
        requireEmail(type);

        return new TemplateDraft(
                type,
                locale,
                shipped.of(type, locale),
                overrides.liveFor(type.name(), locale).orElse(null));
    }

    /** Every version ever written for this template and locale, newest first. */
    @Transactional(readOnly = true)
    public List<EmailTemplateVersion> history(UUID staffId, NotificationType type, String locale) {
        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);
        requireEmail(type);
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
     * @throws TemplateCopyMalformedException when the text would not render
     * @throws MissingTemplatePlaceholderException when the override drops a placeholder the
     *     shipped copy carries. The rule the class comment argues for
     */
    @Transactional
    public EmailTemplateVersion edit(
            UUID staffId, NotificationType type, String locale, String subject, String body, String note) {

        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);
        requireEmail(type);

        ShippedCopy.Copy original = shipped.of(type, locale);
        EditedCopy edited = new EditedCopy(subject, body);
        original.check(edited);

        List<String> missing = original.missingFrom(edited);
        if (!missing.isEmpty()) {
            throw new MissingTemplatePlaceholderException(type, locale, missing);
        }

        versions.lockForWriting(lockKey(type, locale));
        versions.liveFor(type.name(), locale).ifPresent(EmailTemplateVersion::withdraw);

        int version = versions.highestVersionOf(type.name(), locale) + 1;
        EmailTemplateVersion written = versions.saveAndFlush(new EmailTemplateVersion(
                type.name(),
                locale,
                version,
                subject,
                body,
                List.copyOf(original.required()),
                note,
                staffId,
                clock.instant().truncatedTo(ChronoUnit.MICROS)));

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
     * Takes the override in one language out of service, so that language's shipped copy
     * renders again.
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
        requireEmail(type);

        versions.lockForWriting(lockKey(type, locale));
        Optional<EmailTemplateVersion> live = versions.liveFor(type.name(), locale);
        live.ifPresent(version -> {
            version.withdraw();
            audit.record(
                    AuditAction.EMAIL_TEMPLATE_WITHDRAWN,
                    version.id(),
                    AuditActor.moderator(staffId),
                    AuditOutcome.SUCCEEDED,
                    "template=%s; locale=%s; version=%d".formatted(type, locale, version.version()));
        });

        overrides.reload();
        return live;
    }

    /** Refuses a type the platform never emails — {@link TemplateNotEmailedException}. */
    static void requireEmail(NotificationType type) {
        if (!type.channels().contains(NotificationChannel.EMAIL)) {
            throw new TemplateNotEmailedException(type);
        }
    }

    private static String lockKey(NotificationType type, String locale) {
        return "email_template_versions:" + type.name() + ":" + locale;
    }

    /**
     * What an editor is shown.
     *
     * @param shipped the shipped copy in this language, with the placeholders an override must
     *     keep and may use. Sent to the screen so it can say which are missing before the
     *     service refuses
     * @param override the live version, or null when the shipped copy is what is being sent
     */
    public record TemplateDraft(
            NotificationType type, String locale, ShippedCopy.Copy shipped, EmailTemplateVersion override) {
    }
}
