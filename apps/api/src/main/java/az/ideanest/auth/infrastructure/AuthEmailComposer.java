package az.ideanest.auth.infrastructure;

import az.ideanest.notification.application.TransactionalMail;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.context.MessageSource;
import org.springframework.stereotype.Component;

/**
 * What the seven auth emails say.
 *
 * <p>The counterpart of {@code EmailComposer}, for the messages that are not
 * notifications. It reads {@code messages.properties} and produces a
 * {@link TransactionalMail}; it does not send anything, and it does not know how.
 *
 * <h2>No name in the greeting, and that is a decision</h2>
 *
 * <p>{@code EmailComposer} opens with the recipient's name because a notification is
 * always about an account the platform already knows. Half of these are not: a
 * verification link goes to an address whose account is minutes old and may carry a name
 * somebody has not confirmed, and a message to an address with no account has nobody to
 * name at all. Looking one up would mean the auth module querying profiles to write
 * "Hello Aysel" on a password reset — a database round trip, a module dependency, and an
 * enumeration risk on the one endpoint that is careful never to say whether an address is
 * registered. So the copy addresses nobody by name and reads correctly in every case.
 *
 * <h2>Why there is no expiry in the wording</h2>
 *
 * <p>Every link here has a TTL and {@code AuthProperties} owns it, so putting "valid for
 * 24 hours" in the copy is either a second place the number lives or a placeholder. The
 * placeholder is worse than it looks: the reset link's TTL is one hour, so a single
 * sentence has to read correctly at {@code 1} and at {@code 24}, and Russian needs three
 * plural forms to do it. The copy says to ask for a new link if this one has expired,
 * which is true at every duration and is also the only sentence that tells the reader
 * what to <em>do</em>.
 */
@Component
public class AuthEmailComposer {

    /** Where this module's copy lives in the catalogue. */
    private static final String PREFIX = "email.auth.";

    private final MessageSource messages;

    public AuthEmailComposer(MessageSource messages) {
        this.messages = messages;
    }

    /** A-01's link: the one that proves a new account's address. */
    public TransactionalMail verifyEmail(String token, Locale locale) {
        return withAction("VERIFY_EMAIL", "/verify-email", token, locale);
    }

    /**
     * What the owner of an already-registered address is told when somebody tries to
     * register it again.
     *
     * <p>The button goes to the password reset form rather than to sign-in. Somebody
     * receiving this either typed the address themselves and had forgotten they have an
     * account — in which case they want a password, not a sign-in form they will fail —
     * or did not, in which case the reset form is the page that lets them take the
     * account back.
     */
    public TransactionalMail registrationOnExistingAccount(Locale locale) {
        return withAction("REGISTRATION_ON_EXISTING_ACCOUNT", "/reset-password", null, locale);
    }

    /** A-06's link: sets a new password without the old one. */
    public TransactionalMail passwordReset(String token, Locale locale) {
        return withAction("PASSWORD_RESET", "/reset-password/confirm", token, locale);
    }

    /**
     * The notice that a password changed.
     *
     * <p>A button, and it goes to the reset form. This message is worth sending only for
     * the reader who did not do it, and what that reader needs is the shortest path to
     * taking the account back — which is a new password, from an address they still
     * control.
     */
    public TransactionalMail passwordChanged(Locale locale) {
        return withAction("PASSWORD_CHANGED", "/reset-password", null, locale);
    }

    /** A-12's link, to the address being proven. */
    public TransactionalMail emailChangeConfirmation(String token, Locale locale) {
        return withAction("EMAIL_CHANGE_CONFIRMATION", "/confirm-email-change", token, locale);
    }

    /**
     * A-12's other half, to the address the account is leaving.
     *
     * <p>No button, because there is nothing this address can do: it cannot approve the
     * change and it cannot stop it. What it can do is tell somebody, and the copy says
     * how — which is a sentence rather than a link, because the link would have to point
     * at an account this address is about to stop being able to reach.
     *
     * @param newAddress the address the account is moving to, in full. The one fact the
     *     message exists to carry
     */
    public TransactionalMail emailChangeNotice(String newAddress, Locale locale) {
        String base = PREFIX + "EMAIL_CHANGE_NOTICE.";
        Object[] arguments = {newAddress};
        return TransactionalMail.withoutAction(
                copy(base + "subject", arguments, locale),
                copy(base + "headline", arguments, locale),
                paragraphs(base, arguments, locale));
    }

    /**
     * What the owner of an address is told when somebody asks to move another account
     * onto it (#587).
     *
     * <p>No button, unlike its registration counterpart. Nothing happened to this
     * account and nothing can: the request was answered as though it had worked, and
     * the account asking was not sent a link. The message is there so the owner knows,
     * not so they act.
     */
    public TransactionalMail emailChangeOnExistingAccount(Locale locale) {
        String base = PREFIX + "EMAIL_CHANGE_ON_EXISTING_ACCOUNT.";
        return TransactionalMail.withoutAction(
                copy(base + "subject", null, locale),
                copy(base + "headline", null, locale),
                paragraphs(base, null, locale));
    }

    /**
     * One message with a button, from its key and its destination.
     *
     * @param path where the button goes, without the query string
     * @param token appended as {@code ?token=…} when there is one, and omitted when there
     *     is not — {@code PASSWORD_CHANGED} and the registration notice send the reader
     *     to a form rather than to a link only they can follow
     */
    private TransactionalMail withAction(String message, String path, String token, Locale locale) {
        String base = PREFIX + message + ".";
        return TransactionalMail.withAction(
                copy(base + "subject", null, locale),
                copy(base + "headline", null, locale),
                paragraphs(base, null, locale),
                copy(base + "action", null, locale),
                token == null ? path : path + "?token=" + URLEncoder.encode(token, StandardCharsets.UTF_8));
    }

    /**
     * The body, as however many paragraphs the message has.
     *
     * <p>{@code .body} is required and {@code .body2} is optional, which is
     * {@code EmailComposer}'s convention and is followed rather than improved on: two
     * shapes of properties file for one layout would be one shape too many.
     */
    private List<String> paragraphs(String base, Object[] arguments, Locale locale) {
        List<String> paragraphs = new ArrayList<>(2);
        paragraphs.add(copy(base + "body", arguments, locale));
        String second = messages.getMessage(base + "body2", arguments, null, locale);
        if (second != null && !second.isBlank()) {
            paragraphs.add(second);
        }
        return paragraphs;
    }

    /**
     * One line of copy.
     *
     * <p>No default: a missing key throws, which is what turns an unfinished translation
     * into a failure at the point of sending rather than into an email with a key in it.
     * {@code AuthEmailCopyTests} renders every message in every language so that the
     * throw happens in the suite instead.
     */
    private String copy(String key, Object[] arguments, Locale locale) {
        return messages.getMessage(key, arguments, locale);
    }
}
