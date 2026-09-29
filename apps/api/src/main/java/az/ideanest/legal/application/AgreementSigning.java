package az.ideanest.legal.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditEnvironment;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.legal.domain.DocumentAcceptance;
import az.ideanest.legal.domain.DocumentKind;
import az.ideanest.legal.domain.LegalDocument;
import az.ideanest.legal.infrastructure.DocumentAcceptanceRepository;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.ReaderLocale;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.compliance.LegalSubject;
import az.ideanest.shared.compliance.LegalSubjects;
import az.ideanest.shared.compliance.RejectionReason;
import az.ideanest.shared.legal.AgreementInForce;
import az.ideanest.shared.legal.AgreementKind;
import az.ideanest.shared.signature.DocumentSigning;
import az.ideanest.shared.signature.SignatureOnFile;
import az.ideanest.shared.signature.SigningProgress;
import az.ideanest.shared.signature.SigningStarted;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Signing the creator agreement, and binding the signature to the acceptance — issue #429.
 *
 * <p>#425 records that somebody accepted a version and #428 can obtain a legally binding
 * signature. This is the join, for the one document where the difference is worth the friction:
 * the creator agreement, which moves delivery liability onto a named person and lets the
 * platform recover a chargeback from them.
 *
 * <h2>What is signed is the hash of the text</h2>
 *
 * <p>Not the title, not a description, not an identifier. #429: "that is the whole reason #425
 * stores the body and hashes it: the record has to prove <em>which text</em>, and a signature
 * over a title proves nothing." The hash comes from {@code legal_documents.content_hash} of the
 * governing (Azerbaijani) version, at the moment the session starts, and is compared again when
 * the signature comes back. A signature over a version that is no longer in force does not
 * satisfy the current one — that is a test, and it is the test this design exists to pass.
 *
 * <h2>The name match, which #429 calls the point</h2>
 *
 * <p>Three names have to agree about one person: the certificate subject (#428), the account's
 * legal name (#430), and — when #432 lands — the holder of the payout destination. Two of the
 * three are checkable here and both are checked.
 *
 * <p><strong>A mismatch is a refusal with a reason, and the reason is one the product already
 * has words for.</strong> {@link RejectionReason#MISMATCHED_NAME} is a value V58 already
 * defines, for exactly this. V58's argument for a closed set applies unchanged: "a reason a
 * creator is shown has to be one the product has written words for, and a free-text field is
 * where somebody eventually pastes what they saw on the document."
 *
 * <h2>For a legal entity, and what this deliberately does not claim</h2>
 *
 * <p>SİMA signs as a citizen. It does not assert that the citizen may bind a company. So for a
 * {@code LEGAL_ENTITY} the signature proves who signed, and #430's registration extract — read
 * by a human in #431's queue — is what says whether they could.
 *
 * <p><strong>This code does not check that pairing and does not pretend to.</strong> #429 asks
 * for the gap to be flagged explicitly rather than assumed away, because "the director signed
 * it" is the assumption that is wrong for exactly the companies where it matters. If #423's
 * opinion says a signature plus an extract is insufficient, the extra step goes here, and it
 * will find a name match and an audited signature already in place to hang off.
 */
@Service
public class AgreementSigning {

    private static final Logger log = LoggerFactory.getLogger(AgreementSigning.class);

    private final LegalDocuments documents;
    private final LegalAgreements agreements;
    private final DocumentAcceptanceRepository acceptances;
    private final DocumentSigning signing;
    private final LegalSubjects subjects;
    private final PlatformStaff staff;
    private final AuditLog audit;
    private final Clock clock;

    public AgreementSigning(
            LegalDocuments documents,
            LegalAgreements agreements,
            DocumentAcceptanceRepository acceptances,
            DocumentSigning signing,
            LegalSubjects subjects,
            PlatformStaff staff,
            AuditLog audit,
            Clock clock) {
        this.documents = documents;
        this.agreements = agreements;
        this.acceptances = acceptances;
        this.signing = signing;
        this.subjects = subjects;
        this.staff = staff;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * Start a signing session over the version of an agreement now in force.
     *
     * <p>Refuses before it reaches the provider when there is no legal subject to match the
     * certificate against. That refusal is the design rather than an ordering accident: a
     * signature the platform cannot tie to a named account proves that <em>a</em> certificate
     * signed the text, which V67's header names as precisely the thing worth nothing.
     */
    @Transactional
    public Started begin(UUID accountId, AgreementKind kind, int version, String signerFin, String signerMobile) {
        if (!signing.isAvailable()) {
            throw new SigningNotAvailableException(kind);
        }
        AgreementInForce agreement = inForceOrRefuse(kind);
        if (agreement.version() != version) {
            throw new AgreementVersionStaleException(kind, agreement.version(), version);
        }
        LegalSubject subject = subjects
                .of(accountId)
                .orElseThrow(() -> new LegalSubjectRequiredException(kind));

        LegalDocument governing = governingTextOf(kind);
        String purpose = purposeOf(governing, agreement);
        SigningStarted started =
                signing.begin(accountId, governing.getContentHash(), purpose, signerFin, signerMobile);
        log.info(
                "Account {} began signing {} version {} as {}",
                accountId,
                kind,
                agreement.version(),
                subject.subjectKind());
        return new Started(agreement, started);
    }

    /**
     * Ask what became of a session, and — if it was signed — file the signature.
     *
     * <p>Everything that can refuse the signature is checked before the acceptance is written,
     * so a refusal leaves no acceptance behind. #429's "a cancelled signature leaving the draft
     * untouched" is the same property from the other side: neither a cancellation nor a
     * mismatch produces a row that says the creator agreed to anything.
     */
    @Transactional
    public Resolution resolve(UUID accountId, AgreementKind kind, String sessionId) {
        AgreementInForce agreement = inForceOrRefuse(kind);
        SigningProgress progress = signing.resolve(accountId, sessionId);

        Optional<SignatureOnFile> signed = progress.signed();
        if (signed.isEmpty()) {
            return new Resolution(agreement, progress, null, null);
        }
        SignatureOnFile signature = signed.get();
        LegalDocument governing = governingTextOf(kind);

        if (!signature.covers(governing.getContentHash())) {
            audit.recordIndependently(
                    AuditAction.AGREEMENT_SIGNED,
                    accountId,
                    AuditActor.user(accountId),
                    AuditOutcome.REFUSED,
                    "wrongVersion; document=%s; version=%d; signed=%s; inForce=%s"
                            .formatted(kind, agreement.version(), signature.documentHash(), governing.getContentHash()));
            throw new SignatureOverAnotherVersionException(kind, agreement.version());
        }

        LegalSubject subject = subjects
                .of(accountId)
                .orElseThrow(() -> new LegalSubjectRequiredException(kind));
        if (!subject.nameMatches(signature.signerName())) {
            audit.recordIndependently(
                    AuditAction.AGREEMENT_SIGNED,
                    accountId,
                    AuditActor.user(accountId),
                    AuditOutcome.REFUSED,
                    "mismatchedName; document=%s; version=%d; certificate=%s"
                            .formatted(kind, agreement.version(), signature.signerName()));
            log.info(
                    "Account {} signed {} version {} with a certificate naming somebody else",
                    accountId,
                    kind,
                    agreement.version());
            throw new SignerNameMismatchException(kind, RejectionReason.MISMATCHED_NAME);
        }

        DocumentAcceptance acceptance = fileAcceptance(accountId, agreement, signature);
        audit.record(
                AuditAction.AGREEMENT_SIGNED,
                accountId,
                AuditActor.user(accountId),
                AuditOutcome.SUCCEEDED,
                "document=%s; version=%d; hash=%s; provider=%s; certificate=%s"
                        .formatted(
                                kind,
                                agreement.version(),
                                signature.documentHash(),
                                signature.provider(),
                                signature.signerName()));
        log.info("Account {} signed {} version {}", accountId, kind, agreement.version());
        return new Resolution(agreement, progress, signature, acceptance);
    }

    /**
     * What this creator signed, when, and which version.
     *
     * <p>#429: "a signature nobody can retrieve is a signature nobody can rely on." A creator
     * reading their own is not a disclosure and is not audited — {@code AUDIT_TRAIL_READ}'s
     * line.
     */
    @Transactional(readOnly = true)
    public Optional<SignedAgreement> mine(UUID accountId, AgreementKind kind) {
        return signedAgreementFor(accountId, kind);
    }

    /**
     * The same, read by a member of staff about somebody else — audited, and behind #436's
     * capability.
     *
     * <p>Not {@code readOnly}: the audit row is an insert into this transaction, and PostgreSQL
     * refuses one in a read-only transaction. A read that records the read is a write.
     */
    @Transactional
    public Optional<SignedAgreement> forStaff(UUID staffId, UUID accountId, AgreementKind kind) {
        staff.requireCapability(staffId, StaffCapability.READ_SIGNED_AGREEMENT);
        Optional<SignedAgreement> found = signedAgreementFor(accountId, kind);
        audit.record(
                AuditAction.SIGNED_AGREEMENT_READ,
                accountId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "document=%s; signed=%s".formatted(kind, found.isPresent()));
        return found;
    }

    private Optional<SignedAgreement> signedAgreementFor(UUID accountId, AgreementKind kind) {
        Optional<AgreementInForce> agreement = agreements.inForce(kind);
        if (agreement.isEmpty()) {
            return Optional.empty();
        }
        AgreementInForce required = agreement.get();
        return acceptances
                .find(accountId, required.documentId())
                .filter(row -> row.getSignatureId() != null)
                .flatMap(row -> signing.find(accountId, row.getSignatureId())
                        .map(signature -> new SignedAgreement(required, row.getAcceptedAt(), signature)));
    }

    /**
     * Write the acceptance that carries the signature.
     *
     * <p>An acceptance that already exists is upgraded in place rather than duplicated. A
     * creator who ticked the box last week and signs it today has accepted one version once;
     * V65's table is "one row per (account, version), appended, never replaced", and a second
     * row for the same pair would be the platform recording two agreements where there was one.
     */
    private DocumentAcceptance fileAcceptance(
            UUID accountId, AgreementInForce agreement, SignatureOnFile signature) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        return acceptances
                .find(accountId, agreement.documentId())
                .map(existing -> {
                    existing.signedWith(signature.signatureId());
                    return existing;
                })
                .orElseGet(() -> {
                    AuditEnvironment environment = AuditEnvironment.current();
                    DocumentAcceptance acceptance = DocumentAcceptance.signed(
                            Identifiers.newIdentifier(),
                            accountId,
                            agreement.documentId(),
                            now,
                            environment.sourceAddress(),
                            environment.userAgent(),
                            signature.signatureId());
                    return acceptances.saveAndFlush(acceptance);
                });
    }

    private AgreementInForce inForceOrRefuse(AgreementKind kind) {
        return agreements.inForce(kind).orElseThrow(() -> new AgreementNotPublishedException(kind));
    }

    private LegalDocument governingTextOf(AgreementKind kind) {
        return documents
                .inForce(DocumentKind.of(kind), ReaderLocale.PRIMARY)
                .orElseThrow(() -> new AgreementNotPublishedException(kind));
    }

    /**
     * What the citizen reads on their phone before deciding.
     *
     * <p>The document's own title and version, in the governing language. A purpose that said
     * "IdeyaNest" and nothing else would be a prompt to sign an unnamed thing, which is the
     * prompt people learn to approve without reading.
     */
    private static String purposeOf(LegalDocument governing, AgreementInForce agreement) {
        return "%s v%d — IdeyaNest".formatted(governing.getTitle(), agreement.version());
    }

    /** A session that has been opened, with the version it was opened over. */
    public record Started(AgreementInForce agreement, SigningStarted session) {
    }

    /** What a resolve found: the progress, and the signature and acceptance if there is one. */
    public record Resolution(
            AgreementInForce agreement,
            SigningProgress progress,
            SignatureOnFile signature,
            DocumentAcceptance acceptance) {

        public boolean isSigned() {
            return signature != null;
        }
    }

    /** A signature on file against an agreement, as a creator or a member of staff reads it. */
    public record SignedAgreement(AgreementInForce agreement, Instant acceptedAt, SignatureOnFile signature) {
    }
}
