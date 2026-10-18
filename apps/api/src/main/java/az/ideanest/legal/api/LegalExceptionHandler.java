package az.ideanest.legal.api;

import az.ideanest.legal.application.AgreementNotPublishedException;
import az.ideanest.legal.application.AgreementVersionStaleException;
import az.ideanest.legal.application.DocumentNotPublishedException;
import az.ideanest.legal.application.EffectiveDateInThePastException;
import az.ideanest.legal.application.GoverningTextMissingException;
import az.ideanest.legal.application.LegalSubjectRequiredException;
import az.ideanest.legal.application.NothingToPublishException;
import az.ideanest.legal.application.SignatureOverAnotherVersionException;
import az.ideanest.legal.application.SignerNameMismatchException;
import az.ideanest.legal.application.SigningNotAvailableException;
import az.ideanest.legal.application.VersionNotYetEffectiveException;
import az.ideanest.signature.application.SigningUnavailableException;
import az.ideanest.signature.application.UnknownSigningSessionException;
import az.ideanest.legal.domain.PublishedDocumentIsImmutableException;
import az.ideanest.staff.api.StaffRefusals;
import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.NotAModeratorException;
import java.net.URI;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * What the legal endpoints refuse with — RFC 9457, as everything here is.
 *
 * <p>Scoped to the four controllers rather than global, for the reason every advice in this
 * service gives: an advice that catches a broad exception everywhere turns a bug three
 * modules away into a 4xx that looks like the caller's fault.
 *
 * <p><strong>Every refusal carries a {@code code}.</strong> The console branches on it — a
 * client parsing a human sentence to decide what to draw is a client that breaks when the
 * sentence is translated, and §21.1 has four languages.
 */
@RestControllerAdvice(
        assignableTypes = {
            LegalDocumentController.class,
            AdminLegalDocumentController.class,
            MyAgreementController.class,
            AgreementSignatureController.class
        })
public class LegalExceptionHandler {

    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotStaff(NotAModeratorException exception) {
        return StaffRefusals.notStaff(exception);
    }

    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    /**
     * <strong>404: the document exists as a requirement and not yet as a text.</strong>
     *
     * <p>Honest rather than convenient. §22.2 says the platform must have eight documents;
     * this repository has the machinery for them and, until #439, none of the words. An
     * empty document would tell a reader they had read the terms.
     */
    @ExceptionHandler(DocumentNotPublishedException.class)
    public ProblemDetail handleNotPublished(DocumentNotPublishedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/document-not-published"));
        problem.setTitle("That document has not been published");
        problem.setDetail("No version of this document is in force yet.");
        problem.setProperty("code", "DOCUMENT_NOT_PUBLISHED");
        problem.setProperty("meta", Map.of("kind", exception.kind().name()));
        return problem;
    }

    /**
     * <strong>409: there is nothing of this kind to accept.</strong>
     *
     * <p>Deliberately not the same behaviour as the gates, which let an action through when
     * no version is published. {@code AgreementNotPublishedException} argues the difference:
     * a gate has something else to be about, and an acceptance of a document that does not
     * exist would be an acceptance of nothing.
     */
    @ExceptionHandler(AgreementNotPublishedException.class)
    public ProblemDetail handleAgreementNotPublished(AgreementNotPublishedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/agreement-not-published"));
        problem.setTitle("There is nothing to accept yet");
        problem.setDetail("No version of this agreement is in force.");
        problem.setProperty("code", "AGREEMENT_NOT_PUBLISHED");
        problem.setProperty("meta", Map.of("document", exception.kind().name()));
        return problem;
    }

    /**
     * <strong>409: the version offered is not the one in force.</strong>
     *
     * <p>The recovery is always the same and the client can always perform it: reload, show
     * the new text, accept again. {@code meta.version} is what to show.
     */
    @ExceptionHandler(AgreementVersionStaleException.class)
    public ProblemDetail handleStaleVersion(AgreementVersionStaleException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/agreement-version-stale"));
        problem.setTitle("This agreement has changed");
        problem.setDetail("A newer version is in force. Read it, then accept again.");
        problem.setProperty("code", "AGREEMENT_VERSION_STALE");
        problem.setProperty(
                "meta",
                Map.of(
                        "document", exception.kind().name(),
                        "version", exception.inForce(),
                        "offered", exception.offered()));
        return problem;
    }

    /**
     * <strong>409: the version is published and cannot be changed.</strong>
     *
     * <p>409 rather than 403. The caller is permitted to do this to a draft and the state is
     * what refuses them, which is exactly the distinction between the two codes. The fix is a
     * different request — publish a new version — rather than a corrected one, and
     * {@code meta.version} is there so the console can say which.
     */
    @ExceptionHandler(PublishedDocumentIsImmutableException.class)
    public ProblemDetail handleImmutable(PublishedDocumentIsImmutableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/published-document-is-immutable"));
        problem.setTitle("A published version cannot be edited");
        problem.setDetail("Correct it by drafting and publishing a new version. The old one stays readable.");
        problem.setProperty("code", "PUBLISHED_DOCUMENT_IS_IMMUTABLE");
        problem.setProperty(
                "meta",
                Map.of(
                        "kind", exception.kind().name(),
                        "locale", exception.locale(),
                        "version", exception.version()));
        return problem;
    }

    /**
     * <strong>409: that version does not govern yet.</strong>
     *
     * <p>It shows itself on {@code meta.effectiveFrom}; nothing has to be pressed. 409 rather
     * than 400, because the request is right and the date is what refuses it.
     */
    @ExceptionHandler(VersionNotYetEffectiveException.class)
    public ProblemDetail handleNotYetEffective(VersionNotYetEffectiveException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/version-not-yet-effective"));
        problem.setTitle("That version does not govern yet");
        problem.setDetail("It is shown on its effective date, without anything being pressed.");
        problem.setProperty("code", "VERSION_NOT_YET_EFFECTIVE");
        problem.setProperty(
                "meta",
                Map.of(
                        "kind", exception.kind().name(),
                        "version", exception.version(),
                        "effectiveFrom", exception.effectiveFrom().toString()));
        return problem;
    }

    /** <strong>409: publish was asked for and nothing is drafted.</strong> */
    @ExceptionHandler(NothingToPublishException.class)
    public ProblemDetail handleNothingToPublish(NothingToPublishException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/nothing-to-publish"));
        problem.setTitle("There is no draft to publish");
        problem.setDetail("Write the text first. Publishing twice does nothing the second time.");
        problem.setProperty("code", "NOTHING_TO_PUBLISH");
        problem.setProperty("meta", Map.of("kind", exception.kind().name()));
        return problem;
    }

    /**
     * <strong>409: the Azerbaijani text is missing.</strong>
     *
     * <p>The one language that is not optional, because it is the one that governs. Its own
     * code rather than folding into {@code NOTHING_TO_PUBLISH}, because the console's answer
     * is different: there <em>is</em> a draft, and what is wanted is the other one.
     */
    @ExceptionHandler(GoverningTextMissingException.class)
    public ProblemDetail handleGoverningMissing(GoverningTextMissingException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/governing-text-missing"));
        problem.setTitle("The Azerbaijani text is missing");
        problem.setDetail("The Azerbaijani version is the one that governs, so nothing publishes without it.");
        problem.setProperty("code", "GOVERNING_TEXT_MISSING");
        problem.setProperty("meta", Map.of("kind", exception.kind().name(), "locale", "az"));
        return problem;
    }

    /**
     * <strong>400: a version cannot start governing in the past.</strong>
     *
     * <p>400 rather than 409, because this one is the request's fault: the date came from the
     * body and a different date would be accepted.
     */
    @ExceptionHandler(EffectiveDateInThePastException.class)
    public ProblemDetail handleBackdated(EffectiveDateInThePastException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/effective-date-in-the-past"));
        problem.setTitle("A version cannot start governing in the past");
        problem.setDetail("Publish it from now, or from a date still to come.");
        problem.setProperty("code", "EFFECTIVE_DATE_IN_THE_PAST");
        problem.setProperty(
                "meta",
                Map.of(
                        "kind", exception.kind().name(),
                        "effectiveFrom", exception.effectiveFrom().toString(),
                        "now", exception.now().toString()));
        return problem;
    }

    /**
     * <strong>503: signing is not available on this deployment yet.</strong>
     *
     * <p>503 and not 400 or 409, because nothing about the request is wrong and nothing the
     * creator does will change it. The platform has no signature provider configured — #423 has
     * not answered which personal data from a SİMA certificate may be kept, and until it has,
     * {@code SignatureProviders} refuses to point at production. A screen meeting this says the
     * platform is not ready, not that the creator did something wrong.
     */
    @ExceptionHandler({SigningNotAvailableException.class, SigningUnavailableException.class})
    public ProblemDetail handleSigningUnavailable(RuntimeException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.SERVICE_UNAVAILABLE);
        problem.setType(URI.create("https://ideanest.az/problems/signing-unavailable"));
        problem.setTitle("Signing is not available yet");
        problem.setDetail("This document can be accepted; signing it is not switched on here.");
        problem.setProperty("code", "SIGNING_UNAVAILABLE");
        return problem;
    }

    /**
     * <strong>409: sign after saying who you are.</strong>
     *
     * <p>A signature the platform cannot tie to a named account proves that a certificate signed
     * the text rather than that this creator did, so #430's legal subject is a precondition
     * rather than a nicety. The creator's next step is a form, and {@code meta.next} names it so
     * the client does not have to know the route by heart.
     */
    @ExceptionHandler(LegalSubjectRequiredException.class)
    public ProblemDetail handleLegalSubjectRequired(LegalSubjectRequiredException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/legal-subject-required"));
        problem.setTitle("Say who you legally are first");
        problem.setDetail("A signature is matched against the name on your account, and there is none recorded.");
        problem.setProperty("code", "LEGAL_SUBJECT_REQUIRED");
        problem.setProperty(
                "meta", Map.of("document", exception.kind().name(), "next", "/v1/me/legal-subject"));
        return problem;
    }

    /**
     * <strong>409: that signature covers a different version.</strong>
     *
     * <p>The case the hash binding exists to catch, and it is nobody's fault — a version was
     * published while a phone was in a pocket. No acceptance is written: a signature over a
     * superseded text binding somebody to the current one is the substitution a content hash
     * exists to make impossible.
     */
    @ExceptionHandler(SignatureOverAnotherVersionException.class)
    public ProblemDetail handleWrongVersion(SignatureOverAnotherVersionException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/signature-over-another-version"));
        problem.setTitle("That signature is over a different version");
        problem.setDetail("A new version was published. Read it and sign that one.");
        problem.setProperty("code", "SIGNATURE_VERSION_STALE");
        problem.setProperty(
                "meta",
                Map.of("document", exception.kind().name(), "version", exception.versionInForce()));
        return problem;
    }

    /**
     * <strong>409: the certificate names somebody else.</strong>
     *
     * <p>{@code meta.reason} is {@code MISMATCHED_NAME}, from the closed set V58 already uses for
     * exactly this. #429 is explicit that a mismatch is a refusal with a reason and that the
     * reason is not a new vocabulary — "two vocabularies for one idea is one too many".
     *
     * <p>The name on the certificate is not returned. It is a third party's personal data under
     * §17.4 and it is in the audit entry, where reading it requires being authorised to.
     */
    @ExceptionHandler(SignerNameMismatchException.class)
    public ProblemDetail handleNameMismatch(SignerNameMismatchException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/signer-name-mismatch"));
        problem.setTitle("That certificate names somebody else");
        problem.setDetail("The name on the certificate has to be the legal name on this account.");
        problem.setProperty("code", "MISMATCHED_NAME");
        problem.setProperty(
                "meta",
                Map.of("document", exception.kind().name(), "reason", exception.reason().name()));
        return problem;
    }

    /** <strong>404: no such signing session, for this caller.</strong> Start a new one. */
    @ExceptionHandler(UnknownSigningSessionException.class)
    public ProblemDetail handleUnknownSession(UnknownSigningSessionException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/unknown-signing-session"));
        problem.setTitle("There is no such signing session");
        problem.setDetail("It may have been finished already. Start a new one.");
        problem.setProperty("code", "UNKNOWN_SIGNING_SESSION");
        problem.setProperty("meta", Map.of("session", exception.sessionId()));
        return problem;
    }
}
