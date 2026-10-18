package az.ideanest.notification.api;

import az.ideanest.notification.application.EmailTemplateEditor;
import az.ideanest.notification.domain.NotificationType;
import az.ideanest.shared.ReaderLocale;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * §4.11's AD-15, third verb — §12.3, issue #315.
 *
 * <h2>Beside the preview rather than instead of it</h2>
 *
 * <p>{@code EmailTemplateController} owns the previews and the test send. This adds the
 * editing on the same prefix, so a person edits and previews without changing screens — and
 * the preview goes through the same composer the sender uses, which is override-aware. A
 * preview that ignored overrides would be a picture of the shipped copy rather than of the
 * message.
 *
 * <h2>One language per request</h2>
 *
 * <p>An override is per template and per locale, and V52 makes that pair its identity, so
 * every route takes {@code ?locale=} — one of §21.1's four, Azerbaijani when absent. Editing
 * the Azerbaijani copy changes what Azerbaijani readers receive and nothing else.
 *
 * <p>{@code PUT} rather than {@code POST} because the caller is stating what the copy should
 * now be, and re-sending the same body is a version that says the same thing rather than a
 * second edit that means something else.
 *
 * <p>Every route needs {@code CONFIGURE_PLATFORM}, checked in the service.
 */
@RestController
@RequestMapping("/v1/admin/email-templates")
public class EmailTemplateEditorController {

    /** §21.1's four, which is also what V52's CHECK admits for an override. */
    static final String LOCALES = "^(az|en|ru|tr)$";

    private final EmailTemplateEditor editor;

    public EmailTemplateEditorController(EmailTemplateEditor editor) {
        this.editor = editor;
    }

    /** The shipped copy, the override if there is one, and the placeholders that must stay. */
    @GetMapping("/{type}/copy")
    public ResponseEntity<EmailTemplateEditorResponses.Draft> read(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable NotificationType type,
            @RequestParam(defaultValue = ReaderLocale.PRIMARY) @Pattern(regexp = LOCALES) String locale) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(EmailTemplateEditorResponses.Draft.of(editor.read(callerOf(accessToken), type, locale)));
    }

    /** Every version ever written in this language, newest first. */
    @GetMapping("/{type}/versions")
    public ResponseEntity<EmailTemplateEditorResponses.History> history(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable NotificationType type,
            @RequestParam(defaultValue = ReaderLocale.PRIMARY) @Pattern(regexp = LOCALES) String locale) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(EmailTemplateEditorResponses.History.of(editor.history(callerOf(accessToken), type, locale)));
    }

    /** Writes a new version in this language and makes it live. */
    @PutMapping("/{type}/copy")
    public ResponseEntity<EmailTemplateEditorResponses.Version> edit(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable NotificationType type,
            @RequestParam(defaultValue = ReaderLocale.PRIMARY) @Pattern(regexp = LOCALES) String locale,
            @Valid @RequestBody EditRequest request) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(EmailTemplateEditorResponses.Version.of(editor.edit(
                        callerOf(accessToken), type, locale, request.subject(), request.body(), request.note())));
    }

    /**
     * Takes the override in this language out of service.
     *
     * <p>204 whether or not there was one. Withdrawing an override that is not there is not
     * an error — the platform ends up sending the shipped copy either way, which is what
     * the caller asked for.
     */
    @DeleteMapping("/{type}/copy")
    public ResponseEntity<Void> withdraw(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable NotificationType type,
            @RequestParam(defaultValue = ReaderLocale.PRIMARY) @Pattern(regexp = LOCALES) String locale) {

        editor.withdraw(callerOf(accessToken), type, locale);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    /**
     * New copy.
     *
     * @param subject what the recipient sees in their inbox list. Plain text: an apostrophe is
     *     an apostrophe, and braces are only for placeholders such as {@code {2}}
     * @param body the first paragraph. Only the first — the service has why the second is
     *     not editable
     * @param note why it was changed, for whoever reads the history in a year
     */
    public record EditRequest(
            @NotBlank @Size(max = 300) String subject,
            @NotBlank @Size(max = 50000) String body,
            @Size(max = 2000) String note) {
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
