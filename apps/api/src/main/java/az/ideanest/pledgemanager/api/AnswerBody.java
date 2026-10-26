package az.ideanest.pledgemanager.api;

import az.ideanest.pledgemanager.domain.SurveyAnswer;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

/**
 * One answer, in a submission and in a response.
 *
 * <p>Always an array, whatever the question's type — the shape {@code SurveyAnswer}
 * argues for, carried unchanged to the wire so that a client has one branch rather than
 * five. A single-choice answer is a one-element array.
 *
 * <p>The values are the option text a backer was shown, not indices into the question's
 * option list. An index would break the moment a creator reordered the options, and it
 * would break silently.
 */
public record AnswerBody(UUID questionId, @Size(max = 200) List<String> value) {

    public AnswerBody {
        value = value == null ? List.of() : List.copyOf(value);
    }

    public static AnswerBody of(SurveyAnswer answer) {
        return new AnswerBody(answer.getQuestionId(), answer.getValue());
    }
}
