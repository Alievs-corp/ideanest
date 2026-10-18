package az.ideanest.notification.api;

import az.ideanest.notification.application.EditedCopy;
import az.ideanest.notification.application.EmailTemplates;
import az.ideanest.notification.application.TemplateOverrides;
import az.ideanest.notification.domain.NotificationType;
import az.ideanest.notification.infrastructure.RenderedEmail;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import jakarta.mail.MessagingException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * AD-15's two built halves: look at an email template, and send yourself one.
 *
 * <p>Under {@code /v1/admin/email-templates}, beside the moderation routes
 * {@code ReportQueueController} serves. §10.2 reserves the {@code /v1/admin} prefix for
 * administration and does not enumerate these; AD-15 names the capability.
 *
 * <p><strong>{@code SecurityConfiguration} is not touched.</strong> Its
 * {@code /v1/admin/**} matcher requires an active account and nothing more — there is no
 * role model until epic #100 — so every method here refuses one layer in, through
 * {@code EmailTemplates} and {@code PlatformStaff}, exactly as the moderation queue does.
 *
 * <p>Editing a template is the third of AD-15 and lives in
 * {@code EmailTemplateEditorController}. What is here since then is the editor's preview and
 * test send of text nobody has saved yet, which are the same two verbs over a different
 * source of copy.
 */
@RestController
@RequestMapping("/v1/admin/email-templates")
public class EmailTemplateController {

    private final EmailTemplates templates;
    private final TemplateOverrides overrides;

    public EmailTemplateController(EmailTemplates templates, TemplateOverrides overrides) {
        this.templates = templates;
        this.overrides = overrides;
    }

    /**
     * Every template there is: the types §4.10 gives an email column, each with the languages
     * somebody has rewritten it in.
     */
    @GetMapping
    public EmailTemplateListResponse templates(@AuthenticationPrincipal Jwt accessToken) {
        return EmailTemplateListResponse.of(templates.previewable(callerOf(accessToken)), overrides.liveByTemplate());
    }

    /**
     * One template, rendered against a sample document.
     *
     * <p><strong>Answered as the body it would be sent as, not as JSON describing
     * one.</strong> {@code text/html} for the HTML part and {@code text/plain} for the
     * other, so that pointing a browser at this URL shows the email — which is what a
     * preview is for. A JSON envelope with the markup inside a string would have to be
     * unwrapped by something before anybody could look at it, and the something would be
     * a second renderer.
     *
     * <p>The subject travels in {@code X-Email-Subject} for the same reason: it is part
     * of the message and there is nowhere else to put it in a response whose body is the
     * message.
     *
     * <p><strong>Encoded per RFC 8187 since #324.</strong> A preview renders in the reader's
     * own language now, so the subject may hold {@code ə}, {@code ё} or {@code ğ} — and an
     * HTTP field value is Latin-1 by RFC 9110, so Tomcat drops a header carrying anything
     * else. The symptom was the header simply not being there, which reads as an endpoint
     * that forgot to set it. {@code UTF-8''} plus percent-encoding is the same convention
     * {@code Content-Disposition} uses for a filename, so a client that already decodes one
     * decodes this.
     *
     * @param format {@code html} or {@code text}. Defaults to HTML, which is what a
     *     reader with a browser wants; the text part is the one that has to be asked for,
     *     and it is the one worth checking because nothing else renders it
     */
    // **No `produces` on the mapping, and the contract is annotated instead.**
    //
    // The obvious version of this declares `produces = text/html, text/plain`, and it is
    // wrong twice. It is a *mapping* condition, so a client sending
    // `Accept: application/json` -- which is every generated client, and every attempt to
    // read a refusal -- does not match the mapping at all and is answered 406 before the
    // controller runs. And for the clients that do match, the same types become the
    // request's producible set and then block the advice's `application/problem+json`, so
    // a refusal is a second 406, this time with an empty body.
    //
    // Adding `application/problem+json` to the list fixes the second and not the first,
    // at the cost of a published contract that says a 200 may be a problem document.
    //
    // So the mapping accepts anything, the response carries its own Content-Type -- which
    // is what actually decides what the reader gets -- and @ApiResponse below is what
    // makes the document say `text/html` rather than the `application/json` springdoc
    // would infer from ResponseEntity<String>.
    @GetMapping("/{type}/preview")
    @ApiResponse(
            responseCode = "200",
            description = "The rendered email, as the body it is sent with.",
            content = {
                @Content(mediaType = MediaType.TEXT_HTML_VALUE, schema = @Schema(type = "string")),
                @Content(mediaType = MediaType.TEXT_PLAIN_VALUE, schema = @Schema(type = "string"))
            })
    public ResponseEntity<String> preview(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable NotificationType type,
            @RequestParam(defaultValue = "html") String format) {

        RenderedEmail email = templates.preview(callerOf(accessToken), type);
        boolean asText = "text".equalsIgnoreCase(format);

        return ResponseEntity.ok()
                .contentType(asText ? MediaType.TEXT_PLAIN : MediaType.TEXT_HTML)
                // Not a header a client sends back and not part of the contract's
                // schemas, so it is prefixed rather than pretending to be standard.
                .header("X-Email-Subject", encodedSubject(email.subject()))
                // A preview is generated per request and is not somebody's mail, but it
                // is still the body of a message about a sample pledge -- and a cache
                // holding staff-only content on a shared proxy is a category of accident
                // worth simply not having.
                .header("Cache-Control", "no-store")
                .body(asText ? email.text() : email.html());
    }

    /**
     * Text somebody has typed in the editor and not saved, rendered as the email it would be.
     *
     * <p>{@code POST} because the text travels in the body, and JSON because the editor shows
     * the HTML in a sandboxed frame beside the subject and needs both in one answer. Nothing is
     * stored. Refused with {@code TEMPLATE_COPY_MALFORMED} only when the text would not render.
     */
    @PostMapping("/{type}/preview")
    public ResponseEntity<EmailTemplateEditorResponses.Preview> previewDraft(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable NotificationType type,
            @Valid @RequestBody DraftCopy draft) {

        RenderedEmail email = templates.previewDraft(callerOf(accessToken), type, draft.locale(), draft.edited());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new EmailTemplateEditorResponses.Preview(email.subject(), email.html(), email.text()));
    }

    /**
     * Sends this template to the calling staff member's own address.
     *
     * <p><strong>There is no recipient parameter, and that is the design.</strong>
     * {@code EmailTemplates} makes the argument: an authenticated endpoint taking an
     * arbitrary address and a platform-branded template is a way to send real-looking
     * payment mail to anybody, and one compromised staff account is the whole cost of
     * entry.
     *
     * <p>{@code 204}, because there is nothing to say beyond that it went. What happened
     * afterwards is between the relay and the mailbox, and this endpoint cannot see it —
     * for the same reason {@code email_deliveries} has no {@code delivered_at}.
     */
    /*
     * The body is optional. Without one this sends what the platform sends today, in the
     * caller's language; with one it sends the editor's unsaved text in that text's language,
     * which is the "send it to me before I save it" the editor offers.
     */
    @PostMapping("/{type}/test-send")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void testSend(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable NotificationType type,
            @Valid @RequestBody(required = false) DraftCopy draft)
            throws MessagingException {

        if (draft == null) {
            templates.testSend(callerOf(accessToken), type);
        } else {
            templates.testSendDraft(callerOf(accessToken), type, draft.locale(), draft.edited());
        }
    }

    /**
     * Copy the editor holds and has not saved.
     *
     * @param locale which language's copy it is — one of §21.1's four
     */
    public record DraftCopy(
            @NotNull @Pattern(regexp = EmailTemplateEditorController.LOCALES) String locale,
            @NotBlank @Size(max = 300) String subject,
            @NotBlank @Size(max = 50000) String body) {

        EditedCopy edited() {
            return new EditedCopy(subject, body);
        }
    }

    /** The authenticated caller, from the token's subject and never from the request. */
    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }

    /**
     * A subject line as an HTTP header value — RFC 8187.
     *
     * <p>{@code UTF-8''} followed by the percent-encoded bytes. Percent-encoding is applied to
     * everything outside RFC 8187's {@code attr-char} set rather than only to the non-ASCII, so
     * a space becomes {@code %20} rather than {@code +} and a comma cannot be read as a header
     * list separator.
     */
    private static String encodedSubject(String subject) {
        StringBuilder encoded = new StringBuilder("UTF-8''");

        for (byte octet : subject.getBytes(java.nio.charset.StandardCharsets.UTF_8)) {
            int value = octet & 0xFF;
            boolean attrChar = (value >= 'a' && value <= 'z')
                    || (value >= 'A' && value <= 'Z')
                    || (value >= '0' && value <= '9')
                    || "!#$&+-.^_`|~".indexOf(value) >= 0;

            if (attrChar) {
                encoded.append((char) value);
            } else {
                encoded.append('%').append(String.format("%02X", value));
            }
        }

        return encoded.toString();
    }
}
