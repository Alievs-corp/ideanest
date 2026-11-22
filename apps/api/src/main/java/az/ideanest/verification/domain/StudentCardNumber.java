package az.ideanest.verification.domain;

import java.util.Locale;
import java.util.Optional;

/**
 * A student card number as the one-card-one-account rule compares it — #655.
 *
 * <p>Upper case, letters and digits only: {@code "ab-12 345"}, {@code "AB 12345"} and
 * {@code "AB12345"} are one card. People type a card number the way it is printed, with or
 * without its spaces and dashes, and a rule that two typings defeat is not a rule.
 *
 * <p>What counts as a letter is {@link Character#isLetterOrDigit}'s answer, not ASCII's, so an
 * institution that prints {@code Ə} on its cards keeps it.
 */
public final class StudentCardNumber {

    /** What the creator may type, before normalising — #655's contract. */
    public static final int TYPED_MIN = 3;

    public static final int TYPED_MAX = 40;

    /** What is stored, after normalising. V127's check holds it too. */
    public static final int NORMALISED_MIN = 3;

    public static final int NORMALISED_MAX = 40;

    private StudentCardNumber() {}

    /**
     * The card number as compared and stored, or empty when what was typed is not one: blank,
     * shorter than three or longer than forty characters as typed, or fewer than three letters
     * and digits once the rest is taken away.
     */
    public static Optional<String> normalise(String typed) {
        if (typed == null) {
            return Optional.empty();
        }
        String trimmed = typed.strip();
        if (trimmed.length() < TYPED_MIN || trimmed.length() > TYPED_MAX) {
            return Optional.empty();
        }
        StringBuilder kept = new StringBuilder(trimmed.length());
        trimmed.toUpperCase(Locale.ROOT).codePoints()
                .filter(Character::isLetterOrDigit)
                .forEach(kept::appendCodePoint);
        String normalised = kept.toString();
        if (normalised.length() < NORMALISED_MIN || normalised.length() > NORMALISED_MAX) {
            return Optional.empty();
        }
        return Optional.of(normalised);
    }
}
