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
   *
   * WHERE THAT STANDS (#587). The bucket exists now, but its address is the API's runtime
   * setting (`MEDIA_PUBLIC_BASE_URL`) and nothing in this application's build is told it, and
   * a cover can still be an address a creator typed (`CoverImageSelection.FromUrl`). Narrowing
   * here today would turn every such cover into a thrown server render. It narrows when
   * `FromUrl` is retired and the web is given the media origin at build time.
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

/**
 * The two sign-in providers' SDKs, fetched on the first click — `lib/auth/script.ts` and
 * `components/auth/ProviderSignIn.tsx`. Google's draws its button in an iframe and loads its
 * own stylesheet; Apple's opens a popup, which no policy here governs.
 */
const GOOGLE_IDENTITY = 'https://accounts.google.com';
const APPLE_SDK_ORIGIN = 'https://appleid.cdn-apple.com';
const APPLE_ID_ORIGIN = 'https://appleid.apple.com';

/**
 * Cloudflare Web Analytics. The proxy in front of the site injects this beacon into every
 * HTML response (it is not in this application's source), and it reports to
 * `cloudflareinsights.com`, which `connect-src`'s `https:` already allows. Without it here the
 * policy blocked the beacon in production and the site's analytics went dark.
 */
const CLOUDFLARE_INSIGHTS = 'https://static.cloudflareinsights.com';

/**
 * The Content-Security-Policy every response carries — #587.
 *
 * <h2>`'unsafe-inline'` in `script-src`, and why neither a nonce nor a hash</h2>
 *
 * The issue asked for a nonce or a hash on the root layout's two inline scripts. Both were
 * measured against this application and neither holds:
 *
 * - **A hash** covers a script whose text is known when the header is written. The layout's
 *   two are, but Next itself streams the RSC payload into every page as inline
 *   `self.__next_f.push(...)` scripts whose text is different on every page, and the
 *   maintenance notice and page write one with the window's own months in it. Once a policy
 *   lists any hash, a browser ignores `'unsafe-inline'` beside it — so a hash for the two
 *   would block the framework's own scripts and the page would never hydrate.
 * - **A nonce** has to be minted per response and written into the HTML, which Next does only
 *   in a dynamic render, and the layout would have to read it from `next/headers` for its own
 *   two scripts (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`).
 *   The public pages' HTML is shared through the CDN for a minute and more
 *   (`lib/cache/publicRoutes.ts`, #127), and the layout is written to stay static (#123): a
 *   nonce in a cached page is the same nonce for every reader of that copy and readable by
 *   anybody who fetches it, which is no nonce. Taking the pages out of the shared cache to fix
 *   that is a cost to every page on a small shared server that a hardening change does not get
 *   to decide.
 *
 * So inline script stays allowed and **script from anywhere else does not**: `'self'`, the
 * two providers' SDK origins and the Cloudflare analytics beacon only. An injection that can add `<script src>` — the commoner
 * half — is refused, and the remaining directives hold whatever a script does.
 *
 * <h2>The rest, directive by directive</h2>
 *
 * - `default-src 'self'` — anything not named below comes from here or nowhere.
 * - `object-src 'none'`, `base-uri 'self'` — no plugins, and no `<base>` that re-points every
 *   relative address on the page.
 * - `form-action 'self'` — nothing on this site posts a form anywhere else; a payment leaves
 *   by `location.assign` (`lib/pledges/payment.ts`), which this does not govern.
 * - `frame-ancestors 'none'` — nobody frames this site, which is what makes clickjacking a
 *   pledge impossible. `X-Frame-Options: DENY` below says the same to older browsers.
 * - `img-src` and `media-src` take any `https:` address: a cover can still be an address a
 *   creator typed (`CoverImageSelection.FromUrl`), and a ready image or video is served from
 *   the media bucket whose address only the API's runtime environment knows. `data:` is the
 *   §13.1 blur placeholder; `blob:` is the editor's local preview and the CSV downloads.
 * - `connect-src` takes `https:` and `wss:` for the same reason: an upload is a `PUT` to a
 *   presigned bucket address the API issues at run time (`lib/media/upload.ts`), and §12.1's
 *   socket is `IDEANEST_REALTIME_ORIGIN`. Narrowing it would buy nothing while `img-src` is
 *   `https:` — an image address is already a way out for anything a script has read.
 * - `style-src 'unsafe-inline'` — React writes `style` attributes and the motion library
 *   animates through them. Google's button brings its own stylesheet.
 *
 * DEVELOPMENT adds `'unsafe-eval'`, which React's development build needs to rebuild stack
 * traces, and `ws:` for the reload socket. A production build has neither.
 *
 * Exported so `src/lib/security/headers.test.ts` can assert it, for the reason `images` is.
 *
 * @param {{ development?: boolean }} [options]
 * @returns {string}
 */
export function contentSecurityPolicy({ development = false } = {}) {
  const directives = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      ...(development ? ["'unsafe-eval'"] : []),
      `${GOOGLE_IDENTITY}/gsi/client`,
      APPLE_SDK_ORIGIN,
      CLOUDFLARE_INSIGHTS,
    ],
    'style-src': ["'self'", "'unsafe-inline'", `${GOOGLE_IDENTITY}/gsi/style`],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'media-src': ["'self'", 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", 'https:', 'wss:', ...(development ? ['ws:'] : [])],
    'frame-src': ["'self'", `${GOOGLE_IDENTITY}/gsi/`, APPLE_ID_ORIGIN],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

/**
 * The headers every response carries — #587. Each is a default a browser should have had and
 * does not: nothing here changes what a page renders.
 *
 * - **HSTS for a year, without `includeSubDomains`.** The site is only ever served over https
 *   (Cloudflare in front, `WEB_BASE_URL` must be https — ops/deploy/README.md), so a browser
 *   that has seen it once should never try plain http again. Subdomains are left out because
 *   this repository does not know every host under the domain; adding them, and `preload`, is
 *   the owner's call once that is known. A browser ignores the header on http, so `next start`
 *   on localhost is unaffected.
 * - **`strict-origin-when-cross-origin`** sends another site the origin and never the path or
 *   query. The pages whose address carries a token send nothing at all — see
 *   {@link TOKEN_PAGES}.
 * - **`nosniff`**, so nothing served here is ever run as a type it was not labelled.
 * - **Permissions-Policy** turns off the powerful features nothing on the site uses, for this
 *   page and anything it frames.
 *
 * @param {{ development?: boolean }} [options]
 * @returns {{ key: string, value: string }[]}
 */
export function securityHeaders({ development = false } = {}) {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy({ development }) },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    },
  ];
}

/**
 * The pages an e-mail link lands on with a single-use token in the query: `/verify-email`,
 * `/reset-password/confirm` and `/confirm-email-change` (`AuthEmailComposer`). Under the
 * default policy every same-origin request from one of them — each `/v1` call, each link
 * followed, and so every access log and analytics line downstream — would carry the full
 * address, token included, in its `Referer`. `no-referrer` sends nothing, from anywhere, so the
 * token stays in the address bar of the device it was opened on.
 *
 * Each with and without the language segment: an e-mail link is `/{locale}/...`, and a bare
 * one is redirected there by `src/proxy.ts`. `/reset-password/:rest*` also matches
 * `/reset-password` itself.
 */
export const TOKEN_PAGES = ['/verify-email', '/reset-password/:rest*', '/confirm-email-change'];

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
    '@ideanest/discovery',
    '@ideanest/campaign',
    '@ideanest/campaign-editor',
    '@ideanest/checkout',
    '@ideanest/account',
    '@ideanest/dashboard',
    '@ideanest/legal',
    '@ideanest/links',
    '@ideanest/plans',
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

  /**
   * #587's response headers. Written into the build's routes manifest, so they reach every
   * response the server sends — static pages, `/_next/static`, route handlers — and not only
   * the ones `src/proxy.ts` matches.
   *
   * Order matters: when two entries set the same header, the later one wins, which is how the
   * token pages take `no-referrer` over the default above them.
   */
  async headers() {
    const development = process.env.NODE_ENV === 'development';
    return [
      { source: '/:path*', headers: securityHeaders({ development }) },
      ...TOKEN_PAGES.flatMap((page) => [page, `/:locale${page}`]).map((source) => ({
        source,
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      })),
    ];
  },
};

export default withNextIntl(nextConfig);
