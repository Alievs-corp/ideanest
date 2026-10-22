package az.ideanest.discovery.api;

import az.ideanest.discovery.domain.CompletionBand;
import az.ideanest.discovery.domain.DiscoverySort;
import az.ideanest.discovery.domain.DiscoveryStatus;
import az.ideanest.discovery.domain.ShowOnly;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.media.ArraySchema;
import io.swagger.v3.oas.models.media.IntegerSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.parameters.Parameter;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.springdoc.core.customizers.OperationCustomizer;
import org.springframework.stereotype.Component;
import org.springframework.util.MultiValueMap;
import org.springframework.web.method.HandlerMethod;

/**
 * §4.3's filter vocabulary, in the published contract — #136.
 *
 * <p><strong>Without this the most important public endpoint on the platform is
 * undocumented.</strong> {@link DiscoveryController} and {@link SearchController} take
 * {@code @RequestParam MultiValueMap<String, String>} and hand it to
 * {@link DiscoveryQueryBinder}, which that class explains at length: the filter language has
 * repeated parameters, comma-separable values, and refusals that name the offending
 * parameter, none of which Spring's own binding produces. The cost is that a scanner
 * reflecting over the signature sees one parameter called {@code parameters} of a type
 * called {@code MultiValueMapStringString}, which is true of the Java and useless to
 * anybody generating a client.
 *
 * <p>So the vocabulary is written down once, here, beside the binder that reads it. The
 * alternative — twenty {@code @Parameter} annotations on each of three handler methods —
 * would be the same list three times, and the copies would drift the first time a filter was
 * added.
 *
 * <p><strong>The closed vocabularies come from the enums rather than from literals.</strong>
 * {@code status}, {@code completion}, {@code showOnly} and {@code sort} all have a
 * {@code wireValues()} that the binder already validates against, so the documented
 * enumeration and the accepted one cannot disagree — which is the failure this class would
 * otherwise be most likely to introduce. The open vocabularies ({@code category},
 * {@code tag}, {@code programme}) are deliberately not enumerated: they are content, and
 * {@code DiscoveryQueryBinder} explains why a link shared after a rename gets an empty feed
 * rather than a 400.
 *
 * <p>Registered by being a bean; springdoc applies every {@link OperationCustomizer} in the
 * context.
 */
@Component
public class DiscoveryQueryDocumentation implements OperationCustomizer {

    /** The name of the parameter the handlers actually declare, and the one this replaces. */
    private static final String REFLECTED = "parameters";

    /** The controllers whose query string is bound by hand. */
    private static final Set<Class<?>> BOUND_BY_HAND = Set.of(DiscoveryController.class, SearchController.class);

    @Override
    public Operation customize(Operation operation, HandlerMethod handlerMethod) {
        if (!BOUND_BY_HAND.contains(handlerMethod.getBeanType()) || !bindsTheWholeQueryString(handlerMethod)) {
            return operation;
        }

        List<Parameter> documented = new ArrayList<>();
        if (operation.getParameters() != null) {
            for (Parameter parameter : operation.getParameters()) {
                // Everything the scanner got right — Accept-Language, and any path variable
                // a future endpoint adds — is kept. Only the opaque map is replaced.
                if (!REFLECTED.equals(parameter.getName())) {
                    documented.add(parameter);
                }
            }
        }
        documented.addAll(filters());
        operation.setParameters(documented);
        return operation;
    }

    /**
     * Whether this handler is one that takes the raw query string.
     *
     * <p>Checked rather than assumed from the controller alone: both classes may grow an
     * endpoint that binds normally, and silently attaching twenty discovery filters to it
     * would be worse than the problem this class exists to fix.
     */
    private static boolean bindsTheWholeQueryString(HandlerMethod handlerMethod) {
        for (Class<?> parameterType : handlerMethod.getMethod().getParameterTypes()) {
            if (MultiValueMap.class.isAssignableFrom(parameterType)) {
                return true;
            }
        }
        return false;
    }

    /** §4.3's filters, in the order the binder reads them. */
    private static List<Parameter> filters() {
        return List.of(
                query("q", "Free text. §11.3 folds diacritics, so \"kitab\" matches \"kitаb\"."),
                repeated(
                        "status",
                        "Which of §6.1's states a campaign may be in. Repeat or comma-separate.",
                        DiscoveryStatus.wireValues()),
                repeated("category", "Category slugs. An open vocabulary: an unknown slug is an empty feed, not a"
                        + " 400, so a link shared after a rename still resolves."),
                repeated("subcategory", "Subcategory slugs, under the categories above."),
                repeated("tag", "Tag slugs."),
                repeated("programme", "Programme slugs — §4.3's editorial programmes."),
                repeated(
                        "completion",
                        "How close to its goal a campaign is.",
                        CompletionBand.wireValues()),
                query("goalBand", "A named goal range, as an alternative to goalMin and goalMax."),
                query("goalMin", "Lowest goal, as a decimal string. Money is never a query number either."),
                query("goalMax", "Highest goal, as a decimal string."),
                query("raisedBand", "A named raised range, as an alternative to raisedMin and raisedMax."),
                query("raisedMin", "Least raised, as a decimal string."),
                query("raisedMax", "Most raised, as a decimal string."),
                repeated("country", "ISO country codes of where a campaign is located."),
                query("market", "The country the reader browses for (#533): only campaigns whose countries"
                        + " contain this ISO 3166-1 alpha-2 code. Absent is every country; anything that is not"
                        + " a country is refused."),
                repeated("city", "City slugs."),
                query("near", "A point, as \"lat,lon\". Required when sort=near-me, which is why asking for that"
                        + " sort without it is refused rather than silently answered as newest."),
                query("radiusKm", "How far from `near` to look."),
                repeated(
                        "showOnly",
                        "Editorial and campaign qualifiers.",
                        ShowOnly.wireValues()),
                enumeration("sort", "Ordering. §11.2 decides what each one means.", DiscoverySort.wireValues()),
                // The one filter that is not a string on the wire. Everything else here is
                // either free text, a slug, or a decimal amount — and an amount stays a
                // string for §10.3's reason, even in a query string, because the moment it
                // is an OpenAPI `number` a generated client will format it as a double.
                new Parameter()
                        .in("query")
                        .name("limit")
                        .required(false)
                        .description("Page size. Bounded by the service; an out-of-range value is refused rather"
                                + " than clamped, so a client learns its request was not the one answered.")
                        .schema(new IntegerSchema()),
                query("cursor", "The `nextCursor` from the previous page. §10.3's cursor pagination: opaque, and"
                        + " never an offset."));
    }

    private static Parameter query(String name, String description) {
        return new Parameter()
                .in("query")
                .name(name)
                .required(false)
                .description(description)
                .schema(new StringSchema());
    }

    private static Parameter enumeration(String name, String description, List<String> values) {
        StringSchema schema = new StringSchema();
        values.forEach(schema::addEnumItemObject);
        return new Parameter()
                .in("query")
                .name(name)
                .required(false)
                .description(description)
                .schema(schema);
    }

    private static Parameter repeated(String name, String description) {
        return repeated(name, description, null);
    }

    /**
     * A filter that may appear more than once.
     *
     * <p>Documented as an array with {@code explode}, which is OpenAPI's spelling of
     * {@code ?tag=a&tag=b} — what {@code DiscoveryQueryBinder} reads. The comma-separated
     * form it also accepts is not a second schema: a generated client should emit one of the
     * two, and the repeated form is the one that survives a value containing a comma.
     */
    private static Parameter repeated(String name, String description, List<String> values) {
        StringSchema item = new StringSchema();
        if (values != null) {
            values.forEach(item::addEnumItemObject);
        }
        Schema<?> array = new ArraySchema().items(item);
        return new Parameter()
                .in("query")
                .name(name)
                .required(false)
                .description(description)
                .explode(true)
                .schema(array);
    }
}
