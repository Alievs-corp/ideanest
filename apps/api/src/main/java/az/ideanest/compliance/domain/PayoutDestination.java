package az.ideanest.compliance.domain;

import az.ideanest.shared.compliance.DestinationKind;
import az.ideanest.shared.compliance.RejectionReason;
import az.ideanest.shared.crypto.FieldCipher;
import az.ideanest.shared.crypto.Sealed;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Where a creator is paid, on their account — part of issue #432.
 *
 * <p>One row per account, keyed by the account. The creator supplies it; a member of staff
 * holding {@code VERIFY_PAYOUT_DESTINATION} confirms it belongs to them; the payout reads it
 * and never accepts one from whoever is sending.
 *
 * <h2>Two kinds of destination, since epic #392</h2>
 *
 * <p><strong>A provider token</strong>, which is what #432 built: the reference is an opaque
 * provider token, and the provider holds the bank details.
 *
 * <p><strong>A bank account</strong> (#394), which reverses #432's "the platform never stores
 * an IBAN". The owner decided on 2026-10-12 that creators are paid by bank transfer from
 * IdeyaNest's own account, so the platform has to hold the account it pays into. It holds it
 * the way §17.4 says bank details are held: sealed by the {@code bank-details} keyring, bound
 * to this row, and shown everywhere as a masked hint. {@code provider} is
 * {@link DestinationKind#BANK_TRANSFER}, {@code reference} is the IBAN's keyed fingerprint —
 * comparable, so a second account filing the same IBAN can be noticed, and useless without
 * the key — and the account itself is only in {@link #sealedAccount()}. V97 makes the sealed
 * columns present exactly when the provider says bank transfer.
 *
 * <p>An IBAN is not card data, so §17.2's SAQ A position is unchanged.
 *
 * <h2>Replacing the account clears the verification, in the entity</h2>
 *
 * <p>{@link #replaceWith} is the only way to change the token, and it resets the row to
 * {@link DestinationState#AWAITING_VERIFICATION} on the way. There is no setter that
 * changes the reference without doing so, because the bug that would produce is the exact
 * fraud this issue exists to stop — a destination verified in March, swapped in June,
 * inheriting March's verification — and it would leave a row that looked entirely normal.
 * V72 asserts the same thing as a constraint, so the invariant survives anything that
 * reaches the table by another route.
 */
@Entity
@Table(name = "payout_destinations")
public class PayoutDestination {

    @Id
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "provider", nullable = false)
    private String provider;

    @Column(name = "reference", nullable = false)
    private String reference;

    @Column(name = "holder_name", nullable = false)
    private String holderName;

    @Column(name = "display_hint")
    private String displayHint;

    @Column(name = "account_ciphertext")
    private byte[] accountCiphertext;

    @Column(name = "account_nonce")
    private byte[] accountNonce;

    @Column(name = "account_key_id")
    private String accountKeyId;

    @Enumerated(EnumType.STRING)
    @Column(name = "state", nullable = false)
    private DestinationState state;

    @Enumerated(EnumType.STRING)
    @Column(name = "rejection_reason")
    private RejectionReason rejectionReason;

    @Enumerated(EnumType.STRING)
    @Column(name = "verification_method")
    private DestinationVerificationMethod verificationMethod;

    @Column(name = "verified_at")
    private Instant verifiedAt;

    @Column(name = "verified_by")
    private UUID verifiedBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected PayoutDestination() {
    }

    private PayoutDestination(
            UUID userId,
            String provider,
            String reference,
            String holderName,
            String displayHint,
            Sealed account,
            Instant now) {
        this.userId = Objects.requireNonNull(userId, "A payout destination is somebody's");
        this.createdAt = at(now);
        // Not the public `replaceWith`: calling an overridable method from a constructor is
        // what `-Xlint:this-escape` refuses, and the build treats that as an error.
        replace(provider, reference, holderName, displayHint, account, now);
    }

    public static PayoutDestination of(
            UUID userId, String provider, String reference, String holderName, String displayHint, Instant now) {
        return new PayoutDestination(userId, provider, reference, holderName, displayHint, null, now);
    }

    /**
     * A bank account, filed for the first time — #394.
     *
     * @param fingerprint the IBAN's keyed fingerprint, stored as the reference
     * @param account the IBAN, sealed with {@link #accountContext} as its additional data
     */
    public static PayoutDestination ofBankAccount(
            UUID userId, String fingerprint, String holderName, String displayHint, Sealed account, Instant now) {
        return new PayoutDestination(
                userId,
                DestinationKind.BANK_TRANSFER.name(),
                fingerprint,
                holderName,
                displayHint,
                Objects.requireNonNull(account, "A bank account destination holds the account"),
                now);
    }

    /**
     * The additional authenticated data an account on this creator's row is sealed with.
     *
     * <p>Static, because it is needed before a first row exists: the row's key is the creator,
     * so the context is known as soon as they are.
     */
    public static String accountContext(UUID userId) {
        return FieldCipher.rowContext("payout_destinations", userId);
    }

    /**
     * File a different account, and start the verification again.
     *
     * <p>Every replacement resets, including one that arrives with the same token: a creator
     * re-submitting an identical destination is either correcting the holder name or
     * probing, and neither is a reason to keep a verification that was given for what the row
     * said at the time.
     */
    public void replaceWith(String provider, String reference, String holderName, String displayHint, Instant now) {
        replace(provider, reference, holderName, displayHint, null, now);
    }

    /**
     * File a bank account instead of whatever is on file, and start the verification again —
     * #394. The same {@link #replace} as a token, so the reset cannot differ between the two.
     */
    public void replaceWithBankAccount(
            String fingerprint, String holderName, String displayHint, Sealed account, Instant now) {
        replace(
                DestinationKind.BANK_TRANSFER.name(),
                fingerprint,
                holderName,
                displayHint,
                Objects.requireNonNull(account, "A bank account destination holds the account"),
                now);
    }

    private void replace(
            String provider, String reference, String holderName, String displayHint, Sealed account, Instant now) {
        String named = required(provider, "A payout destination names the provider that issued its token");
        if (isBankTransfer(named) != (account != null)) {
            // V97 refuses the row as well; this is the readable half, and it fires before a
            // token is filed with an account still sealed beside it.
            throw new IllegalArgumentException(
                    "A bank account is held exactly when the destination is a bank transfer");
        }
        this.provider = named;
        this.reference = required(reference, "A payout destination has somewhere to go");
        this.holderName = required(holderName, "A payout destination names its account holder");
        this.displayHint = blankToNull(displayHint);
        this.accountCiphertext = account == null ? null : account.ciphertext();
        this.accountNonce = account == null ? null : account.nonce();
        this.accountKeyId = account == null ? null : account.keyId();
        this.state = DestinationState.AWAITING_VERIFICATION;
        this.rejectionReason = null;
        this.verificationMethod = null;
        this.verifiedAt = null;
        this.verifiedBy = null;
        this.updatedAt = at(now);
    }

    /**
     * Record that the holder's name is not the creator's legal name.
     *
     * <p>Separate from {@link #reject}, although V58's vocabulary would let it be a rejection
     * with {@code MISMATCHED_NAME} on it. The difference is who decided: this is the platform
     * comparing two strings at the moment the creator saved, and a rejection is a person
     * looking at evidence. Collapsing them would make an automatic comparison read, in the
     * console and in the trail, as though a reviewer had refused something.
     */
    public void nameDidNotMatch(Instant now) {
        this.state = DestinationState.NAME_MISMATCH;
        this.rejectionReason = null;
        this.verificationMethod = null;
        this.verifiedAt = null;
        this.verifiedBy = null;
        this.updatedAt = at(now);
    }

    /** Confirmed, by whom, how, and when. */
    public void verified(UUID verifierId, DestinationVerificationMethod method, Instant now) {
        this.verifiedBy = Objects.requireNonNull(verifierId, "A verification has somebody's name on it");
        this.verificationMethod = Objects.requireNonNull(method, "A verification says how it was done");
        this.state = DestinationState.VERIFIED;
        this.rejectionReason = null;
        this.verifiedAt = at(now);
        this.updatedAt = at(now);
    }

    /** Refused, with a reason the creator can be shown. */
    public void reject(RejectionReason reason, Instant now) {
        this.rejectionReason = Objects.requireNonNull(reason, "A refusal says why");
        this.state = DestinationState.REJECTED;
        this.verificationMethod = null;
        this.verifiedAt = null;
        this.verifiedBy = null;
        this.updatedAt = at(now);
    }

    /**
     * Whether this row was tokenised by the provider a payout is about to be sent through.
     *
     * <p>Never true for a bank account: its reference is a fingerprint, and no provider can
     * send money to one.
     */
    public boolean issuedBy(String candidate) {
        return !isBankAccount() && candidate != null && provider.equalsIgnoreCase(candidate.trim());
    }

    /** Which route a payout to this row takes. */
    public DestinationKind kind() {
        return isBankAccount() ? DestinationKind.BANK_TRANSFER : DestinationKind.PROVIDER_TOKEN;
    }

    /** Whether this row is an IBAN the platform holds rather than a provider's token. */
    public boolean isBankAccount() {
        return isBankTransfer(provider);
    }

    /**
     * The sealed IBAN, for a bank account; empty for a token. Opened with
     * {@link #accountContext} as the additional data.
     */
    public Optional<Sealed> sealedAccount() {
        if (accountCiphertext == null) {
            return Optional.empty();
        }
        return Optional.of(new Sealed(accountCiphertext, accountNonce, accountKeyId));
    }

    private static boolean isBankTransfer(String provider) {
        return DestinationKind.BANK_TRANSFER.name().equals(provider);
    }

    private static Instant at(Instant now) {
        return now.truncatedTo(ChronoUnit.MICROS);
    }

    private static String required(String value, String message) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(message);
        }
        return value.trim();
    }

    private static String blankToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    public UUID getUserId() {
        return userId;
    }

    public String getProvider() {
        return provider;
    }

    public String getReference() {
        return reference;
    }

    public String getHolderName() {
        return holderName;
    }

    public String getDisplayHint() {
        return displayHint;
    }

    public DestinationState getState() {
        return state;
    }

    public Optional<RejectionReason> rejection() {
        return Optional.ofNullable(rejectionReason);
    }

    public Optional<DestinationVerificationMethod> verifiedHow() {
        return Optional.ofNullable(verificationMethod);
    }

    public Instant getVerifiedAt() {
        return verifiedAt;
    }

    public UUID getVerifiedBy() {
        return verifiedBy;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    /**
     * The reference, unreadable. What a log line is allowed to contain.
     *
     * <p>{@code PayoutRequest.toString} redacts the same value one layer down, and both are
     * needed: an entity that printed its token would put it in a Hibernate log without
     * anything having gone wrong.
     */
    @Override
    public String toString() {
        return "PayoutDestination[user=" + userId + ", provider=" + provider + ", state=" + state
                + ", reference=<redacted>]";
    }
}
