# `@ideanest/discovery`

The discovery feed's logic: the filter state and the query string it is written
to, the closed vocabularies the service accepts, the custom money range check,
the facet shapes, and which filter emptied the feed — one implementation, for
`apps/web` and `apps/mobile`.

```ts
import { parseFilters, toSearchParams, withQuery } from '@ideanest/discovery/filters';
import { sortsFor } from '@ideanest/discovery/vocabulary';

const filters = withQuery(parseFilters(new URLSearchParams('category=games')), 'lamp');
toSearchParams(filters).toString(); // 'q=lamp&category=games' (best match is the default with a query)
sortsFor(filters.query !== '');     // best_match first
```

## Why this is a package

It used to be `apps/web/src/lib/discovery/{filters,vocabulary,bounds,emptiness}.ts`.
It moved when the app's Discover screen (#153) needed the same feed: a link
`/discover?category=games&sort=ending_soon` has to open the same campaigns in a
browser and on a phone, "Clear all filters" has to keep the same things, and the
chip a reader removes has to remove the same filter. Two copies would agree on
every case somebody tested by hand and drift on the rest. CLAUDE.md §3: shared
logic is never duplicated.

The fetches are **not** here. The web sends them with `publicFetch` and the app
with the typed `@ideanest/api-client`; how a request is sent is the one part
that genuinely differs.

## Modules

| Import | Holds |
|---|---|
| `@ideanest/discovery/vocabulary` | The closed vocabularies, copied from `az.ideanest.discovery.domain`, and `sortsFor` |
| `@ideanest/discovery/filters` | `DiscoveryFilters`, `searchParamsFrom`, `parseFilters` / `toSearchParams` / `toHref`, the toggles, `withQuery`, `clearFilters`, `addSlugFilter`, `activeFilters`, `removeFilter` |
| `@ideanest/discovery/bounds` | `isValidBound` and `boundsAreOrdered`, with `decimal.js` and never `Number()` |
| `@ideanest/discovery/facets` | The facet response, `PAGE_SIZE` (24), `countOf`, `slugNames` |
| `@ideanest/discovery/emptiness` | `blameFor`: which applied filters emptied the feed |
| `@ideanest/discovery/copy` | `FilterVocabularyCopy` and the builder both translators call |

There is no barrel. Each module is imported by its own path, so a screen that
needs `sortsFor` does not pull the filter parser into its bundle.

## Runtime

Everything here is plain TypeScript over `URLSearchParams`. On Hermes that is
React Native's own partial implementation, not the WHATWG one, and its
constructors disagree with the standard on hand-written links: `?tag` with no
`=` reads as `undefined`, `?q=a=b` loses `=b`, a stray `%` throws, and an object
holding an array becomes one value. **Read a link with `searchParamsFrom`**, from
a query string or a router's params object, never with `new URLSearchParams(...)`
directly: it parses the same way on every runtime.

`apps/mobile/src/lib/discovery-shared.test.ts` repeats the round trips against
React Native's class, so a change that relies on a method or behaviour React
Native does not have fails there first.
