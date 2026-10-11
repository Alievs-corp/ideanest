package az.ideanest.legal.api;

import az.ideanest.legal.application.AcceptanceRecords;
import az.ideanest.legal.application.AgreementSigning;
import az.ideanest.legal.application.LegalDocuments;
import az.ideanest.legal.domain.DocumentKind;
import az.ideanest.legal.domain.LegalDocument;
import az.ideanest.shared.legal.AgreementKind;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * AD-11's third screen: §22.2's documents, drafted and published — issue #425.
 *
 * <h2>Why this is AD-11 and not a seventeenth module</h2>
 *
 * <p>§4.11's table has sixteen rows and AD-11 is the one about what the platform charges and
 * what it obliges. A fee schedule, a subscription plan and the creator agreement are the
 * same authority over the same subject — one screen, changing the terms the running platform
 * operates under for everybody at once — so {@code lib/admin/navigation.ts} files this under
 * AD-11 the way {@code /admin/plans} is. A seventeenth row would make the console and the
 * specification disagree about how many modules there are.
 *
 * <h2>Three verbs, and the third is the only one that matters</h2>
 *
 * <p>{@code PUT} writes a draft, {@code POST /publish} makes it govern, and {@code GET}
 * reads the history. There is deliberately no {@code DELETE} and no way to edit a published
 * version: V65's trigger refuses both underneath, {@code LegalDocument} refuses them above,
 * and the absence of an entry point here is the third statement of the same rule.
 *
 * <p><strong>The screen must make that obvious rather than relying on a warning.</strong>
 * That is the client's half of #425 and it is why publishing is a separate request from
 * saving: an editor that published on save would make the irreversible action the default
 * one.
 *
 * <p><strong>{@code no-store}</strong>, like every response under this prefix. The public
 * routes are cacheable and these are not: a draft is not a document, and an administrator
 * reading a cached draft is one editing text that has already been superseded.
 */
@RestController
@RequestMapping("/v1/admin")
public class AdminLegalDocumentController {

    private final LegalDocuments documents;
    private final AcceptanceRecords acceptances;
    private final AgreementSigning signing;

    public AdminLegalDocumentController(
            LegalDocuments documents, AcceptanceRecords acceptances, AgreementSigning signing) {
        this.documents = documents;
        this.acceptances = acceptances;
        this.signing = signing;
    }

    /**
     * A document's whole history and its open drafts.
     *
     * <p>The drafts carry their text and the published versions do not, which is the shape
     * the screen wants: the editor loads what is being written, and the history is a list of
     * dates and version numbers until somebody opens one.
     */
    @GetMapping(path = "/legal/documents/{kind}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<LegalResponses.History> history(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable DocumentKind kind) {

        UUID caller = callerOf(accessToken);
        List<LegalDocument> versions = documents.history(caller, kind);
        List<LegalDocument> drafts = documents.drafts(caller, kind);
        Integer inForceVersion = documents.inForce(kind).stream()
                .map(LegalDocument::getVersion)
                .findFirst()
                .orElse(null);

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new LegalResponses.History(
                        kind.name(),
                        versions.stream()
                                .filter(LegalDocument::isPublished)
                                .map(LegalResponses.Summary::of)
                                .toList(),
                        drafts.stream().map(LegalResponses.Document::of).toList(),
                        inForceVersion));
    }

    /**
     * Shows readers this already published version instead of the latest one.
     *
     * <p>The website follows at once: the change drops the web's cached legal pages.
     */
    @PostMapping(
            path = "/legal/documents/{kind}/versions/{version}/activate",
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<LegalResponses.Catalogue> activate(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable DocumentKind kind, @PathVariable int version) {

        List<LegalDocument> shown = documents.activate(callerOf(accessToken), kind, version);

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(LegalResponses.Catalogue.of(shown));
    }

    /**
     * Writes the draft of the next version in one language.
     *
     * <p>{@code PUT} rather than {@code POST}, because it is idempotent in exactly the sense
     * {@code PUT} means: there is one draft of a document in a language, and sending the text
     * again replaces it. An editor that created a row per save would leave an administrator
     * choosing between six drafts of the same paragraph.
     */
    @PutMapping(
            path = "/legal/documents/{kind}/{locale}/draft",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<LegalResponses.Document> draft(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable DocumentKind kind,
            @PathVariable @Pattern(regexp = "^(az|en|ru|tr)$") String locale,
            @Valid @RequestBody DraftRequest request) {

        LegalDocument drafted =
                documents.draft(callerOf(accessToken), kind, locale, request.title(), request.body());

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(LegalResponses.Document.of(drafted));
    }

    /**
     * Publishes every open draft of this document, in every language, as one version.
     *
     * <p>Not per language, and {@code LegalDocuments.publish} argues why at length: a
     * publication that could half-happen would leave days in which what a reader agreed to
     * and what governed them were different documents.
     *
     * <p>201, because a publication creates something that did not exist: a version that
     * governs. A 200 would read as an update, which is the one thing this is not.
     */
    @PostMapping(
            path = "/legal/documents/{kind}/publish",
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<LegalResponses.Catalogue> publish(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable DocumentKind kind,
            @RequestBody(required = false) PublishRequest request) {

        List<LegalDocument> published = documents.publish(
                callerOf(accessToken), kind, request == null ? null : request.effectiveFrom());

        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(LegalResponses.Catalogue.of(published));
    }

    /**
     * What one account has agreed to, and when.
     *
     * <p>Under {@code /accounts} rather than under {@code /legal} because it is a question
     * about a person, and the console's account screen is where questions about a person are
     * answered. The read is audited — {@code AcceptanceRecords} argues why.
     */
    @GetMapping(path = "/accounts/{accountId}/acceptances", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<LegalResponses.AcceptanceRecord> acceptances(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID accountId) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(LegalResponses.AcceptanceRecord.of(
                        accountId, acceptances.forAccount(callerOf(accessToken), accountId)));
    }

    /**
     * What one account signed, for an agreement — issue #429.
     *
     * <p>Beside the acceptance record rather than on a screen of its own, because it answers
     * the same question one degree further: not "did they agree" but "who signed, with which
     * certificate, over which text". A member of staff reading it needs #436's
     * {@code READ_SIGNED_AGREEMENT}, and the read is audited — the row carries a citizen's name
     * and FİN under §17.4, and a screen that discloses them is one whose use has to be
     * answerable.
     */
    @GetMapping(
            path = "/accounts/{accountId}/agreements/{kind}/signature",
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<SignatureResponses.MySignature> signature(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID accountId,
            @PathVariable AgreementKind kind) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(signing.forStaff(callerOf(accessToken), accountId, kind)
                        .map(SignatureResponses.MySignature::of)
                        .orElseGet(() -> SignatureResponses.MySignature.unsigned(kind)));
    }

    /**
     * The text of a version, in one language.
     *
     * @param body bounded at V65's megabyte. Generous for terms and mean for a paste accident
     */
    public record DraftRequest(
            @NotBlank @Size(max = 200) String title, @NotBlank @Size(max = 1_048_576) String body) {
    }

    /**
     * @param effectiveFrom when the version starts governing. Absent means now; a date in the
     *     future is the useful case and a date in the past is refused — see
     *     {@code EffectiveDateInThePastException}
     */
    public record PublishRequest(Instant effectiveFrom) {
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
