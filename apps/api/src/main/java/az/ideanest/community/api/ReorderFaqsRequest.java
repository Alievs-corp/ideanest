package az.ideanest.community.api;

import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

/**
 * The campaign's FAQ entries, in the order the creator dragged them into.
 *
 * <p><strong>Every entry, exactly once.</strong> A list that omits one is refused with
 * {@code FAQ_ORDER_INCOMPLETE} rather than applied to the entries it does mention — see
 * {@code FaqOrderIncompleteException}. Sending the whole list costs the client nothing,
 * because the whole list is what the creator was dragging.
 *
 * <p>No bean validation. {@code @NotEmpty} would refuse an empty body, and an empty body
 * is the correct request for a campaign with no entries; the service compares the list
 * against what exists and produces a message naming the identifiers that are the problem,
 * which is what a stale client needs to hear.
 */
public record ReorderFaqsRequest(@Size(max = 200) List<UUID> faqIds) {

    public ReorderFaqsRequest {
        faqIds = faqIds == null ? List.of() : faqIds;
    }
}
