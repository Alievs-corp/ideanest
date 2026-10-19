package az.ideanest.project.application;

import az.ideanest.shared.ReaderLocale;
import az.ideanest.project.domain.Category;
import az.ideanest.project.domain.CategoryTranslation;
import az.ideanest.project.domain.Subcategory;
import az.ideanest.project.domain.SubcategoryTranslation;
import az.ideanest.project.infrastructure.CategoryRepository;
import az.ideanest.project.infrastructure.CategoryTranslationRepository;
import az.ideanest.project.infrastructure.SubcategoryRepository;
import az.ideanest.project.infrastructure.SubcategoryTranslationRepository;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The category tree, read whole and read in a language.
 *
 * <p>The editor cannot ask a creator to choose a category without being able to
 * list them, and {@code PATCH /v1/projects/{id}} validates {@code categoryId}
 * against these rows — so the endpoint that publishes them belongs with the
 * migration that seeds them. §10.2 files {@code GET /v1/categories} under
 * discovery, which is where the faceted version of this will live.
 *
 * <p><strong>Localisation is this class's job now.</strong> It used to return
 * {@code nameAz} and {@code nameEn} and leave the choice to a caller, on the
 * grounds that honouring {@code Accept-Language} was a policy for the whole API.
 * V11 made that untenable: §21.1 names four languages and the taxonomy holds a
 * row per language, so "return every column and let the client pick" would mean
 * shipping four names to render one. The names map is still returned — a client
 * that renders its own language switcher without a second request needs it — but
 * {@code name} is resolved here.
 *
 * <p><strong>The fallback chain is explicit, and it is three steps.</strong>
 *
 * <ol>
 *   <li>the requested locale, when a row exists for it;
 *   <li>{@code az}, which §21.1 makes the primary language and which V11's seed
 *       writes for every taxon;
 *   <li>the slug.
 * </ol>
 *
 * <p>The last step is not decoration. No constraint can require that an
 * {@code az} row exists — "at least one row of a given locale" is a statement
 * about sibling rows — so a taxon added by hand without one is possible, and the
 * difference between degrading to a readable handle and degrading to an empty
 * {@code <option>} in the campaign editor is whether the creator can tell what
 * they are choosing.
 */
@Service
public class Taxonomy {

    /**
     * §21.1. Azerbaijani is the primary language, which is what makes it the
     * fallback rather than English.
     */
    public static final String PRIMARY_LOCALE = ReaderLocale.PRIMARY;

    /**
     * The four codes of §21.1, in phase order, and the same set the database
     * checks. Content negotiation matches against this list, so a request for a
     * language the platform does not ship resolves to the primary one rather
     * than to a locale nothing will ever have rows for.
     */
    public static final List<String> SUPPORTED_LOCALES = ReaderLocale.SUPPORTED;

    /**
     * @param name resolved against the requested locale, never null
     * @param names every language this category has a row for, keyed by code.
     *     Absent languages are absent rather than null-valued: a key present with
     *     no name is a shape a client has to defend against for no gain
     * @param nameAz INTERIM. See {@code CategoryController}
     * @param nameEn INTERIM
     * @param subcategories in display order, possibly empty
     */
    public record TaxonomyCategory(
            UUID id,
            String slug,
            String name,
            Map<String, String> names,
            String nameAz,
            String nameEn,
            List<TaxonomySubcategory> subcategories) {
    }

    public record TaxonomySubcategory(
            UUID id, String slug, String name, Map<String, String> names, String nameAz, String nameEn) {
    }

    private final CategoryRepository categories;
    private final SubcategoryRepository subcategories;
    private final CategoryTranslationRepository categoryTranslations;
    private final SubcategoryTranslationRepository subcategoryTranslations;

    public Taxonomy(
            CategoryRepository categories,
            SubcategoryRepository subcategories,
            CategoryTranslationRepository categoryTranslations,
            SubcategoryTranslationRepository subcategoryTranslations) {
        this.categories = categories;
        this.subcategories = subcategories;
        this.categoryTranslations = categoryTranslations;
        this.subcategoryTranslations = subcategoryTranslations;
    }

    /**
     * The language to answer in, from an {@code Accept-Language} header. {@link
     * ReaderLocale#fromAcceptLanguage} has the rules; the plan catalogue negotiates the same way.
     *
     * @return one of {@link #SUPPORTED_LOCALES}, never null
     */
    public static String localeFor(String acceptLanguage) {
        return ReaderLocale.fromAcceptLanguage(acceptLanguage);
    }

    /**
     * One name, chosen by the chain the class comment sets out.
     *
     * <p>Written as three statements rather than as a chain of {@code orElse}
     * calls inside a stream, because each step is a separate decision with a
     * separate reason and a reader has to be able to see which one produced the
     * name they are looking at.
     *
     * @param names the taxon's translations, keyed by locale code
     * @param locale the requested code, already negotiated by {@link #localeFor}
     * @param slug the last resort, and the reason this never returns null
     */
    public static String resolveName(Map<String, String> names, String locale, String slug) {
        String requested = names.get(locale);
        if (requested != null) {
            return requested;
        }
        String primary = names.get(PRIMARY_LOCALE);
        if (primary != null) {
            return primary;
        }
        return slug;
    }

    /**
     * Every category with its children, in the platform's display order, named in
     * the requested language.
     *
     * <p>Four queries rather than one per category and one per name. The tree is
     * small and static, but an N+1 over a list that every editor session and every
     * discovery page loads is the query pattern that is only noticed once there
     * are enough sessions for it to matter.
     *
     * @param locale one of {@link #SUPPORTED_LOCALES}; see {@link #localeFor}
     */
    @Transactional(readOnly = true)
    public List<TaxonomyCategory> all(String locale) {
        Map<UUID, Map<String, String>> categoryNames = new LinkedHashMap<>();
        for (CategoryTranslation translation : categoryTranslations.findAllByOrderByIdCategoryIdAscIdLocaleAsc()) {
            categoryNames
                    .computeIfAbsent(translation.getCategoryId(), key -> new LinkedHashMap<>())
                    .put(translation.getLocale(), translation.getName());
        }

        Map<UUID, Map<String, String>> subcategoryNames = new LinkedHashMap<>();
        for (SubcategoryTranslation translation :
                subcategoryTranslations.findAllByOrderByIdSubcategoryIdAscIdLocaleAsc()) {
            subcategoryNames
                    .computeIfAbsent(translation.getSubcategoryId(), key -> new LinkedHashMap<>())
                    .put(translation.getLocale(), translation.getName());
        }

        Map<UUID, List<TaxonomySubcategory>> children = new LinkedHashMap<>();
        for (Subcategory subcategory : subcategories.findAllByOrderBySortOrderAsc()) {
            Map<String, String> names = inLocaleOrder(subcategoryNames.get(subcategory.getId()));
            children.computeIfAbsent(subcategory.getParentId(), key -> new ArrayList<>())
                    .add(new TaxonomySubcategory(
                            subcategory.getId(),
                            subcategory.getSlug(),
                            resolveName(names, locale, subcategory.getSlug()),
                            names,
                            subcategory.getNameAz(),
                            subcategory.getNameEn()));
        }

        List<TaxonomyCategory> tree = new ArrayList<>();
        for (Category category : categories.findAllByOrderBySortOrderAsc()) {
            Map<String, String> names = inLocaleOrder(categoryNames.get(category.getId()));
            tree.add(new TaxonomyCategory(
                    category.getId(),
                    category.getSlug(),
                    resolveName(names, locale, category.getSlug()),
                    names,
                    category.getNameAz(),
                    category.getNameEn(),
                    List.copyOf(children.getOrDefault(category.getId(), List.of()))));
        }
        return List.copyOf(tree);
    }

    /**
     * The translations a taxon has, in the order {@link #SUPPORTED_LOCALES} lists
     * them, and immutable.
     *
     * <p>Ordered rather than {@code Map.copyOf}, which would do the job just as
     * well for lookups: the immutable maps are salted per JVM run, so two
     * instances of the service — and the same instance after a restart — would
     * serialise the same tree with the keys in different orders. The ETag over it
     * is a digest of what is serialised, and a response body that differs between
     * replicas for no reason is a cache that revalidates to a 200 every time.
     */
    private static Map<String, String> inLocaleOrder(Map<String, String> names) {
        if (names == null) {
            return Map.of();
        }
        Map<String, String> ordered = new LinkedHashMap<>();
        for (String locale : SUPPORTED_LOCALES) {
            String name = names.get(locale);
            if (name != null) {
                ordered.put(locale, name);
            }
        }
        return Collections.unmodifiableMap(ordered);
    }
}
