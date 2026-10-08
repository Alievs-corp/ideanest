package az.ideanest.project.domain;

import java.util.List;
import java.util.Objects;

/**
 * Why a requirement is not met, as a reason and the campaign's own numbers -- never as prose.
 *
 * <p><strong>The domain decides what is wrong; the boundary decides how to say it.</strong>
 * {@link SubmissionChecklist} used to build an English sentence here, and every client rendered
 * it verbatim, so a creator reading the editor in Azerbaijani was told about their campaign in
 * English. The sentence is now resolved at the API boundary against the reader's
 * {@code Accept-Language}, from {@code messages*.properties} under
 * {@code checklist.<REQUIREMENT>.<reason>}, and this record carries only what that resolution
 * needs: which of the requirement's failure modes this is, and the facts to quote.
 *
 * <p>The facts are still this campaign's -- "the story is 140 characters; at least 500 are
 * needed" rather than "the story is too short" -- which is why they travel with the reason
 * rather than being looked up later.
 *
 * <p><strong>The arguments are already in their final shape where shape is not a matter of
 * language.</strong> Counts are integers, so a translation can choose a plural form. An amount
 * of money is a string, formatted here exactly as it always was ({@code "250 AZN"}): money
 * never passes through a locale's number format, which would round it to the format's own
 * precision. A cover's dimensions are a string ({@code "800×450"}) because a number format
 * would print the width as {@code 1,024} in English.
 *
 * @param reason which failure of the requirement this is -- {@code missing},
 *     {@code tooShort}. The last segment of the message key
 * @param arguments the positional arguments of that message, in the order its pattern
 *     numbers them
 */
public record ChecklistDetail(String reason, List<Object> arguments) {

    // The reasons, named once. Each requirement uses the few that apply to it, and the
    // message key is checklist.<REQUIREMENT>.<reason> -- ChecklistCopyTests renders every
    // pair SubmissionChecklist can produce, in every language.

    /** Nothing has been entered. */
    public static final String MISSING = "missing";

    /** Longer than the limit. Arguments: the length, the limit. */
    public static final String TOO_LONG = "tooLong";

    /** Shorter than the minimum. Arguments: the length, the minimum. */
    public static final String TOO_SHORT = "tooShort";

    /** An image below the recommended size. Arguments: its size, the recommended size. */
    public static final String TOO_SMALL = "tooSmall";

    /** An amount below a floor. Arguments depend on the requirement. */
    public static final String BELOW_MINIMUM = "belowMinimum";

    /** An amount above a ceiling. Arguments: the amount, the ceiling. */
    public static final String ABOVE_MAXIMUM = "aboveMaximum";

    /** A number outside a range. Arguments: the number, the bottom, the top. */
    public static final String OUT_OF_RANGE = "outOfRange";

    /** More of something than is allowed. Arguments: the count, the limit. */
    public static final String TOO_MANY = "tooMany";

    public ChecklistDetail {
        Objects.requireNonNull(reason, "A detail names its reason");
        if (reason.isBlank()) {
            throw new IllegalArgumentException("A detail names its reason");
        }
        // List.copyOf refuses a null element, which is the point: a null argument renders as
        // the word "null" in the middle of a sentence a creator reads.
        arguments = List.copyOf(arguments);
    }

    public static ChecklistDetail of(String reason, Object... arguments) {
        return new ChecklistDetail(reason, List.of(arguments));
    }
}
