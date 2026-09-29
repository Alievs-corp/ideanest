package az.ideanest.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.notification.NotificationProperties;
import az.ideanest.notification.application.NotificationEvents.PledgeConfirmed;
import az.ideanest.notification.application.NotificationSender;
import az.ideanest.notification.application.PermanentDeliveryFailure;
import az.ideanest.notification.domain.DeliveryMode;
import az.ideanest.notification.domain.NotificationCategory;
import az.ideanest.notification.domain.NotificationChannel;
import az.ideanest.notification.application.NotificationDigestJob;
import az.ideanest.notification.application.NotificationMessage;
import az.ideanest.notification.domain.NotificationPreference;
import az.ideanest.notification.infrastructure.EmailChannelSender;
import az.ideanest.notification.infrastructure.EmailComposer;
import az.ideanest.notification.infrastructure.EmailDeliveryRepository;
import az.ideanest.notification.infrastructure.EmailRenderer;
import az.ideanest.notification.infrastructure.MimeEmails;
import az.ideanest.notification.infrastructure.NotificationPreferenceRepository;
import az.ideanest.notification.infrastructure.NotificationRepository;
import az.ideanest.user.application.UserAccounts;
import az.ideanest.shared.money.Money;
import az.ideanest.shared.outbox.Outbox;
import az.ideanest.shared.outbox.OutboxRelay;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.MailServerStub;
import jakarta.mail.Multipart;
import jakarta.mail.internet.MimeMessage;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * That an email actually goes out, and that what goes out is a message a client can read.
 *
 * <p>Everything here runs through the real {@code EmailChannelSender} against a real SMTP
 * server ({@code MailServerStub}), because the properties worth asserting are properties
 * of the bytes: both parts of the {@code multipart/alternative}, the subject, the
 * {@code Message-ID}. A mocked {@code JavaMailSender} would prove the code called
 * {@code send}, which nobody doubted.
 *
 * <p>The other half is what is written down about it. {@code email_deliveries} is the
 * only record of what the transport did, and V30's header is emphatic about what it may
 * and may not claim — so these tests check the row as well as the mailbox, and in
 * particular that a suppression and a refusal are told apart.
 *
 * <p>The ones that carry the design:
 *
 * <ul>
 *   <li>{@link #theMessageIdIsDerivedFromTheNotification()} — the queue is at-least-once
 *       by design, so what makes a duplicate harmless is that the second copy carries the
 *       first one's identifier. Nothing else on this side can prevent it.
 *   <li>{@link #anAnonymisedRecipientIsSuppressedAndDeadLetteredAtOnce()} — the third
 *       outcome {@code ChannelSender} did not have, and the reason it was added: eight
 *       retries against a deleted account is a retry budget spent on a settled question.
 *   <li>{@link #aRefusedSendIsRecordedAndRethrown()} — a refusal is recorded and then
 *       propagated, because the dispatcher is what counts attempts. A transport that
 *       swallowed it would have the notification recorded as sent.
 * </ul>
 */
class EmailTransportTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String AGGREGATE = "pledge";

    /** §4.10 gives {@code PLEDGE_CONFIRMED} email, push and in-app. */
    private static final int PLEDGE_CONFIRMED_CHANNELS = 3;

    /**
     * The campaign the messages here are about.
     *
     * <p>Named rather than left as the seed's default, which is the slug: since #249 the
     * subject line carries the title, so a fixture whose campaign is called
     * {@code email-4} produces assertions that read as though something were wrong with
     * them.
     */
    private static final String CAMPAIGN = "Xari Bulbul Ceramics";

    @Autowired
    private NotificationSender sender;

    @Autowired
    private NotificationProperties properties;

    @Autowired
    private NotificationPreferenceRepository preferences;

    @Autowired
    private Outbox outbox;

    @Autowired
    private OutboxRelay relay;

    @Autowired
    private PlatformTransactionManager transactions;

    @Autowired
    private DataSource dataSource;

    private UUID backerId;
    private UUID projectId;
    private String handle;
    private Instant now;

    @BeforeEach
    void anAccountWithAnAddress() {
        // Before anything is sent, not after: the server is shared with every other
        // class in the suite, so a mailbox cleared at the end of a test is a mailbox
        // somebody else may have written to in between.
        MailServerStub.clear();
        now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        handle = "email-" + SEQUENCE.incrementAndGet();
        backerId = Campaigns.creator(dataSource, handle);

        /*
         * THE FIXTURE'S LANGUAGE IS STATED RATHER THAN INHERITED -- issue #324. Emails go out
         * in the recipient's own language now, and `users.locale` defaults to `az`, so a suite
         * about transport that asserted an English subject would be asserting the column's
         * default. It is English here because the assertions below are written in English;
         * `theLanguageFollowsTheAccount` is the test that is actually about the language.
         */
        new JdbcTemplate(dataSource).update("UPDATE users SET locale = 'en' WHERE id = ?", backerId);

        projectId = Campaigns.seed(dataSource, backerId, handle)
                .state("LIVE")
                .title(CAMPAIGN)
                .insert();
    }

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        // Deliveries first: they reference notifications, and the cascade would take
        // them anyway -- doing it explicitly keeps the intent visible.
        jdbc.update("DELETE FROM email_deliveries");
        jdbc.update("DELETE FROM notifications");
        jdbc.update("DELETE FROM notification_preferences");
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update("DELETE FROM projects WHERE id = ?", projectId);
    }

    // ------------------------------------------------------------------
    // What arrives
    // ------------------------------------------------------------------

    /**
     * That the language comes off the account rather than off the platform — issue #324.
     *
     * <p>The one assertion in this suite that is about the language rather than about the
     * transport, and the reason the fixture above states its own: {@code EmailChannelSender}
     * reads {@code users.locale} off the {@code UserAccount} it already loaded for the address,
     * so changing the column changes the message. Before #324 every email came out of the root
     * bundle and this test would have passed with the same English subject as the one below.
     */
    @Test
    @DisplayName("the language of an email is the recipient's, not the platform's")
    void theLanguageFollowsTheAccount() throws Exception {
        new JdbcTemplate(dataSource).update("UPDATE users SET locale = 'az' WHERE id = ?", backerId);

        confirm();
        drain();

        MimeMessage received = MailServerStub.awaitOne();
        assertThat(received.getSubject())
                .as("the same notification, in the language the account reads")
                .isEqualTo(CAMPAIGN + " kampaniyasına dəstəyiniz təsdiqləndi");
    }

    @Test
    @DisplayName("a pending email notification reaches the relay as a message with both parts")
    void anEmailArrivesWithBothParts() throws Exception {
        confirm();

        drain();

        MimeMessage received = MailServerStub.awaitOne();
        assertThat(received.getSubject()).isEqualTo("Your pledge to " + CAMPAIGN + " is confirmed");
        // The header carries the display name too -- "Creator email-4
        // <email-4@example.com>" -- which is the point of encoding it, so the assertion
        // is on both rather than on a bare address.
        assertThat(addressesOf(received))
                .singleElement(org.assertj.core.api.InstanceOfAssertFactories.STRING)
                .contains(handle + "@example.com")
                .contains("Creator " + handle);
        assertThat(received.getFrom()[0].toString()).contains(properties.email().from());

        List<String> parts = partsOf(received);
        assertThat(parts).as("multipart/alternative carries a text part and an HTML part").hasSize(2);
        assertThat(parts.get(0))
                .as("the plain-text part is first, so a client that understands both shows the HTML")
                .contains("Thank you, Creator " + handle)
                .doesNotContain("<table");
        assertThat(parts.get(1)).as("and the HTML part is second").contains("<table");
    }

    /** Only one of the three channels has a transport, so only one message leaves. */
    @Test
    @DisplayName("only the email channel reaches a relay")
    void theOtherChannelsSendNoMail() {
        confirm();

        int sent = drain();

        assertThat(sent).isEqualTo(PLEDGE_CONFIRMED_CHANNELS);
        assertThat(MailServerStub.awaitMessages(1))
                .as("in-app writes a row and push has no transport; neither is mail")
                .hasSize(1);
    }

    /**
     * The whole of this side's obligation about duplicates.
     *
     * <p>{@code NotificationDispatch} sends and then commits, so a crash in between sends
     * again — chosen deliberately, because the other order loses messages silently. What
     * makes the duplicate survivable is that both copies carry the same
     * {@code Message-ID}, which conforming clients collapse. That requires the identifier
     * to be derived from the notification rather than generated per send, and this is
     * where that is checked.
     */
    @Test
    @DisplayName("the Message-ID is derived from the notification, so a duplicate is collapsible")
    void theMessageIdIsDerivedFromTheNotification() throws Exception {
        confirm();
        drain();

        UUID notificationId = idOf(NotificationChannel.EMAIL);
        String expected = "<" + notificationId + "@" + properties.email().messageIdDomain() + ">";

        assertThat(MailServerStub.awaitOne().getHeader("Message-ID"))
                .as("JavaMail generates its own unless Spring is asked to keep this one")
                .containsExactly(expected);
        assertThat(deliveryColumn("message_id", String.class)).isEqualTo(expected);
    }

    // ------------------------------------------------------------------
    // What is written down
    // ------------------------------------------------------------------

    /**
     * That the record says acceptance and not delivery.
     *
     * <p>The column is {@code accepted_at} and V30 spends a section on why. Asserted here
     * so that renaming it to something stronger breaks a test rather than only a comment.
     */
    @Test
    @DisplayName("an accepted send is recorded as accepted, with the subject and the attempt")
    void acceptanceIsRecorded() {
        confirm();

        drain();
        MailServerStub.awaitOne();

        assertThat(deliveryColumn("outcome", String.class)).isEqualTo("ACCEPTED");
        assertThat(deliveryColumn("accepted_at", Instant.class)).isNotNull();
        assertThat(deliveryColumn("subject", String.class)).isEqualTo("Your pledge to " + CAMPAIGN + " is confirmed");
        assertThat(deliveryColumn("type", String.class)).isEqualTo("PLEDGE_CONFIRMED");
        assertThat(deliveryColumn("attempt", Integer.class)).isEqualTo(1);
        assertThat(deliveryColumn("detail", String.class))
                .as("an accepted send has no why; the outcome is the whole of the fact")
                .isNull();
    }

    // ------------------------------------------------------------------
    // The third outcome
    // ------------------------------------------------------------------

    /**
     * The case {@code PermanentDeliveryFailure} was added for.
     *
     * <p>§17.4's anonymisation rewrites the address to a {@code .invalid} one, which RFC
     * 2606 reserves as never resolving. Retrying that eight times over an hour spends the
     * retry budget of a queue everything shares on a question already answered — so the
     * row is dead-lettered on the first pass, and the delivery log says it was suppressed
     * rather than refused.
     */
    @Test
    @DisplayName("an anonymised recipient is suppressed and dead-lettered at once")
    void anAnonymisedRecipientIsSuppressedAndDeadLetteredAtOnce() {
        confirm();
        anonymise(backerId);

        drain();

        assertThat(MailServerStub.received()).as("nothing is sent to a .invalid address").isEmpty();
        assertThat(stateOf(NotificationChannel.EMAIL))
                .as("dead on the first attempt, not after eight")
                .isEqualTo("DEAD");
        assertThat(attemptsOf(NotificationChannel.EMAIL)).isEqualTo(1);
        assertThat(lastErrorOf(NotificationChannel.EMAIL)).contains("anonymised");
        assertThat(lastErrorOf(NotificationChannel.EMAIL))
                .as("§17.4: the error column is read by people who are not the recipient")
                .doesNotContain("@");

        assertThat(deliveryColumn("outcome", String.class)).isEqualTo("SUPPRESSED");
        assertThat(deliveryColumn("subject", String.class))
                .as("nothing was rendered: the decision not to send precedes the template")
                .isNull();
        assertThat(deliveryColumn("accepted_at", Instant.class)).isNull();
        assertThat(deliveryColumn("detail", String.class)).isNotBlank();
    }

    /**
     * That a suppression really does end the row rather than merely skipping a pass.
     *
     * <p>The failure this guards against is a dead letter that is still claimable, which
     * would be the retry loop the whole branch exists to prevent — with a delivery row
     * written every second.
     */
    @Test
    @DisplayName("a suppressed notification stops being work")
    void aSuppressedNotificationIsNotClaimedAgain() {
        confirm();
        anonymise(backerId);
        drain();

        Instant later = now.plus(Duration.ofHours(1));
        assertThat(sender.sendPending(later)).isZero();
        assertThat(deliveryCount()).as("one attempt, one row, and no more of either").isEqualTo(1);
    }

    // ------------------------------------------------------------------
    // A refusal
    // ------------------------------------------------------------------

    /**
     * That a relay's refusal is recorded and then propagated.
     *
     * <p>Driven through {@code EmailChannelSender} directly with a transport that throws,
     * rather than by taking the shared SMTP server down: the server is the whole suite's,
     * and a test that stopped it would fail whichever class happened to be sending at the
     * time. What is being asserted is this class's behaviour on a refusal, and the refusal
     * itself is the least interesting part of it.
     *
     * <p>Rethrowing matters as much as recording. {@code NotificationDispatch} is what
     * counts the attempt and backs off; a transport that swallowed the failure would leave
     * the notification recorded as sent to somebody who received nothing.
     */
    @Test
    @DisplayName("a refused send is recorded as refused and rethrown")
    void aRefusedSendIsRecordedAndRethrown() {
        confirm();

        assertThatThrownBy(() -> refusingSender().send(emailMessage()))
                .as("the contract says a channel reports failure by throwing")
                .isInstanceOf(RuntimeException.class)
                .isNotInstanceOf(PermanentDeliveryFailure.class);

        assertThat(deliveryColumn("outcome", String.class)).isEqualTo("REFUSED");
        assertThat(deliveryColumn("accepted_at", Instant.class))
                .as("only an accepted message has an acceptance time")
                .isNull();
        assertThat(deliveryColumn("detail", String.class)).isNotBlank();
        assertThat(deliveryColumn("subject", String.class))
                .as("it was rendered before it was refused, so the record knows what did not go")
                .isEqualTo("Your pledge to " + CAMPAIGN + " is confirmed");
    }

    // ------------------------------------------------------------------
    // The digest
    // ------------------------------------------------------------------

    /**
     * §12.2's digest, as one message rather than several.
     *
     * <p>The point of the preference is that it is one message; three sends would be the
     * preference not being honoured, which is what #244 reported for the queue and what
     * this checks for the transport.
     */
    @Test
    @DisplayName("a digest goes out as one message listing its members")
    void aDigestIsOneMessage() throws Exception {
        preferences.save(NotificationPreference.of(
                backerId,
                NotificationCategory.PLEDGES,
                NotificationChannel.EMAIL,
                DeliveryMode.DIGEST,
                now));

        Instant digestHour = properties.digest().window().lastClosedAt(Instant.now());
        confirmAt(digestHour.minus(Duration.ofHours(6)));
        confirmAt(digestHour.minus(Duration.ofHours(4)));

        digestJob.combineDue(Instant.now().truncatedTo(ChronoUnit.MICROS));

        MimeMessage received = MailServerStub.awaitOne();
        assertThat(received.getSubject()).isEqualTo("Your IdeyaNest summary");
        assertThat(partsOf(received).get(0))
                .as("one message, and both things in it")
                .contains("There are 2")
                .contains("Your pledge of 50.00 AZN to " + CAMPAIGN + " was confirmed");

        assertThat(deliveryColumn("outcome", String.class)).isEqualTo("ACCEPTED");
        assertThat(deliveryColumn("member_count", Integer.class)).isEqualTo(2);
        assertThat(deliveryColumn("digest_id", UUID.class)).isNotNull();
        assertThat(deliveryColumn("notification_id", UUID.class))
                .as("a digest is about several notifications, so it names none of them")
                .isNull();
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    @Autowired
    private NotificationDigestJob digestJob;

    @Autowired
    private NotificationRepository notifications;

    @Autowired
    private JavaMailSender mailSender;

    @Autowired
    private UserAccounts users;

    @Autowired
    private EmailComposer composer;

    @Autowired
    private EmailRenderer renderer;

    @Autowired
    private EmailDeliveryRepository deliveries;

    @Autowired
    private Clock clock;

    /**
     * The real sender, wired to a transport that refuses everything.
     *
     * <p>Only {@link MimeEmails#send} is replaced: the message is still built by the real
     * code, against the real {@code JavaMailSender}, so what is refused is a message that
     * would otherwise have gone. Overriding {@code build} instead would test a refusal of
     * something the platform never produces.
     */
    private EmailChannelSender refusingSender() {
        MimeEmails refusing = new MimeEmails(mailSender, properties) {
            @Override
            public void send(MimeMessage message) {
                throw new MailSendException("the relay is unreachable");
            }
        };
        return new EmailChannelSender(refusing, users, composer, renderer, deliveries, clock);
    }

    /** The EMAIL notification the fan-out wrote, as a sender is handed it. */
    private NotificationMessage emailMessage() {
        return NotificationMessage.of(
                notifications.findById(idOf(NotificationChannel.EMAIL)).orElseThrow());
    }

    private void anonymise(UUID userId) {
        new JdbcTemplate(dataSource)
                .update(
                        "UPDATE users SET email = ? WHERE id = ?",
                        "deleted-" + userId + "@anonymised.invalid",
                        userId);
    }

    private void confirm() {
        confirmAt(now);
        // After the fan-out: a row's first next_attempt_at is the instant it was written,
        // so a pass judged against an earlier instant finds nothing and every assertion
        // below would read zero for the wrong reason.
        now = Instant.now().truncatedTo(ChronoUnit.MICROS);
    }

    private void confirmAt(Instant occurredAt) {
        UUID pledgeId = UUID.randomUUID();
        PledgeConfirmed event = new PledgeConfirmed(
                pledgeId, projectId, backerId, Money.of(new BigDecimal("50.00"), "AZN"), occurredAt);
        new TransactionTemplate(transactions)
                .executeWithoutResult(status -> outbox.record(AGGREGATE, pledgeId, PledgeConfirmed.EVENT_TYPE, event));
        relay.run();
    }

    /** Passes until the queue stops yielding, so a bounded pass is not a limit here. */
    private int drain() {
        int sent = 0;
        for (int pass = 0; pass < PLEDGE_CONFIRMED_CHANNELS; pass++) {
            sent += sender.sendPending(now);
        }
        return sent;
    }

    private static List<String> addressesOf(MimeMessage message) throws Exception {
        return List.of(message.getAllRecipients()).stream()
                .map(Object::toString)
                .toList();
    }

    /** The bodies of a {@code multipart/alternative}, in the order they were written. */
    private static List<String> partsOf(MimeMessage message) throws Exception {
        Object content = message.getContent();
        if (!(content instanceof Multipart multipart)) {
            throw new AssertionError("Expected multipart/alternative and got " + message.getContentType());
        }
        return partsIn(multipart);
    }

    private static List<String> partsIn(Multipart multipart) throws Exception {
        List<String> parts = new ArrayList<>();
        for (int part = 0; part < multipart.getCount(); part++) {
            Object body = multipart.getBodyPart(part).getContent();
            if (body instanceof Multipart nested) {
                parts.addAll(partsIn(nested));
            } else {
                parts.add(body.toString());
            }
        }
        return parts;
    }

    private <T> T deliveryColumn(String column, Class<T> type) {
        return jdbc().queryForObject("SELECT " + column + " FROM email_deliveries", type);
    }

    private int deliveryCount() {
        return jdbc().queryForObject("SELECT count(*) FROM email_deliveries", Integer.class);
    }

    private String stateOf(NotificationChannel channel) {
        return columnFor(channel, "state", String.class);
    }

    private String lastErrorOf(NotificationChannel channel) {
        return columnFor(channel, "last_error", String.class);
    }

    private int attemptsOf(NotificationChannel channel) {
        return columnFor(channel, "attempts", Integer.class);
    }

    private UUID idOf(NotificationChannel channel) {
        return columnFor(channel, "id", UUID.class);
    }

    private <T> T columnFor(NotificationChannel channel, String column, Class<T> type) {
        return jdbc().queryForObject(
                "SELECT " + column + " FROM notifications WHERE channel = ?", type, channel.name());
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
