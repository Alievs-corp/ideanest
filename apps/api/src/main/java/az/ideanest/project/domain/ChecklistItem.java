package az.ideanest.project.domain;

import java.util.Objects;

/**
 * One requirement, and how this campaign stands against it.
 *
 * @param requirement which rule this is. Carries its own severity and the editor
 *     section that fixes it, so nothing downstream has to decide either
 * @param satisfied whether the campaign meets it right now
 * @param detail why it is not met, as a reason and the campaign's own numbers, and
 *     <strong>null when it is</strong>. Not "Done": a satisfied requirement has
 *     nothing to say that its label does not already say, and inventing prose for
 *     it would give a client two strings to render where one carries the meaning.
 *     The detail quotes the campaign's own numbers — "The story is 140 characters;
 *     at least 500 are needed" — because "the story is too short" is a restatement
 *     of the rule rather than a report about this campaign. It is not the sentence
 *     itself: see {@link ChecklistDetail} for where that is written, and in which
 *     language
 */
public record ChecklistItem(ChecklistRequirement requirement, boolean satisfied, ChecklistDetail detail) {

    public ChecklistItem {
        Objects.requireNonNull(requirement, "A checklist item is about a requirement");
        if (satisfied && detail != null) {
            // A detail on a satisfied item is a message that will be rendered
            // beside a tick, which reads as a complaint about something that is
            // fine. Refused here rather than left to review.
            throw new IllegalArgumentException("A satisfied requirement has nothing to explain");
        }
        if (!satisfied && detail == null) {
            // The opposite failure, and the worse one: a checklist row that says
            // "not done" and nothing else sends the creator to guess.
            throw new IllegalArgumentException("An unmet requirement has to say what is wrong");
        }
    }

    /** Met. */
    public static ChecklistItem met(ChecklistRequirement requirement) {
        return new ChecklistItem(requirement, true, null);
    }

    /** Unmet, with the reason the creator is shown and the facts it quotes. */
    public static ChecklistItem unmet(ChecklistRequirement requirement, String reason, Object... arguments) {
        return new ChecklistItem(requirement, false, ChecklistDetail.of(reason, arguments));
    }

    /**
     * Met or unmet, from a condition.
     *
     * <p>The form every rule in {@link SubmissionChecklist} is written in, so that
     * a rule is one line and the table of them can be read as a table. The
     * arguments are computed whether or not they are used, which is a handful of
     * values per requirement per evaluation and is not worth deferring behind a
     * supplier.
     */
    public static ChecklistItem of(
            ChecklistRequirement requirement, boolean satisfied, String reason, Object... arguments) {
        return satisfied ? met(requirement) : unmet(requirement, reason, arguments);
    }

    public boolean isBlocking() {
        return requirement.isBlocking();
    }

    /** Unmet and blocking: one of the things that refuses a submission. */
    public boolean refusesSubmission() {
        return !satisfied && requirement.isBlocking();
    }
}
