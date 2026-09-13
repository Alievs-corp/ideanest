/**
 * Browsing, faceted filtering, search, ranking, and curation.
 *
 * <p>What is here today is the query API of #42: {@code GET /v1/discover} and
 * {@code GET /v1/discover/facets}, behind {@code application.SearchService}.
 * Full-text search (#43), relevance ranking (#44), autocomplete (#46), proximity
 * (#47), and collections (#48) all extend this rather than replacing it.
 *
 * <p><strong>The seam is {@code SearchService}.</strong> §11.1 puts the platform
 * on PostgreSQL until roughly ten thousand campaigns and on a dedicated engine
 * after that, "behind a {@code SearchService} interface so the migration is a
 * substitution rather than a rewrite". Nothing in the interface names SQL, JDBC,
 * or Spring Data, so a second implementation is a new class in
 * {@code infrastructure} and a bean definition, not an edit to a caller.
 *
 * <p><strong>This module reads {@code projects} with its own SQL.</strong> It does
 * not go through {@code project.infrastructure.ProjectRepository}, and
 * {@code ModuleBoundaryTests} is what forbids it: a module reaches another module
 * through its {@code application} layer only. That constraint happens to agree with
 * what a search read model wants anyway — a hundred cards per page loaded as
 * entities, each with its lazy associations, is the query pattern §20 cannot afford
 * at a thousand requests a second. The consequence is that campaign states appear
 * here as strings rather than as {@code project.domain.ProjectState}; the agreement
 * between the two is pinned by {@code DiscoveryStatusTests}, which may import both.
 *
 * <p><strong>Only campaigns the public may see are ever returned.</strong>
 * {@link az.ideanest.discovery.domain.DiscoveryStatus#LISTED_STATES} is applied to
 * every query this module issues, before any filter the caller sent. A filter can
 * narrow that set and can never widen it.
 */
package az.ideanest.discovery;
