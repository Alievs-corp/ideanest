package az.ideanest.notification.api;

import az.ideanest.notification.domain.EmailTemplateVersion;
import az.ideanest.notification.domain.NotificationCategory;
import az.ideanest.notification.domain.NotificationType;
import java.util.List;
import java.util.Map;

/**
 * The templates there are, for AD-15's list.
 *
 * <p>Each carries what a screen listing them needs: the identifier the preview endpoint takes,
 * the category it groups under, and which languages somebody has rewritten it in. The subject
 * is deliberately not here — it depends on the sample document, so putting it in a list would
 * mean rendering twenty templates to answer one request.
 *
 * @param templates in {@link NotificationType} declaration order, which is §4.10's table
 *     order. A list rather than a map, so the order is part of the response rather than
 *     something a client has to reconstruct
 */
public record EmailTemplateListResponse(List<Template> templates) {

    public static EmailTemplateListResponse of(
            List<NotificationType> types, Map<String, List<EmailTemplateVersion>> live) {
        return new EmailTemplateListResponse(types.stream()
                .map(type -> Template.of(type, live.getOrDefault(type.name(), List.of())))
                .toList());
    }

    /**
     * @param type the wire name, which is the enum constant — the same string
     *     {@code notifications.type} stores and the preview path takes
     * @param category which of §4.10's groupings it falls under
     * @param mandatory whether a recipient may switch it off. True only for
     *     {@code SECURITY}: the person who would want a sign-in alert silenced is the one
     *     who stole the account
     * @param overrides the languages this template has been rewritten in, with the version
     *     that is live in each, in locale order. Empty when every language sends the shipped
     *     copy — which is the question an administrator arrives at the list with
     */
    public record Template(String type, String category, boolean mandatory, List<LanguageOverride> overrides) {

        static Template of(NotificationType type, List<EmailTemplateVersion> live) {
            NotificationCategory category = type.category();
            return new Template(
                    type.name(),
                    category.name(),
                    category.isMandatory(),
                    live.stream().map(version -> new LanguageOverride(version.locale(), version.version())).toList());
        }
    }

    /** One language's live override. */
    public record LanguageOverride(String locale, int liveVersion) {
    }
}
