package az.ideanest.compliance.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.compliance.domain.DestinationState;
import az.ideanest.compliance.domain.DestinationVerificationMethod;
import az.ideanest.compliance.domain.Iban;
import az.ideanest.compliance.domain.PayoutDestination;
import az.ideanest.compliance.infrastructure.PayoutDestinationRepository;
import az.ideanest.payment.application.PaymentProviders;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.compliance.BankAccount;
import az.ideanest.shared.compliance.ComplianceRequirement;
import az.ideanest.shared.compliance.DestinationKind;
import az.ideanest.shared.compliance.DestinationStanding;
import az.ideanest.shared.compliance.LegalSubject;
import az.ideanest.shared.compliance.LegalSubjects;
import az.ideanest.shared.compliance.PayoutDestinations;
import az.ideanest.shared.compliance.RejectionReason;
import az.ideanest.shared.crypto.FieldCipher;
import az.ideanest.shared.crypto.FieldCipherConfiguration;
import az.ideanest.shared.crypto.FieldFingerprints;
import az.ideanest.shared.crypto.Sealed;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Where a creator is paid: filed by them, confirmed by somebody else — part of issue #432.
 *
 * <p>The answerer behind {@link PayoutDestinations}, which is what the payout module names.
 *
 * <h2>The thing this replaces</h2>
 *
 * <p>Until now the destination was a field on {@code PayoutController.SendRequest}, typed by
 * the member of staff pressing send. The controller's own comment called that the honest
 * shape of a real gap, and it was — but the gap was wider than a typo. §4.11 requires two
 * signatures above a threshold so that one person cannot move money alone, and a destination
 * chosen after those signatures, by one of the signatories, unreviewed, defeats the rule
 * entirely: the approvals were of an amount.
 *
 * <h2>Three names have to agree, and one comparison is automatic</h2>
 *
 * <p>#432 asks that the account holder be matched against #430's {@code legal_name} and
 * #429's certificate subject. The first is a string comparison and happens here, on every
 * save, using {@link LegalSubject#nameMatches} — the same forgiving-about-presentation,
 * strict-about-everything-else comparison #429's signature already uses, because two
 * vocabularies for one idea is one too many. The second is already enforced where the
 * signature is taken: a certificate naming somebody other than the legal name is refused with
 * {@code MISMATCHED_NAME} before an acceptance is written, so a destination matching the legal
 * name has by construction matched the certificate too.
 *
 * <p>A creator with no legal subject recorded cannot mismatch. There is nothing to compare
 * against, so the row waits for a reviewer, and asking for the subject is #430's gate at
 * submission rather than this one's.
 *
 * <h2>What cannot happen here yet, and is not pretended</h2>
 *
 * <p>Neither of #432's two ownership mechanisms can run. Mechanism A needs Epoint to confirm
 * in writing that sub-merchant onboarding validates a bank account (§9.3's R-10, which is
 * #422); mechanism B needs a statement feed. What exists is
 * {@link DestinationVerificationMethod#STAFF_ATTESTED} — the manual form of B, which is what
 * #432 describes B being at launch volumes — and the column records which of the three was
 * used, so a row verified by a person is never mistaken later for one a bank verified.
 *
 * <p>The tokenisation itself is the other half that waits. A creator supplies a provider
 * token; no adapter exists to issue one. The gate below is real whether or not anything can
 * yet get through it.
 *
 * <h2>A bank account, since epic #392</h2>
 *
 * <p>{@link #recordBankAccount} files an IBAN instead of a token (#394): the owner decided that
 * creators are paid by bank transfer, so the platform holds the account it pays into — sealed
 * under the {@code bank-details} keyring and bound to the creator's row, fingerprinted so that
 * the same account filed twice can be noticed, and shown everywhere but one place as a masked
 * hint. The one place is {@link #revealBankAccount}, which a member of staff holding
 * {@code READ_BANK_DETAILS} calls to verify the account or to pay into it, and which is audited.
 * The name match, the reset on replacement and the verification are the token's, unchanged:
 * both kinds go through the same {@code replace} in the entity and the same rules here.
 */
@Service
public class CreatorPayoutDestinations implements PayoutDestinations {

    private static final Logger log = LoggerFactory.getLogger(CreatorPayoutDestinations.class);

    /** How many of COMPLIANCE's queue one page holds. {@code PayoutService.PAGE_SIZE}'s number. */
    public static final int PAGE_SIZE = 50;

    private final PayoutDestinationRepository destinations;
    private final LegalSubjects legalSubjects;
    private final ComplianceOverrides overrides;
    private final PlatformStaff staff;
    private final AuditLog audit;
    private final Clock clock;
    private final FieldCipher bankDetails;
    private final FieldFingerprints fingerprints;

    public CreatorPayoutDestinations(
            PayoutDestinationRepository destinations,
            LegalSubjects legalSubjects,
            ComplianceOverrides overrides,
            PlatformStaff staff,
            AuditLog audit,
            Clock clock,
            @Qualifier(FieldCipherConfiguration.BANK_DETAILS) FieldCipher bankDetails,
            @Qualifier(FieldCipherConfiguration.BANK_DETAILS_FINGERPRINTS) FieldFingerprints fingerprints) {
        this.destinations = destinations;
        this.legalSubjects = legalSubjects;
        this.overrides = overrides;
        this.staff = staff;
        this.audit = audit;
        this.clock = clock;
        this.bankDetails = bankDetails;
        this.fingerprints = fingerprints;
    }

    @Override
    @Transactional(readOnly = true)
    public DestinationStanding standingOf(UUID creatorId) {
        Optional<PayoutDestination> row = destinations.findById(creatorId);
        if (overrides.isWaived(creatorId, ComplianceRequirement.PAYOUT_DESTINATION)) {
            // The override is checked before the row is read, and the row is still required.
            // A waiver excuses the check; it cannot conjure an account number, which is why
            // `referenceFor` refuses independently and why an absent row wins here.
            return row.isPresent() ? DestinationStanding.WAIVED : DestinationStanding.NONE;
        }
        return row.map(found -> found.getState().asStanding()).orElse(DestinationStanding.NONE);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<String> referenceFor(UUID creatorId, String provider) {
        if (!standingOf(creatorId).releasesPayout()) {
            return Optional.empty();
        }
        return destinations
                .findById(creatorId)
                .filter(row -> row.issuedBy(provider))
                .map(PayoutDestination::getReference);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<DestinationKind> kindOf(UUID creatorId) {
        return destinations.findById(creatorId).map(PayoutDestination::kind);
    }

    /**
     * {@inheritDoc}
     *
     * <p><strong>Not {@code readOnly}</strong>, for {@link #forStaff}'s reason: the audit insert
     * joins this transaction. An opening that fails — a key removed from the keyring — rolls
     * the audit row back with it, which is right: nothing was disclosed.
     */
    @Override
    @Transactional
    public Optional<BankAccount> revealBankAccount(UUID staffId, UUID creatorId) {
        staff.requireCapability(staffId, StaffCapability.READ_BANK_DETAILS);
        Optional<PayoutDestination> row = destinations.findById(creatorId).filter(PayoutDestination::isBankAccount);
        audit.record(
                AuditAction.PAYOUT_DESTINATION_ACCOUNT_REVEALED,
                creatorId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                row.map(found -> "account=%s; state=%s".formatted(found.getDisplayHint(), found.getState()))
                        .orElse("account=none"));
        return row.map(found -> {
            Sealed sealed = found.sealedAccount().orElseThrow();
            byte[] plain = bankDetails.open(sealed, PayoutDestination.accountContext(creatorId));
            log.info("Bank account of {} opened by {}", creatorId, staffId);
            return new BankAccount(
                    new String(plain, StandardCharsets.UTF_8), found.getHolderName(), found.getDisplayHint());
        });
    }

    /** What the creator has filed, for their own settings screen. */
    @Transactional(readOnly = true)
    public Optional<PayoutDestination> mine(UUID accountId) {
        return destinations.findById(accountId);
    }

    /**
     * File an account, or replace the one on file.
     *
     * <p>Always a replacement and never a patch, for {@code CreatorLegalSubject.apply}'s
     * reason one table along: the fields describe one account, and a request that changed the
     * holder's name without the token would be describing an account nobody has.
     *
     * <p><strong>Replacing re-verifies, and does not silently inherit.</strong> The entity
     * enforces it and V72 enforces it again as a constraint. This is the requirement #432
     * states outright, and the reason it is worth stating is that the bug is invisible: a
     * destination verified in March, swapped in June, still reading VERIFIED, looks like a
     * perfectly ordinary row.
     *
     * <p>Audited on the creator's own account. "When did this change and to what" is the first
     * question a misdirected payout produces, and the answer has to survive the row being
     * replaced again afterwards.
     */
    @Transactional
    public PayoutDestination record(
            UUID accountId, String provider, String reference, String holderName, String displayHint) {

        String canonical = PaymentProviders.canonicalNameOf(provider)
                .orElseThrow(() -> new UnknownDestinationProviderException(provider));

        Instant now = clock.instant();
        Optional<PayoutDestination> existing = destinations.findById(accountId);
        PayoutDestination row = existing.map(found -> {
                    found.replaceWith(canonical, reference, holderName, displayHint, now);
                    return found;
                })
                .orElseGet(() -> PayoutDestination.of(accountId, canonical, reference, holderName, displayHint, now));

        Optional<LegalSubject> subject = legalSubjects.of(accountId);
        boolean matched = subject.map(known -> known.nameMatches(holderName)).orElse(true);
        if (!matched) {
            row.nameDidNotMatch(now);
        }

        PayoutDestination saved = destinations.save(row);
        audit.record(
                AuditAction.PAYOUT_DESTINATION_RECORDED,
                accountId,
                AuditActor.user(accountId),
                matched ? AuditOutcome.SUCCEEDED : AuditOutcome.REFUSED,
                "provider=%s; holder=%s; first=%s; state=%s; hadSubject=%s"
                        .formatted(canonical, holderName, existing.isEmpty(), saved.getState(), subject.isPresent()));

        log.info("Account {} filed a {} payout destination; state {}", accountId, canonical, saved.getState());
        return saved;
    }

    /**
     * File a bank account, or replace whatever is on file with one — #394.
     *
     * <p>{@link #record}'s rules, unchanged: always a replacement, which clears any verification;
     * the holder's name matched against the legal name, a disagreement stored as
     * {@code NAME_MISMATCH} rather than refused; audited on the creator's own account.
     *
     * <p><strong>Only an Azerbaijani IBAN</strong> — {@link Iban#parseAzerbaijani}. The platform
     * pays creators from an Azerbaijani account in manat, and a foreign account is a currency
     * and a correspondent-bank question nobody has answered.
     *
     * <p>The account is sealed before anything is written, so an unconfigured keyring refuses
     * with a 503 and leaves the row on file exactly as it was. The audit detail carries the
     * masked hint and never the number, and {@code sameAccountElsewhere} — how many other
     * accounts filed the same IBAN — so the reviewer sees the coincidence in the trail.
     *
     * @throws az.ideanest.compliance.domain.MalformedIbanException when the number is not a
     *     valid Azerbaijani IBAN
     * @throws az.ideanest.shared.crypto.FieldEncryptionNotConfiguredException when the
     *     {@code bank-details} keyring has no key
     */
    @Transactional
    public PayoutDestination recordBankAccount(UUID accountId, String typedIban, String holderName) {
        Iban iban = Iban.parseAzerbaijani(typedIban);
        String fingerprint = fingerprints.of(iban.value());
        Sealed sealed = bankDetails.seal(
                iban.value().getBytes(StandardCharsets.UTF_8), PayoutDestination.accountContext(accountId));

        Instant now = clock.instant();
        Optional<PayoutDestination> existing = destinations.findById(accountId);
        PayoutDestination row = existing.map(found -> {
                    found.replaceWithBankAccount(fingerprint, holderName, iban.displayHint(), sealed, now);
                    return found;
                })
                .orElseGet(() -> PayoutDestination.ofBankAccount(
                        accountId, fingerprint, holderName, iban.displayHint(), sealed, now));

        Optional<LegalSubject> subject = legalSubjects.of(accountId);
        boolean matched = subject.map(known -> known.nameMatches(holderName)).orElse(true);
        if (!matched) {
            row.nameDidNotMatch(now);
        }

        PayoutDestination saved = destinations.save(row);
        long elsewhere = destinations.countOthersWithReference(
                DestinationKind.BANK_TRANSFER.name(), fingerprints.candidates(iban.value()), accountId);
        audit.record(
                AuditAction.PAYOUT_DESTINATION_RECORDED,
                accountId,
                AuditActor.user(accountId),
                matched ? AuditOutcome.SUCCEEDED : AuditOutcome.REFUSED,
                "provider=%s; account=%s; holder=%s; first=%s; state=%s; hadSubject=%s; sameAccountElsewhere=%d"
                        .formatted(
                                DestinationKind.BANK_TRANSFER,
                                iban.displayHint(),
                                holderName,
                                existing.isEmpty(),
                                saved.getState(),
                                subject.isPresent(),
                                elsewhere));

        log.info(
                "Account {} filed a bank account payout destination {}; state {}",
                accountId,
                iban.displayHint(),
                saved.getState());
        return saved;
    }

    /**
     * A reviewer confirms the account belongs to the creator.
     *
     * <p>{@link StaffCapability#VERIFY_PAYOUT_DESTINATION}, which V66 gave to COMPLIANCE and
     * deliberately withheld from FINANCE: the person who confirms that an account belongs to
     * the creator it is filed under is not the person who sends money to it.
     *
     * <p>Refused on a name mismatch rather than allowed with a warning — see
     * {@link DestinationNameMismatchException} — and refused on one's own account, on V66's
     * rule that nobody decides anything about their own.
     *
     * <p>Verifying an already-verified row is a no-op that still writes an audit entry, which
     * is deliberate: the second reviewer learned nothing new, and the fact that somebody looked
     * again is the part worth keeping.
     */
    @Transactional
    public PayoutDestination verify(UUID staffId, UUID creatorId, DestinationVerificationMethod method) {
        staff.requireCapability(staffId, StaffCapability.VERIFY_PAYOUT_DESTINATION);
        if (staffId.equals(creatorId)) {
            throw new SelfVerifiedDestinationException(creatorId);
        }

        PayoutDestination row =
                destinations.findById(creatorId).orElseThrow(() -> new UnknownPayoutDestinationException(creatorId));

        if (row.getState() == DestinationState.NAME_MISMATCH) {
            audit.recordIndependently(
                    AuditAction.PAYOUT_DESTINATION_VERIFIED,
                    creatorId,
                    AuditActor.moderator(staffId),
                    AuditOutcome.REFUSED,
                    "nameMismatch; holder=%s".formatted(row.getHolderName()));
            throw new DestinationNameMismatchException(creatorId, row.getHolderName());
        }

        Instant now = clock.instant();
        row.verified(staffId, method, now);
        PayoutDestination saved = destinations.save(row);

        audit.record(
                AuditAction.PAYOUT_DESTINATION_VERIFIED,
                creatorId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "method=%s; provider=%s; holder=%s".formatted(method, saved.getProvider(), saved.getHolderName()));

        log.info("Payout destination of {} verified by {} via {}", creatorId, staffId, method);
        return saved;
    }

    /**
     * A reviewer refuses the account, with a reason the creator is shown.
     *
     * <p>V58's closed set, for V58's reason: the reason is shown to the creator, so it has to
     * be one the product has words for in each of §21.1's four languages.
     */
    @Transactional
    public PayoutDestination reject(UUID staffId, UUID creatorId, RejectionReason reason) {
        staff.requireCapability(staffId, StaffCapability.VERIFY_PAYOUT_DESTINATION);
        if (staffId.equals(creatorId)) {
            throw new SelfVerifiedDestinationException(creatorId);
        }

        PayoutDestination row =
                destinations.findById(creatorId).orElseThrow(() -> new UnknownPayoutDestinationException(creatorId));

        Instant now = clock.instant();
        row.reject(reason, now);
        PayoutDestination saved = destinations.save(row);

        audit.record(
                AuditAction.PAYOUT_DESTINATION_VERIFIED,
                creatorId,
                AuditActor.moderator(staffId),
                AuditOutcome.REFUSED,
                "reason=%s; provider=%s".formatted(reason, saved.getProvider()));

        log.info("Payout destination of {} refused by {}: {}", creatorId, staffId, reason);
        return saved;
    }

    /**
     * One creator's destination, read by a member of staff.
     *
     * <p>Audited, on {@code LEGAL_SUBJECT_READ}'s argument: a read of somebody's own record
     * rather than of the platform's should be answerable, it costs nothing to record, and its
     * absence is discovered only during the investigation that needed it.
     *
     * <p><strong>Not {@code readOnly}</strong>, for {@code CreatorLegalSubjects.forStaff}'s
     * reason: the audit insert is {@code MANDATORY} into this transaction and PostgreSQL
     * refuses an insert in a read-only one, so a read that records the read is a write.
     */
    @Transactional
    public Optional<PayoutDestination> forStaff(UUID staffId, UUID creatorId) {
        staff.requireCapability(staffId, StaffCapability.VERIFY_PAYOUT_DESTINATION);
        Optional<PayoutDestination> row = destinations.findById(creatorId);
        audit.record(
                AuditAction.PAYOUT_DESTINATION_READ,
                creatorId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "recorded=%s".formatted(row.isPresent()));
        return row;
    }

    /**
     * COMPLIANCE's queue: destinations waiting on somebody.
     *
     * <p>Not audited, and the asymmetry with {@link #forStaff} is deliberate. The queue shows
     * that a destination exists and what state it is in; opening one is what discloses the
     * holder's name, and that is the read worth a row. Auditing the list as well would write
     * fifty entries every time somebody refreshed a screen, which is how a trail stops being
     * readable.
     *
     * <p>Paged and filtered here since #419, in {@code PayoutService.queue}'s shape: a page
     * number from zero, {@link #PAGE_SIZE} to a page. Before that the console filtered the
     * fifty oldest in the browser, so a state with nothing among those fifty read as empty
     * however many waited behind them.
     *
     * @param state one of the queue's states, or null for every one of them
     */
    @Transactional(readOnly = true)
    public List<PayoutDestination> queue(UUID staffId, DestinationState state, int page) {
        staff.requireCapability(staffId, StaffCapability.VERIFY_PAYOUT_DESTINATION);
        PageRequest request = PageRequest.of(Math.max(page, 0), PAGE_SIZE);

        return state == null
                ? destinations.awaiting(DestinationState.VERIFIED, request)
                : destinations.awaitingIn(state, DestinationState.VERIFIED, request);
    }
}
