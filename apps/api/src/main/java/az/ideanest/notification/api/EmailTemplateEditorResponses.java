package az.ideanest.notification.api;

import az.ideanest.notification.application.EmailTemplateEditor;
import az.ideanest.notification.domain.EmailTemplateVersion;
import az.ideanest.notification.domain.NotificationType;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * AD-15's editor, as the service describes it — issue #315.
 */
public final class EmailTemplateEditorResponses {

    private EmailTemplateEditorResponses() {
    }

    /** One stored version. */
    public record Version(
            UUID id,
            String templateKey,
            String locale,
            int version,
            String subject,
            String body,
            List<String> requiredPlaceholders,
            boolean live,
            String note,
            Instant createdAt,
            UUID createdBy) {

        public static Version of(EmailTemplateVersion version) {
            return new Version(
                    version.id(),
                    version.templateKey(),
                    version.locale(),
                    version.version(),
                    version.subject(),
                    version.body(),
                    version.requiredPlaceholders(),
                    version.live(),
                    version.note(),
                    version.createdAt(),
                    version.createdBy());
        }
    }

    /**
     * What the editor opens with, in one language.
     *
     * <p><strong>Both the shipped copy and the override travel.</strong> An editor showing
     * only the current text gives nobody a way to see what they changed it from — and the
     * shipped copy is what withdrawing an override returns to, so it is also the preview of
     * the undo.
     *
     * @param shippedSubject the subject a message with no campaign name gets
     * @param shippedSubjectNamed the subject that names the campaign, which is what nearly every
     *     recipient gets. Absent when the type has no such variant
     * @param shippedBodyNamed the same, for the first paragraph
     * @param requiredPlaceholders the argument indices an override must keep — across both
     *     variants, so an override cannot drop the campaign name. Sent so the screen can say
     *     which are missing before the service refuses
     * @param availablePlaceholders the indices an override may use: the facts this message
     *     carries. Anything else is refused as {@code TEMPLATE_COPY_MALFORMED}
     * @param override null when the platform is sending the shipped copy in this language
     */
    public record Draft(
            NotificationType type,
            String locale,
            String shippedSubject,
            String shippedBody,
            String shippedSubjectNamed,
            String shippedBodyNamed,
            List<String> requiredPlaceholders,
            List<String> availablePlaceholders,
            Version override) {

        public static Draft of(EmailTemplateEditor.TemplateDraft draft) {
            return new Draft(
                    draft.type(),
                    draft.locale(),
                    draft.shipped().subject(),
                    draft.shipped().body(),
                    draft.shipped().subjectNamed(),
                    draft.shipped().bodyNamed(),
                    List.copyOf(draft.shipped().required()),
                    List.copyOf(draft.shipped().available()),
                    draft.override() == null ? null : Version.of(draft.override()));
        }
    }

    /** Every version of one template in one language, newest first. */
    public record History(List<Version> versions) {

        public static History of(List<EmailTemplateVersion> versions) {
            return new History(versions.stream().map(Version::of).toList());
        }
    }

    /**
     * Unsaved text rendered as the email it would be — the editor's preview.
     *
     * <p>JSON here where {@code GET .../preview} answers with the bare body, because this one is
     * read by a screen that shows the HTML in a sandboxed frame beside the subject, and needs
     * both parts in one answer.
     */
    public record Preview(String subject, String html, String text) {
    }
}
