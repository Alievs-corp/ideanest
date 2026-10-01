/**
 * §4.3's taxonomy, as `GET /v1/categories` sends it — `CategoryController.CategoryResponse` —
 * and the browse URLs built from it (§4.13 WS-05).
 *
 * The shapes, the paths and the slug lookups live in `@ideanest/discovery/taxonomy` since the
 * app's category screens (#154) needed the same answers: which subcategory
 * `/categories/games/prints` means has to be the same in a browser and on a phone. This module
 * re-exports them under the names the web has always imported, and the read itself stays in
 * `lib/api/server.ts`.
 */

export {
  CATEGORIES_PATH,
  categoryPath,
  findCategory,
  findSubcategory,
  subcategoryPath,
  taxonomyFrom,
  type Category,
  type Subcategory,
  type WireCategory,
  type WireSubcategory,
} from '@ideanest/discovery/taxonomy';
