/**
 * §4.3's taxonomy, as `GET /v1/categories` sends it — `CategoryController.CategoryResponse` —
 * and the browse URLs built from it (§4.13 WS-05).
 *
 * Moved here from `apps/web/src/lib/categories/api.ts` for the app's category screens (#154):
 * the slug a landing page resolves, the parent a subcategory is looked up under and the address
 * a category link opens are the same answers on a phone as in a browser, and two copies of
 * "which subcategory does `/categories/games/prints` mean" would be two answers to that
 * question. The reads stay in each application, because how a request is sent is the part that
 * is genuinely different.
 *
 * <h2>The taxonomy is data, and this module treats it as data</h2>
 *
 * §4.3 is explicit that the fifteen categories and their hundred-odd subcategories must be
 * editable without a deployment. So there is no list of names here and no `CATEGORIES` constant
 * anywhere: the browse screens read the tree when they open, and a category added by an
 * administrator has a landing page without anybody shipping one.
 *
 * <h2>`name`, and not `nameAz` or `nameEn`</h2>
 *
 * The controller resolves the reader's language and puts the answer in `name` — resolved
 * locale, then Azerbaijani, then the slug. The other fields are interim and the controller says
 * so. A client that picked one of them would be choosing a language on the reader's behalf.
 */

export interface Subcategory {
  readonly id: string;
  readonly slug: string;
  /** In the reader's language, already resolved by the service. */
  readonly name: string;
}

export interface Category extends Subcategory {
  /**
   * Nested rather than a second request, and the controller explains why: a dependent list
   * that waits for a round trip to populate is a list that appears empty for a moment.
   */
  readonly subcategories: readonly Subcategory[];
}

/** A category as the wire really is: every field optional, because nulls are omitted. */
export interface WireCategory {
  readonly id?: string | null;
  readonly slug?: string | null;
  readonly name?: string | null;
  readonly subcategories?: readonly WireSubcategory[] | null;
}

export interface WireSubcategory {
  readonly id?: string | null;
  readonly slug?: string | null;
  readonly name?: string | null;
}

/**
 * The tree, narrowed to what a screen renders.
 *
 * A missing name falls back to the slug: a category without a translation still has an address
 * and a page worth reaching, which is the web's `fetchCategories` reading.
 */
export function taxonomyFrom(raw: readonly WireCategory[]): readonly Category[] {
  return raw.map((category) => ({
    id: category.id ?? '',
    slug: category.slug ?? '',
    name: category.name ?? category.slug ?? '',
    subcategories: (category.subcategories ?? []).map((subcategory) => ({
      id: subcategory.id ?? '',
      slug: subcategory.slug ?? '',
      name: subcategory.name ?? subcategory.slug ?? '',
    })),
  }));
}

/* -------------------------------------------------------------------------
 * The browse URLs — §4.13 WS-05
 * ---------------------------------------------------------------------- */

/** The index every category landing page hangs from. */
export const CATEGORIES_PATH = '/categories';

/**
 * A category's landing page.
 *
 * `/categories/{slug}` rather than `/discover?category={slug}`, and that is the whole point of
 * WS-05: a crawler cannot operate a filter. The app opens the same path, so a link shared from
 * either lands on the same page.
 *
 * Slugs are lower case throughout the schema and the service folds them, but they are still
 * encoded: a slug is data, and a taxonomy editable without a deployment is a taxonomy that can
 * acquire a character somebody did not expect.
 */
export function categoryPath(slug: string): string {
  return `${CATEGORIES_PATH}/${encodeURIComponent(slug)}`;
}

export function subcategoryPath(categorySlug: string, subcategorySlug: string): string {
  return `${categoryPath(categorySlug)}/${encodeURIComponent(subcategorySlug)}`;
}

/* -------------------------------------------------------------------------
 * Reading the tree
 * ---------------------------------------------------------------------- */

/** The category with this slug, or `null`. Case-insensitive, as the service is. */
export function findCategory(tree: readonly Category[], slug: string): Category | null {
  const wanted = slug.toLowerCase();
  return tree.find((category) => category.slug.toLowerCase() === wanted) ?? null;
}

/**
 * A subcategory within its own parent, or `null`.
 *
 * SCOPED TO THE PARENT, never searched across the tree. A subcategory slug is only unique within
 * its category, so a global lookup would answer `/categories/games/prints` with the Crafts
 * subcategory and render a page whose breadcrumb contradicts its own URL.
 */
export function findSubcategory(category: Category, slug: string): Subcategory | null {
  const wanted = slug.toLowerCase();
  return category.subcategories.find((entry) => entry.slug.toLowerCase() === wanted) ?? null;
}
