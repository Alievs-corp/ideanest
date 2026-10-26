package az.ideanest.pledgemanager.api;

import az.ideanest.pledgemanager.application.QuestionDefinition;
import az.ideanest.pledgemanager.domain.SurveyQuestion;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

/**
 * One question, in a request and in a response — §4.8's PM-01 to PM-03.
 *
 * <p>{@code id} and {@code position} are <strong>read-only</strong>. A question has no
 * natural key, so rewriting a survey creates new rows — {@code SurveyService} argues
 * why that is safe and why matching by position would not be — and the order is the
 * order of the array. Accepting either field on the way in would be accepting something
 * the service does not read.
 *
 * <p><strong>Nulls are written out</strong>, as they are on every builder response: the
 * editor binds a control to every field, and an absent key cannot be told from one the
 * creator left empty.
 *
 * @param type {@code TEXT}, {@code CHOICE}, {@code MULTI_CHOICE}, {@code DATE} or
 *     {@code ADDRESS}
 * @param choices the options, for the two types that have them. Empty for the others,
 *     and giving options to a type that has none is refused rather than ignored
 * @param rewardTierId PM-02: null asks every backer, a tier asks only those who chose
 *     it
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record SurveyQuestionBody(
        UUID id,
        Integer position,
        String prompt,
        String helpText,
        String type,
        boolean required,
        @Size(max = 200) List<String> choices,
        UUID rewardTierId) {

    public SurveyQuestionBody {
        choices = choices == null ? List.of() : List.copyOf(choices);
    }

    public static SurveyQuestionBody of(SurveyQuestion question) {
        return new SurveyQuestionBody(
                question.getId(),
                question.getPosition(),
                question.getPrompt(),
                question.getHelpText(),
                question.getType().name(),
                question.isRequired(),
                question.getChoices(),
                question.getRewardTierId());
    }

    public QuestionDefinition toDefinition() {
        return new QuestionDefinition(prompt, helpText, type, required, choices, rewardTierId);
    }
}
