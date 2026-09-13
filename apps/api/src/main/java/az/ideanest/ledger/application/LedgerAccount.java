package az.ideanest.ledger.application;

import java.util.Locale;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * One of §7.2's six accounts, as a value rather than as a string somebody typed.
 *
 * <p>The vocabulary is closed: {@code escrow}, {@code creator:{id}},
 * {@code platform_fee}, {@code psp_fee}, {@code tax_payable}, {@code refunds}. V41's
 * check constraint is the enforcement and this is the only sanctioned way to produce
 * a value that satisfies it — which is the point of the type. A ledger whose accounts
 * are strings acquires a {@code platform_fees} within a year, and the sum that was
 * supposed to be the platform's revenue is then quietly two sums.
 *
 * <p><strong>Not an enum, because one of the six is parameterised.</strong>
 * {@code creator:{id}} is one account per creator, so the set is open at runtime and
 * closed in shape. An enum with a {@code CREATOR} constant would have to carry the
 * identifier somewhere else, and the two halves would travel separately through every
 * method that took an account.
 *
 * <p><strong>The currency is not part of an account.</strong> §21.2 refuses to convert
 * between currencies for anything that moves money, so a campaign's escrow in manat
 * and another's in dollars are the same account holding two balances that are never
 * added; the currency lives on the entry, and every balance is asked for in one.
 */
public record LedgerAccount(String name) {

    /**
     * Where a collection lands and where a payout leaves from. §9.5's centre.
     *
     * <p>One account and not one per campaign, deliberately: it is a real pooled
     * balance at a real institution, and §22.1's whole regulatory question is about
     * that pool. Which campaign a given qapik belongs to is
     * {@code ledger_entries.project_id}, which is on every row.
     */
    public static final LedgerAccount ESCROW = new LedgerAccount("escrow");

    /** §5.2's platform fee: 15% of a withdrawal, the bank's fee inside it (IDN-EXT-01). */
    public static final LedgerAccount PLATFORM_FEE = new LedgerAccount("platform_fee");

    /** §5.2's processing fee: what the provider keeps out of each successful collection. */
    public static final LedgerAccount PSP_FEE = new LedgerAccount("psp_fee");

    /**
     * What is owed to a tax authority. #78's, and nothing credits it while
     * {@code pledges.tax_amount} is zero on every row — which it is, because tax
     * collection is unbuilt and blocked on a legal answer.
     */
    public static final LedgerAccount TAX_PAYABLE = new LedgerAccount("tax_payable");

    /** What has gone back to backers. #67's and #68's. */
    public static final LedgerAccount REFUNDS = new LedgerAccount("refunds");

    /**
     * The platform's own costs, such as what refunding backers costs — §5.2, IDN-EXT-01 (#42). Kept
     * apart from {@link #REFUNDS}, which is backers' money going back, so a cost is never netted
     * against a payout. Nothing posts to it until a provider reports such a cost.
     */
    public static final LedgerAccount PLATFORM_EXPENSE = new LedgerAccount("platform_expense");

    private static final String CREATOR_PREFIX = "creator:";

    /**
     * The same pattern as V41's {@code ledger_entries_account_known}, anchored at both
     * ends. Duplicated here on purpose and not derived from anything: the database is
     * where the rule is enforced, and this is how the application refuses a bad account
     * at the line that produced it rather than at a commit.
     */
    private static final Pattern CREATOR = Pattern.compile(
            "^creator:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");

    public LedgerAccount {
        Objects.requireNonNull(name, "An entry belongs to an account");
        if (!isKnown(name)) {
            throw new IllegalArgumentException(
                    "'" + name + "' is not one of §7.2's accounts. See LedgerAccount for the seven.");
        }
    }

    /**
     * What a particular creator has earned and not yet been paid.
     *
     * <p>Lower-cased, because the pattern above and V41's constraint both require the
     * canonical hyphenated lower-case form of a UUID and {@link UUID#toString()}
     * already produces it — the call is here so that a caller passing a string through
     * some other route cannot produce a second spelling of one creator's account.
     */
    public static LedgerAccount creator(UUID creatorId) {
        Objects.requireNonNull(creatorId, "A creator account names a creator");
        return new LedgerAccount(CREATOR_PREFIX + creatorId.toString().toLowerCase(Locale.ROOT));
    }

    /** Whether this is a creator's account rather than one of the five singletons. */
    public boolean isCreator() {
        return name.startsWith(CREATOR_PREFIX);
    }

    /**
     * Whose account this is, when it is a creator's.
     *
     * @throws IllegalStateException when it is not. Deliberately not an
     *     {@code Optional}: a caller asking this question already believes it is a
     *     creator's account, and a silently empty answer would be a payout attributed
     *     to nobody
     */
    public UUID creatorId() {
        if (!isCreator()) {
            throw new IllegalStateException(name + " is not a creator's account");
        }
        return UUID.fromString(name.substring(CREATOR_PREFIX.length()));
    }

    private static boolean isKnown(String candidate) {
        return switch (candidate) {
            case "escrow", "platform_fee", "psp_fee", "tax_payable", "refunds", "platform_expense" -> true;
            default -> CREATOR.matcher(candidate).matches();
        };
    }

    @Override
    public String toString() {
        return name;
    }
}
