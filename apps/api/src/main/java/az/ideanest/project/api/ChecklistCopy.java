package az.ideanest.project.api;

import az.ideanest.project.application.Taxonomy;
import az.ideanest.project.domain.ChecklistDetail;
import az.ideanest.project.domain.ChecklistItem;
import az.ideanest.project.domain.ChecklistRequirement;
import az.ideanest.shared.ReaderLocale;
import java.util.Locale;
import org.springframework.context.MessageSource;
import org.springframework.stereotype.Component;

/**
 * The completeness checklist's words, in the reader's language.
 *
 * <p><strong>Resolved here, at the boundary, and nowhere else.</strong> {@code SubmissionChecklist}
 * decides what is wrong with a campaign and says so as a requirement, a reason and the campaign's
 * own numbers; it has no idea what language anybody reads. This turns that into the two strings a
 * client renders, {@code label} and {@code detail}, from {@code messages*.properties}. Both of the
 * checklist's audiences come through it -- {@code GET /v1/projects/{id}/checklist} and the
 * {@code PROJECT_NOT_SUBMITTABLE} refusal -- so a row and the refusal that names it cannot be in
 * two languages, or worded two ways.
 *
 * <p>Before this, the domain built English sentences and every client rendered them verbatim, so
 * the Azerbaijani editor's review tab was an English checklist.
 *
 * <h2>The keys</h2>
 *
 * <ul>
 *   <li>{@code checklist.<REQUIREMENT>.label} -- what the requirement is
 *   <li>{@code checklist.<REQUIREMENT>.<reason>} -- why it is not met, with the reason one of
 *       {@link ChecklistDetail}'s constants
 * </ul>
 *
 * <p>The requirement's name is its enum constant, which is also its wire name, so the key and the
 * {@code requirement} field a client branches on are the same word.
 *
 * <h2>The language</h2>
 *
 * <p>Negotiated from {@code Accept-Language} by {@link Taxonomy#localeFor}, the idiom every
 * localised read in the service already uses: RFC 4647 lookup over §21.1's four languages, and
 * Azerbaijani for anything absent, malformed or unsupported. A malformed header is the client's
 * bug and does not become a 400 -- least of all on the refusal of a submission, where it would
 * hide the reason the creator actually needs.
 */
@Component
public class ChecklistCopy {

    private static final String PREFIX = "checklist.";

    private final MessageSource messages;

    public ChecklistCopy(MessageSource messages) {
        this.messages = messages;
    }

    /** The language to answer in, from a request's {@code Accept-Language}. Never null. */
    public static Locale localeOf(String acceptLanguage) {
        return ReaderLocale.of(Taxonomy.localeFor(acceptLanguage));
    }

    /** What the requirement is, in the reader's words. Never says whether it is met. */
    public String label(ChecklistRequirement requirement, Locale locale) {
        return messages.getMessage(PREFIX + requirement.name() + ".label", null, locale);
    }

    /**
     * Why the requirement is not met, or null when it is.
     *
     * <p>A reason with arguments is a {@code MessageFormat} pattern; one without is returned by
     * Spring verbatim, without going through {@code MessageFormat} at all. So a doubled apostrophe
     * would reach a reader as one in the first case and as two in the second, and the checklist's
     * copy carries no apostrophes at all rather than relying on which case a key is.
     * {@code ChecklistCopyTests} holds that, in every language.
     */
    public String detail(ChecklistItem item, Locale locale) {
        ChecklistDetail detail = item.detail();
        if (detail == null) {
            return null;
        }
        String key = PREFIX + item.requirement().name() + "." + detail.reason();
        return messages.getMessage(key, detail.arguments().toArray(), locale);
    }
}
