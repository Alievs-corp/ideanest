package az.ideanest.support;

import az.ideanest.payment.domain.HostedPaymentRequest;
import az.ideanest.payment.domain.HostedPaymentSession;
import az.ideanest.payment.domain.PaymentLookup;
import az.ideanest.payment.domain.PaymentEvent;
import az.ideanest.payment.domain.PaymentEventType;
import az.ideanest.payment.domain.PaymentProvider;
import az.ideanest.payment.domain.PaymentUndecidedException;
import az.ideanest.payment.domain.PayoutCardRequest;
import az.ideanest.payment.domain.PayoutCardSession;
import az.ideanest.payment.domain.PayoutRequest;
import az.ideanest.payment.domain.PayoutResult;
import az.ideanest.payment.domain.ProviderCapabilities;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.payment.domain.ProviderUnavailableException;
import az.ideanest.payment.domain.RefundRequest;
import az.ideanest.payment.domain.RefundResult;
import az.ideanest.shared.money.Money;
import java.net.URI;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * A payment provider a test writes the answers for.
 *
 * <p><strong>A stub, and allowed here for the reason one is refused in {@code src/main}.</strong>
 * An adapter that returned an approval in a deployed environment would tell clients a payment
 * happened when none did. In the suite nobody is told anything and nothing is deployed; what a
 * scripted provider buys is the payment pages, refunds, payouts and webhooks exercised end to end
 * without a merchant account. It lives in {@code src/test} for that reason and no other.
 *
 * <p>Until #45 it also scripted the stored-card charges of the collection at close — approvals,
 * declines, outages and §9.6's retries. That collection is gone, and so are those scripts.
 */
public class ScriptedPaymentProvider implements PaymentProvider {

    /**
     * Azericard, because it is in §9.3 and has no real adapter that would claim the name
     * (#351 gave Payriff one). The test profile names it. The value is
     * arbitrary and the fact that it is fixed is not: it is stored on every
     * {@code transactions} row a test writes, and a provider that varied would make those
     * rows unassertable.
     */
    private static final ProviderName NAME = ProviderName.AZERICARD;

    private final AtomicInteger providerTransactionCounter = new AtomicInteger();

    /**
     * Forgets the script and every recorded call. Called between tests.
     *
     * <p><strong>The provider transaction counter is deliberately not reset.</strong>
     * {@code transactions_settled_provider_key} is unique over
     * {@code (provider, provider_transaction_id)} across the whole table, and V41 makes
     * that table append-only — so rows from an earlier test in the shared container are
     * still there. A counter that restarted would collide with them, and the failure
     * would look like a bug in the code under test rather than in the fixture.
     */
    public void reset() {
        refundRefusal = null;
        refundsTooOld = false;
        lostRefundAnswers.set(0);
        lostRefundAnswersFor.clear();
        unreachableRefunds.clear();
        hostedPagesUnavailable = false;
        lookups.clear();
        payoutAnswers.clear();
        payouts.clear();
    }

    // ------------------------------------------------------------------
    // PaymentProvider
    // ------------------------------------------------------------------

    @Override
    public ProviderName name() {
        return NAME;
    }

    /** IDN-EXT-01 (#44): every payout card registration the platform began, in order. */
    private final List<PayoutCardRequest> payoutCardRegistrations = Collections.synchronizedList(new ArrayList<>());

    public List<PayoutCardRequest> payoutCardRegistrations() {
        synchronized (payoutCardRegistrations) {
            return List.copyOf(payoutCardRegistrations);
        }
    }

    @Override
    public boolean registersPayoutCards() {
        return true;
    }

    /** A card entry page on a host nothing resolves; the registration is settled by a scripted webhook. */
    @Override
    public PayoutCardSession beginPayoutCardRegistration(PayoutCardRequest request) {
        payoutCardRegistrations.add(request);
        String card = "scripted-card-" + providerTransactionCounter.incrementAndGet();
        return new PayoutCardSession(card, URI.create("https://pay.scripted.invalid/card/" + card));
    }

    /** IDN-EXT-01 (#39): every payment page the platform asked for, in order. */
    private final List<HostedPaymentRequest> hostedPayments = Collections.synchronizedList(new ArrayList<>());

    public List<HostedPaymentRequest> hostedPayments() {
        synchronized (hostedPayments) {
            return List.copyOf(hostedPayments);
        }
    }

    private volatile boolean hostedPagesUnavailable;

    /** Every payment page from now on cannot be opened: the provider cannot be reached (#171). */
    public void willRefuseHostedPayments() {
        hostedPagesUnavailable = true;
    }

    /** Payment pages open again. */
    public void willOpenHostedPayments() {
        hostedPagesUnavailable = false;
    }

    /** A payment page on a host nothing resolves; the payment is settled by a scripted webhook. */
    @Override
    public HostedPaymentSession beginHostedPayment(HostedPaymentRequest request) {
        if (hostedPagesUnavailable) {
            throw new az.ideanest.payment.domain.ProviderUnavailableException(NAME, "Scripted: no payment page");
        }
        hostedPayments.add(request);
        String transaction = "scripted-hosted-" + providerTransactionCounter.incrementAndGet();
        return new HostedPaymentSession(transaction, URI.create("https://pay.scripted.invalid/" + transaction));
    }

    @Override
    public ProviderCapabilities capabilities() {
        return new ProviderCapabilities(false, true, Set.of(), Set.of("AZN", "USD", "EUR"));
    }

    /** IDN-EXT-01 (#40): every reversal the platform asked for, in order. */
    private final List<RefundRequest> refunds = Collections.synchronizedList(new ArrayList<>());

    private volatile String refundRefusal;

    /** What {@link #lookUpPayment} answers, by provider transaction; {@code SUCCEEDED} when unscripted. */
    private final Map<String, PaymentLookup.State> lookups = new java.util.concurrent.ConcurrentHashMap<>();

    /** #587: the amount {@link #lookUpPayment} reports, by provider transaction; none when unscripted. */
    private final Map<String, Money> lookedUpAmounts = new java.util.concurrent.ConcurrentHashMap<>();

    public List<RefundRequest> refunds() {
        synchronized (refunds) {
            return List.copyOf(refunds);
        }
    }

    /** The next refunds are refused with this code, until {@link #willRefund()}. */
    public void willRefuseRefunds(String code) {
        refundRefusal = code;
        refundsTooOld = false;
    }

    /** #399: the next refunds are refused as past the refund window, until {@link #willRefund()}. */
    public void willRefuseRefundsAsTooOld() {
        refundRefusal = null;
        refundsTooOld = true;
    }

    private volatile boolean refundsTooOld;

    public void willRefund() {
        refundRefusal = null;
        refundsTooOld = false;
    }

    private final AtomicInteger lostRefundAnswers = new AtomicInteger();

    /**
     * The next {@code count} refunds reach the provider and are recorded here, and their answer is
     * lost on the way back — the process dying between the call and the record (#40, #171). The
     * caller sees an exception that is not {@code ProviderUnavailableException}, so its refund row
     * stays {@code REQUESTED}.
     */
    public void loseRefundAnswers(int count) {
        lostRefundAnswers.set(count);
    }

    private final Set<String> lostRefundAnswersFor = java.util.concurrent.ConcurrentHashMap.newKeySet();

    /**
     * The next refund of this payment reaches the provider and its answer is lost, as
     * {@link #loseRefundAnswers} — for one payment, whatever order the refunds are sent in (#174).
     */
    public void loseRefundAnswerFor(String providerTransactionId) {
        lostRefundAnswersFor.add(providerTransactionId);
    }

    /** Every refund's answer arrives again: undoes {@link #loseRefundAnswers} and {@link #loseRefundAnswerFor}. */
    public void answerEveryRefund() {
        lostRefundAnswers.set(0);
        lostRefundAnswersFor.clear();
    }

    public void willLookUp(String providerTransactionId, PaymentLookup.State state) {
        lookups.put(providerTransactionId, state);
    }

    /** #587: a lookup that also says how much was paid. */
    public void willLookUp(String providerTransactionId, PaymentLookup.State state, Money amount) {
        lookups.put(providerTransactionId, state);
        lookedUpAmounts.put(providerTransactionId, amount);
    }

    /** What the next refunds do before their answer is lost as unreachable (#176), one per refund. */
    private final Deque<Boolean> unreachableRefunds = new ConcurrentLinkedDeque<>();

    /**
     * The next refund reaches the provider, <strong>is applied</strong> — the payment is reported
     * {@code RETURNED} from then on — and its answer never arrives: the caller sees
     * {@code ProviderUnavailableException}, as for a read timeout after the provider acted (#176).
     */
    public void nextRefundAppliedButUnreachable() {
        unreachableRefunds.addLast(true);
    }

    /**
     * The next refund cannot be told apart from {@link #nextRefundAppliedButUnreachable} by its caller,
     * but never reached the provider's books: the payment is still reported paid (#176).
     */
    public void nextRefundUnreachableAndNotApplied() {
        unreachableRefunds.addLast(false);
    }

    @Override
    public RefundResult refund(RefundRequest request) {
        refunds.add(request);
        Boolean applied = unreachableRefunds.pollFirst();
        if (applied != null) {
            if (applied) {
                lookups.put(request.providerTransactionId(), PaymentLookup.State.RETURNED);
            }
            throw new ProviderUnavailableException(NAME, "Scripted: the refund's answer did not arrive");
        }
        if (lostRefundAnswersFor.remove(request.providerTransactionId())
                || lostRefundAnswers.getAndUpdate(left -> Math.max(left - 1, 0)) > 0) {
            throw new IllegalStateException("Scripted: the refund's answer was lost");
        }
        if (refundsTooOld) {
            return RefundResult.windowClosed("scripted_too_old", "Scripted: past the refund window", "{\"scripted\":true}");
        }
        String refusal = refundRefusal;
        if (refusal != null) {
            return new RefundResult(ProviderOutcome.DECLINED, null, refusal, "Scripted refusal", "{\"scripted\":true}");
        }
        // Like Epoint's /reverse: no transaction of its own.
        return new RefundResult(ProviderOutcome.APPROVED, null, null, null, "{\"scripted\":true}");
    }

    @Override
    public PaymentLookup lookUpPayment(String providerTransactionId) {
        return new PaymentLookup(
                lookups.getOrDefault(providerTransactionId, PaymentLookup.State.SUCCEEDED),
                providerTransactionId,
                null,
                null,
                "{\"scripted\":true}",
                lookedUpAmounts.get(providerTransactionId));
    }

    /**
     * The next payout answers, in order — #184's review. {@code null} is an unreachable provider; a
     * {@link ProviderOutcome} is that answer. Unscripted, a payout still throws: no suite sends one by
     * accident.
     */
    private final Deque<java.util.Optional<ProviderOutcome>> payoutAnswers = new ConcurrentLinkedDeque<>();

    private final List<PayoutRequest> payouts = Collections.synchronizedList(new ArrayList<>());

    /** The next payout sent is answered with this outcome. */
    public void nextPayout(ProviderOutcome outcome) {
        payoutAnswers.addLast(java.util.Optional.of(outcome));
    }

    /** The next payout sent finds the provider unreachable. */
    public void nextPayoutUnreachable() {
        payoutAnswers.addLast(java.util.Optional.empty());
    }

    /** Every payout this provider was asked to send, in order. */
    public List<PayoutRequest> payouts() {
        synchronized (payouts) {
            return List.copyOf(payouts);
        }
    }

    @Override
    public PayoutResult payout(PayoutRequest request) {
        java.util.Optional<ProviderOutcome> answer = payoutAnswers.pollFirst();
        if (answer == null) {
            throw new UnsupportedOperationException("No payout answer was scripted for this test");
        }
        payouts.add(request);
        if (answer.isEmpty()) {
            throw new ProviderUnavailableException(NAME, "The scripted provider could not be reached");
        }
        ProviderOutcome outcome = answer.get();
        return new PayoutResult(
                outcome,
                "scripted-payout-" + providerTransactionCounter.incrementAndGet(),
                outcome == ProviderOutcome.DECLINED ? "duplicate_order_id" : null,
                outcome == ProviderOutcome.DECLINED ? "The order was already processed" : null,
                "{\"scripted\":true}");
    }

    /**
     * A signature scheme simple enough to be obviously right and real enough to refuse a
     * forgery: the body must be JSON carrying an {@code id} and a {@code type}, and the
     * {@code x-scripted-signature} header must equal the shared secret.
     *
     * <p>A real adapter computes an HMAC over the bytes. This does not, because what the
     * suite is testing is {@code ProviderWebhooks} — that an unverifiable body never
     * becomes an event, that a stale timestamp is refused, and that a redelivery does
     * nothing twice — and none of those depend on which MAC the provider chose. What they
     * do depend on is that verification and parsing are one call, which this honours.
     */
    @Override
    public PaymentEvent parseWebhook(byte[] rawBody, Map<String, String> headers) {
        if (confirmsByAsking) {
            callbackConfirmations.incrementAndGet();
            String answer = confirmationAnswer;
            if ("undecided".equals(answer)) {
                throw new PaymentUndecidedException(NAME, "Scripted: the payment is still pending");
            }
            if ("unreachable".equals(answer)) {
                throw new ProviderUnavailableException(NAME, "Scripted: the confirmation was not answered");
            }
        }
        return ScriptedWebhooks.parse(NAME, rawBody, headers);
    }

    // ------------------------------------------------------------------
    // #587: an unsigned provider, which verifies a callback by asking
    // ------------------------------------------------------------------

    private volatile boolean confirmsByAsking;

    private volatile String confirmationAnswer = "answered";

    private final AtomicInteger callbackConfirmations = new AtomicInteger();

    /**
     * From now on this provider behaves as Payriff does: a callback names its transaction unsigned, and is
     * verified by asking the provider — each ask counted in {@link #callbackConfirmations}. The signature is
     * still checked as well, so a suite's ordinary deliveries are unaffected.
     */
    public void confirmCallbacksByAsking() {
        confirmsByAsking = true;
        confirmationAnswer = "answered";
    }

    /** The asks answer that the payment is still undecided. */
    public void willAnswerConfirmationsUndecided() {
        confirmationAnswer = "undecided";
    }

    /** The asks go unanswered: the provider cannot be reached. */
    public void willLeaveConfirmationsUnanswered() {
        confirmationAnswer = "unreachable";
    }

    /** Back to a signed provider: undoes {@link #confirmCallbacksByAsking}. */
    public void verifyCallbacksBySignature() {
        confirmsByAsking = false;
        confirmationAnswer = "answered";
    }

    /** How many times a callback was confirmed by asking. */
    public int callbackConfirmations() {
        return callbackConfirmations.get();
    }

    @Override
    public java.util.Optional<String> unsignedCallbackReference(byte[] rawBody) {
        return confirmsByAsking ? java.util.Optional.of(ScriptedWebhooks.transactionNamedBy(rawBody)) : java.util.Optional.empty();
    }

    /** Convenience for a test that wants to assert on an amount without rebuilding one. */
    public static Money azn(String amount) {
        return Money.of(new java.math.BigDecimal(amount), "AZN");
    }

    /** The event types the scripted webhook parser understands. Everything else is UNRECOGNISED. */
    public static Set<PaymentEventType> knownWebhookTypes() {
        return Set.of(
                PaymentEventType.CHARGE_SUCCEEDED,
                PaymentEventType.CHARGE_FAILED,
                PaymentEventType.REFUND_SUCCEEDED,
                PaymentEventType.CHARGEBACK_OPENED);
    }

    /** The instant a scripted delivery claims to have been signed at, when a test does not say. */
    public static Instant defaultSignedAt() {
        return Instant.parse("2026-01-01T00:00:00Z");
    }
}
