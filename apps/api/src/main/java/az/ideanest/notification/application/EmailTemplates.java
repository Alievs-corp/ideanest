package az.ideanest.notification.application;

import az.ideanest.notification.domain.NotificationChannel;
import az.ideanest.notification.domain.NotificationType;
import az.ideanest.notification.infrastructure.EmailComposer;
import az.ideanest.notification.infrastructure.EmailRenderer;
import az.ideanest.notification.infrastructure.MimeEmails;
import az.ideanest.notification.infrastructure.RenderedEmail;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.user.application.UserAccount;
import az.ideanest.user.application.UserAccounts;
import jakarta.mail.MessagingException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import az.ideanest.shared.ReaderLocale;
import java.util.Locale;

/**
 * AD-15's preview and test send, for the email half of §4.10.
 *
 * <p>AD-15 is "email templates: edit, preview, test send". <strong>Two of the three, and
 * the missing one is named rather than half-built.</strong> Editing means storing a
 * template, versioning it, and deciding who may change what a payment-failure notice
 * says; that is a screen and a schema and it belongs to the administration epic (#100).
 * What #86 owes is the ability to look at what the platform will actually send before it
 * sends it, and to receive one.
 *
 * <h2>Previews render the real path</h2>
 *
 * <p>The preview goes through {@code EmailComposer} and {@code EmailRenderer} — the same
 * two objects the sender uses — against a sample document. A preview built any other way
 * would be a picture of a template rather than of a message, and the first thing it would
 * stop catching is exactly the class of fault it exists to catch: a key that does not
 * resolve, a placeholder with no argument, a layout that breaks when a body has two
 * paragraphs.
 *
 * <h2>A test send goes to the caller, and only to the caller</h2>
 *
 * <p>{@link #testSend} takes no address. It reads the one on the staff account making the
 * request and sends there.
 *
 * <p>That is a deliberate refusal rather than a simplification. An authenticated endpoint
 * that takes an arbitrary recipient and a template is a machine for sending
 * platform-branded mail to anybody — the credential for which is one compromised staff
 * account — and the message it sends looks exactly like a real payment notice, because it
 * is one. Whatever "send a test to the address on the invoice" is worth, it is not worth
 * building that and hoping.
 *
 * <p>Nothing is written to {@code email_deliveries} for a test send, and it cannot be:
 * that table's rows point at a notification or a digest, and a test send is neither. It
 * is logged instead, with who asked and which template.
 */
@Service
public class EmailTemplates {

    private static final Logger log = LoggerFactory.getLogger(EmailTemplates.class);

    /**
     * The document a preview is rendered against.
     *
     * <p>One object carrying every field any type reads, rather than one per type:
     * {@code EmailComposer} takes only the keys its type asks for, so a superset is
     * exactly as accurate for each of them and there is one thing to keep in step with
     * the translations instead of twenty.
     *
     * <p>The identifier is fixed rather than random so that two previews of the same
     * template are the same bytes — which is what makes a diff between them meaningful
     * when somebody is reviewing a change to the copy.
     *
     * <p><strong>It carries a campaign name and both slugs</strong>, because since #249 the
     * platform's messages do. A sample without them would preview the fallback copy — the
     * wording reserved for rows written before that change — so a reviewer would be checking
     * the sentences the platform has stopped sending.
     */
    private static final String SAMPLE_PARAMS =
            """
            {
              "projectId": "01890000-0000-7000-8000-000000000001",
              "projectTitle": "Xari Bulbul Ceramics",
              "creatorSlug": "aysel-studio",
              "projectSlug": "xari-bulbul-ceramics",
              "total": {"amount": "120.00", "currency": "AZN"},
              "amount": {"amount": "120.00", "currency": "AZN"},
              "goal": {"amount": "5000.00", "currency": "AZN"},
              "pledged": {"amount": "6250.00", "currency": "AZN"},
              "backersCount": 184,
              "attempt": 2
            }""";

    /** The name a preview is addressed to. Not a real account, and not meant to be. */
    private static final String SAMPLE_RECIPIENT = "Aysel";

    /** Fixed, for {@link #SAMPLE_PARAMS}'s reason. */
    private static final UUID SAMPLE_NOTIFICATION = UUID.fromString("01890000-0000-7000-8000-000000000002");

    private final PlatformStaff staff;
    private final UserAccounts users;
    private final EmailComposer composer;
    private final EmailRenderer renderer;
    private final MimeEmails mime;
    private final Clock clock;

    public EmailTemplates(
            PlatformStaff staff,
            UserAccounts users,
            EmailComposer composer,
            EmailRenderer renderer,
            MimeEmails mime,
            Clock clock) {

        this.staff = staff;
        this.users = users;
        this.composer = composer;
        this.renderer = renderer;
        this.mime = mime;
        this.clock = clock;
    }

    /**
     * Which templates there are.
     *
     * <p>Exactly the types §4.10 gives an email column, which is what
     * {@link NotificationType#channels()} already answers — so a type that gains or loses
     * email changes this list by changing the enum, and never by anybody remembering to
     * change it here. {@code DEADLINE_24H} is the one type with copy and no email column,
     * and this is where it is left out.
     */
    public List<NotificationType> previewable(UUID staffAccountId) {
        staff.requireCapability(staffAccountId, StaffCapability.CONFIGURE_PLATFORM);
        return List.of(NotificationType.values()).stream()
                .filter(type -> type.channels().contains(NotificationChannel.EMAIL))
                .toList();
    }

    /** One template, rendered against the sample document. */
    @Transactional(readOnly = true)
    public RenderedEmail preview(UUID staffAccountId, NotificationType type) {
        staff.requireCapability(staffAccountId, StaffCapability.CONFIGURE_PLATFORM);
        requireEmail(type);

        /*
         * IN THE STAFF MEMBER'S OWN LANGUAGE — issue #324. A preview is read by whoever asked
         * for it, and rendering it in a language they do not read would make the one screen for
         * checking copy useless to them. It is not a claim about which language a recipient
         * gets: that is theirs, and `EmailChannelSender` takes it off their account.
         */
        Locale locale = ReaderLocale.of(
                users.findById(staffAccountId).map(UserAccount::locale).orElse(ReaderLocale.PRIMARY));

        return renderer.render(composer.compose(sampleOf(type), SAMPLE_RECIPIENT, locale), locale);
    }

    /**
     * Sends one template to the calling staff member's own address.
     *
     * <p>Rendered with their name rather than the sample one, because what is being
     * checked is a real message and the greeting is part of it.
     *
     * @throws MessagingException if the message cannot be built. The relay's own refusal
     *     is a {@code MailException} and is not caught either: this is an interactive
     *     request, so a failure belongs in the response rather than in a retry queue
     */
    public void testSend(UUID staffAccountId, NotificationType type) throws MessagingException {
        staff.requireCapability(staffAccountId, StaffCapability.CONFIGURE_PLATFORM);
        requireEmail(type);

        UserAccount recipient = users.findById(staffAccountId)
                .orElseThrow(() -> new IllegalStateException(
                        "A caller that passed the staff check has an account"));

        Locale locale = ReaderLocale.of(recipient.locale());
        RenderedEmail email =
                renderer.render(composer.compose(sampleOf(type), recipient.name(), locale), locale);
        // A fresh identifier per test send, unlike a notification's, which is stable
        // across attempts on purpose. Two test sends of one template are two messages
        // somebody asked for, and collapsing the second into the first would look like
        // the endpoint silently doing nothing.
        String messageId = mime.messageIdFor(Identifiers.newIdentifier());

        mime.send(mime.build(recipient.email().value(), recipient.name(), email, messageId));

        // Info, and it names the actor: this is a privileged action that puts mail on the
        // wire. It is not an audit_logs entry -- §17.4's audit is for actions that change
        // something, and this changes nothing -- but it is a line somebody can find.
        log.info("Staff {} sent themselves a test of the {} email template", staffAccountId, type);
    }

    /** The notification a preview stands in for. */
    private NotificationMessage sampleOf(NotificationType type) {
        return new NotificationMessage(
                SAMPLE_NOTIFICATION,
                SAMPLE_NOTIFICATION,
                type,
                NotificationChannel.EMAIL,
                "project",
                UUID.fromString("01890000-0000-7000-8000-000000000001"),
                SAMPLE_PARAMS,
                clock.instant().truncatedTo(ChronoUnit.MICROS),
                1);
    }

    /** Refuses a type the platform never emails — {@link TemplateNotEmailedException}. */
    private static void requireEmail(NotificationType type) {
        if (!type.channels().contains(NotificationChannel.EMAIL)) {
            throw new TemplateNotEmailedException(type);
        }
    }
}
