import createNextIntlPlugin from 'next-intl/plugin';

/**
 * Deliberately `.mjs` rather than `.ts`: Next compiles a TypeScript config
 * through the `typescript` package it finds in the workspace, and this
 * repository is on TypeScript 7, whose compiler API it cannot drive. A plain
 * module with JSDoc types costs nothing and removes the coupling.
 */

/**
 * The message catalogue's server half — docs/architecture.md §21.1, issue #324.
 *
 * The plugin does one thing: it teaches the bundler where the request-scoped
 * configuration lives, so that `getTranslations` on the server and
 * `NextIntlClientProvider` in the browser resolve to the same catalogue without
 * every route passing one down by hand.
 *
 * IT IS POINTED AT A PATH RATHER THAN LEFT TO THE DEFAULT because the default
 * looks for `./i18n/request.ts` at the application root, and everything in this
 * application that is not a route lives under `src/`. A convention that puts one
 * module somewhere none of its neighbours are is a module nobody finds.
 *
 * THE LANGUAGE IS A PATH SEGMENT (#123). `src/i18n/routing.ts` declares the
 * shape, `src/proxy.ts` sends a bare path to a prefixed one, and
 * `src/i18n/request.ts` resolves the catalogue from the matched `[locale]`
 * parameter. Nothing here reads a cookie, so a localised page is as static as
 * the English one it replaced.
 */
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Where the Spring Boot service listens. Read at build time on the server only,
 * so it is not a `NEXT_PUBLIC_` variable — the browser never learns the API's
 * real origin, it only ever talks to this application.
 */
const apiOrigin = process.env.IDEANEST_API_ORIGIN ?? 'http://localhost:8080';

/**
 * The image pipeline's delivery half. docs/architecture.md §13.1 owns the
 * ingestion half; this is what a browser is offered once the bytes exist.
 *
 * Exported by name so `src/lib/images/config.test.ts` can assert it. A build
 * setting nothing checks is a setting that silently reverts to the framework
 * default the first time somebody tidies this file.
 *
 * @type {import('next').NextConfig['images']}
 */
export const images = {
  /**
   * AVIF FIRST, WEBP SECOND, THE ORIGINAL LAST. Next content-negotiates in this
   * order and falls back on its own: a browser whose `Accept` header omits AVIF
   * is served WebP, and one that asks for neither is served the source
   * encoding. Nothing is feature-detected in the client, and §13.1's stated
   * order is the order here.
   *
   * AVIF is materially smaller than WebP on photographs — which is what every
   * image on this platform is — at the cost of a slower encode. That cost is
   * paid once per variant, on the server, and `minimumCacheTTL` is what keeps
   * it to once.
   */
  formats: ['image/avif', 'image/webp'],

  /**
   * THE CANDIDATE WIDTHS, CUT TO WHAT THE LAYOUTS ACTUALLY USE.
   *
   * Next builds the `srcset` from `imageSizes` and `deviceSizes` together
   * whenever `sizes` is present, so every width left in these lists is a width
   * some browser will request and the optimiser will encode. The defaults end
   * at 3840. The widest box in this application is the prelaunch cover at 720
   * CSS pixels — 1440 on a 2× display — and the widest card is 440
   * (`src/lib/images/sizes.ts` derives both from the Tailwind classes that
   * produce them). Anything above 1440 is an AVIF encode of a photograph nobody
   * can see, kept in a cache.
   *
   * 1440 is also §13.1's `hero` variant and 160 its `thumbnail`, so the ladder
   * the optimiser serves and the ladder the media service will store are one
   * ladder rather than two that drift.
   */
  deviceSizes: [640, 750, 828, 1080, 1200, 1440],
  imageSizes: [16, 32, 48, 64, 96, 128, 160, 256, 384],

  /**
   * ONE QUALITY. Next 16 requires every quality a component asks for to be
   * declared here and treats an undeclared one as an error rather than a silent
   * re-encode. Nothing in the application overrides it, so the list is the
   * default alone — which makes adding a second a deliberate act with a
   * measurement behind it, not a number typed into a prop.
   */
  qualities: [75],

  /**
   * WHOSE IMAGES THE OPTIMISER WILL FETCH.
   *
   * `https` and nothing else: an `http://` image is blocked as mixed content on
   * an HTTPS page anyway, so allowing it would only mean re-encoding pictures
   * no browser will display. `src/lib/images/source.ts` keeps the same rule on
   * the render side, because an address `next/image` cannot match throws, and a
   * throw in a server component takes the route down with it.
   *
   * THE WILDCARD HOSTNAME IS DELIBERATE AND IT IS A KNOWN COST. There is no
   * uploader and no object storage yet (docs/architecture.md §13.1, contract
   * §3): a cover is an address a creator typed, on a host nobody can enumerate
   * in advance. An allowlist today is an allowlist that matches nothing, and
   * then no cover on the platform is ever converted to AVIF — the whole point
   * of this file. What it costs is that `/_next/image` will fetch and re-encode
   * any HTTPS URL handed to it, so it can be used as an image proxy by anybody
   * who can write the query string. Next refuses private and loopback addresses
   * on its own, so the exposure is bandwidth rather than a route into the
   * network.
   *
   * THE FIX IS THE MEDIA PIPELINE, NOT A LONGER PATTERN LIST. Once §13.1's
   * storage exists every cover is on one origin, this narrows to that origin,
   * and the proxy stops existing. It is written into §13.1 as part of that
   * work rather than left here as a comment nobody is accountable for.
   */
  remotePatterns: [{ protocol: 'https', hostname: '**' }],

  /**
   * THIRTY DAYS, NOT A YEAR.
   *
   * The cache key is the source URL, so a creator who replaces the photograph
   * behind an address they already saved keeps serving the old one until this
   * expires. A year is right for content-addressed storage and wrong for a URL
   * a human controls, which is every cover today. Thirty days keeps the AVIF
   * encode off the critical path for any realistic campaign while bounding how
   * long a replaced picture can be wrong. It becomes a year when §13.1's
   * immutable keys land.
   */
  minimumCacheTTL: 60 * 60 * 24 * 30,

  /**
   * SVG STAYS OFF. This is the default, and it is written out because it is the
   * setting most often turned on by somebody who wants to render one logo. An
   * SVG is a script that happens to draw, and the optimiser serves it from this
   * application's own origin — which is where the session cookie lives.
   */
  dangerouslyAllowSVG: false,
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  images,

  /**
   * A self-contained server directory, for the container — issue #139.
   *
   * Without it an image has to carry `node_modules`, which for this workspace is
   * a pnpm store full of symlinks that do not survive a `COPY`. With it, `next
   * build` traces what the server actually imports and writes exactly that into
   * `.next/standalone` — a few megabytes rather than a few hundred, and no
   * install step in the runtime stage.
   *
   * It changes nothing about the client bundles, so the First Load JS budgets
   * measure the same bytes they did before, and `next start` still works for the
   * Lighthouse run in CI.
   */
  output: 'standalone',

  /**
   * WHAT THE TRACER MISSES UNDER pnpm, AND HOW THIS WAS FOUND.
   *
   * `output: 'standalone'` traces what the server imports and copies exactly
   * that. It traced `@swc/helpers`' CommonJS build and not its ESM one, and
   * `apps/web` is `"type": "module"` — so the container started, resolved
   * `@swc/helpers/esm/_interop_require_default.js`, and exited 1 before serving
   * a request.
   *
   * It is a trace-time miss rather than a missing dependency: the package is
   * installed and its `cjs/` half was copied. Naming the whole package here is
   * what makes both halves travel.
   *
   * The path is relative to this directory and reaches the workspace store,
   * because pnpm does not hoist. The version is a glob so that a dependency
   * bump does not silently stop matching — a stale exact version here would
   * fail the same way, at run time, in an image somebody had already shipped.
   */
  outputFileTracingIncludes: {
    '**/*': ['../../node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**/*'],
  },

  /**
   * `@ideanest/ui` and `@ideanest/design-tokens` are source-only packages —
   * their `exports` point straight at `.ts`/`.tsx`. Next has to compile them
   * rather than assume a built `dist`.
   */
  transpilePackages: [
    '@ideanest/ui',
    '@ideanest/design-tokens',
    '@ideanest/api-client',
    '@ideanest/money',
    '@ideanest/messages',
  ],

  /**
   * The API is proxied under this application's own origin, and that is not a
   * convenience.
   *
   * The refresh cookie is `SameSite=Strict` on `Path=/v1/auth`, so a browser
   * will not attach it to a request aimed at another origin — which is the
   * whole point of the setting. The service also declares no CORS policy, so a
   * cross-origin call would not survive its preflight either. Same-origin is
   * therefore the only arrangement in which the browser half of the auth flow
   * works at all, and routing `/v1` through here is what makes it same-origin.
   */
  async rewrites() {
    return [{ source: '/v1/:path*', destination: `${apiOrigin}/v1/:path*` }];
  },
};

export default withNextIntl(nextConfig);
