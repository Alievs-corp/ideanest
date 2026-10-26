package az.ideanest.pledgemanager.api;

import az.ideanest.pledgemanager.application.SurveyDefinition;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;

/**
 * A survey as its creator is asking for it.
 *
 * <p>The whole thing, questions included — a question left out of the body is one they
 * deleted. Merging would leave a question on the form that the creator believes they
 * removed, and they would find out from the responses.
 *
 * <p>Used by both {@code POST} and {@code PUT}, because a survey is created and
 * rewritten with the same body: there is nothing a creation needs that an edit does
 * not, and two shapes would be two things to keep in step.
 *
 * @param respondBy PM-06's cut-off, or null for none — which is not "closed"
 */
public record SurveyRequest(
        String title, String message, Instant respondBy, @Size(max = 100) List<@Valid SurveyQuestionBody> questions) {

    public SurveyRequest {
        questions = questions == null ? List.of() : List.copyOf(questions);
    }

    public SurveyDefinition toDefinition() {
        return new SurveyDefinition(
                title,
                message,
                respondBy,
                questions.stream()
                        .map(question -> question == null ? null : question.toDefinition())
                        .toList());
    }
}
