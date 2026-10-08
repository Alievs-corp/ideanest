package az.ideanest.project.api;

import az.ideanest.project.application.CampaignReview;
import az.ideanest.project.domain.ChecklistResult;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * The campaign editor's review screen, as one response.
 *
 * <p><strong>Blocking and advisory are two lists, not one list with a flag.</strong>
 * A single array sorted by severity is one careless {@code .map} away from an
 * interface that renders "add a reward tier" in the same red as "a cover image is
 * required" — and a checklist that exaggerates is a checklist creators stop
 * reading, starting with the half that was true. Two arrays make presenting a
 * suggestion as a barrier a deliberate act rather than an oversight.
 *
 * <p><strong>The moderation outcome rides here.</strong> It is not a field of the
 * campaign, so it does not belong on {@code ProjectEdit} — which is also the
 * response to every autosave, and would then cost a query on
 * {@code project_state_transitions} several times a minute for a value only this
 * screen renders. An endpoint of its own would split a state and the note
 * explaining it across two requests that can disagree. This screen is the one
 * place both are read, and they are read together.
 *
 * @param submittable whether {@code POST /v1/projects/{id}/submit} would be
 *     accepted on completeness grounds. <strong>Not whether it would succeed</strong>:
 *     §6.1 also has to allow the edge, and a campaign already in {@code SUBMITTED}
 *     is complete and cannot be submitted again
 * @param score 0–100 across every requirement, blocking weighted twice advisory.
 *     See {@link ChecklistResult} for why it is not simply the blocking ones
 * @param moderation the last decision platform staff took, or absent if there has
 *     never been one
 */
public record ProjectChecklist(
        UUID projectId,
        String state,
        boolean submittable,
        int score,
        List<ChecklistItemBody> blocking,
        List<ChecklistItemBody> advisory,
        ModerationOutcomeBody moderation) {

    /**
     * @param copy resolves each row's {@code label} and {@code detail}
     * @param locale the language negotiated from the request's {@code Accept-Language}
     */
    static ProjectChecklist of(CampaignReview review, ChecklistCopy copy, Locale locale) {
        ChecklistResult checklist = review.checklist();
        return new ProjectChecklist(
                review.project().getId(),
                review.project().getState().name(),
                checklist.isSubmittable(),
                checklist.score(),
                ChecklistItemBody.of(checklist.blocking(), copy, locale),
                ChecklistItemBody.of(checklist.advisory(), copy, locale),
                ModerationOutcomeBody.of(review.moderation()));
    }
}
