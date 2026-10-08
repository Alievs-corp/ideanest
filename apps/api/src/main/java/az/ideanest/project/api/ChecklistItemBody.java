package az.ideanest.project.api;

import az.ideanest.project.domain.ChecklistItem;
import java.util.List;
import java.util.Locale;

/**
 * One checklist requirement, on the wire.
 *
 * @param requirement the stable name a client branches on — {@code COVER_IMAGE},
 *     {@code RISKS}. Never {@code label}, which is prose and may be reworded or
 *     localised at any time, exactly as §10.4 says of {@code detail}
 * @param label what the requirement is, in a creator's words and in the language
 *     the request's {@code Accept-Language} negotiated. Sent rather than left to the
 *     client so that a requirement added server-side appears in every client rather
 *     than rendering as an enum constant in the ones that have not shipped a
 *     translation for it
 * @param satisfied whether the campaign meets it now
 * @param section the editor route segment that fixes it — {@code basics},
 *     {@code rewards}, {@code story}. What makes each failing row a link
 * @param detail why it is not met, quoting the campaign's own numbers, in the same
 *     language as {@code label}. Absent when it is met; see {@link ChecklistItem}
 */
public record ChecklistItemBody(
        String requirement, String label, boolean satisfied, String section, String detail) {

    static ChecklistItemBody of(ChecklistItem item, ChecklistCopy copy, Locale locale) {
        return new ChecklistItemBody(
                item.requirement().name(),
                copy.label(item.requirement(), locale),
                item.satisfied(),
                item.requirement().section().key(),
                copy.detail(item, locale));
    }

    static List<ChecklistItemBody> of(List<ChecklistItem> items, ChecklistCopy copy, Locale locale) {
        return items.stream().map(item -> of(item, copy, locale)).toList();
    }
}
