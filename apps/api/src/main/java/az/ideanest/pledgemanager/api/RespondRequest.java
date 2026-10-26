package az.ideanest.pledgemanager.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * A backer's answers to one survey — §4.8's PM-05.
 *
 * <p>The whole set, not a patch: a survey is a form and it is submitted as one. A
 * partial submission would leave the creator unable to tell "they left it blank" from
 * "the client did not send that field", which is exactly the distinction a required
 * question exists to draw.
 *
 * <p><strong>{@code pledgeId} is in the body rather than the path</strong>, and it has
 * to be somewhere: what a backer is asked depends on the tier their pledge names
 * (PM-02), and one account can hold pledges on several campaigns. It cannot be inferred
 * from the survey alone. The server still checks that the pledge is the caller's — the
 * field says <em>which</em> of their pledges, never <em>whose</em>.
 *
 * @param answers a question may appear once. A second entry for the same question is
 *     refused rather than resolved by order, because either resolution is a guess about
 *     what somebody meant to manufacture
 */
public record RespondRequest(UUID pledgeId, @Size(max = 100) List<@Valid AnswerBody> answers) {

    public RespondRequest {
        answers = answers == null ? List.of() : List.copyOf(answers);
    }

    /**
     * By question.
     *
     * @throws IllegalArgumentException when a question is answered twice, which the
     *     handler turns into a 400 rather than letting the later entry win silently
     */
    public Map<UUID, List<String>> byQuestion() {
        Map<UUID, List<String>> submitted = new LinkedHashMap<>();
        for (AnswerBody answer : answers) {
            if (answer == null || answer.questionId() == null) {
                throw new IllegalArgumentException("Each answer names the question it answers.");
            }
            if (submitted.putIfAbsent(answer.questionId(), answer.value()) != null) {
                throw new IllegalArgumentException(
                        "Question " + answer.questionId() + " is answered twice in this submission.");
            }
        }
        return submitted;
    }
}
