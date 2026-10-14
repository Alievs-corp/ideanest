package az.ideanest.community.api;

import az.ideanest.community.domain.ProjectFaq;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.UUID;

/**
 * One question and its answer, as the FAQ tab and the campaign editor read it.
 *
 * <p><strong>It carries an identifier.</strong> An FAQ entry is addressed directly by
 * {@code PATCH /v1/faqs/{id}} and {@code DELETE /v1/faqs/{id}}, and it is what a reorder
 * body is a list of. It is on the public projection as well as the creator's because
 * they are one endpoint — and because an identifier is what a tab uses to key a list it
 * expands and collapses.
 *
 * <p><strong>No position.</strong> The list arrives in the creator's order and that
 * <em>is</em> the order; a number beside each entry would be a second statement of it,
 * and the two would disagree the first time an entry was deleted and the gap left behind
 * — which {@code ProjectFaqService#remove} deliberately does.
 *
 * <p><strong>No timestamps.</strong> §4.4 asks for a question and answer list and
 * nothing about when it was written, and "updated 3 days ago" beside an FAQ entry says
 * something about the creator's diligence that the platform has not decided to say.
 * Adding them later is additive; taking them off a page once backers have read them is
 * not.
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record ProjectFaqResponse(UUID id, String question, String answer) {

    public static ProjectFaqResponse of(ProjectFaq faq) {
        return new ProjectFaqResponse(faq.getId(), faq.getQuestion(), faq.getAnswer());
    }
}
