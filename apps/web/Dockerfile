# The IdeyaNest web application, as an image — docs/architecture.md §19, issue #139.
#
# Built from the repository root, not from this directory: `@ideanest/web` depends
# on source-only workspace packages that are source-only, so a build context scoped to
# `apps/web` cannot see the code it compiles. `ops/deploy/README.md` gives the
# command; `.dockerignore` at the root is what keeps that context from being the
# whole checkout including `.next` and `node_modules`.
#
#   docker build -f apps/web/Dockerfile -t ideanest-web .

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps

# corepack rather than `npm i -g pnpm`: the version is pinned by
# `packageManager` in the root package.json, so the image cannot quietly build
# with a different resolver than the lockfile was written by.
RUN corepack enable

WORKDIR /repo

# Manifests and the lockfile only. A change to any source file must not
# invalidate the install layer, which is most of the build.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/api-client/package.json packages/api-client/
COPY packages/design-tokens/package.json packages/design-tokens/
COPY packages/discovery/package.json packages/discovery/
COPY packages/messages/package.json packages/messages/
COPY packages/money/package.json packages/money/
COPY packages/ui/package.json packages/ui/

# `--frozen-lockfile`, so an image can never be built from a resolution the
# repository has not committed to.
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM deps AS build

COPY . .

# IDEANEST_SITE_URL IS READ AT BUILD TIME AND HAS TO BE RIGHT HERE.
#
# `lib/seo/metadata.ts` writes every canonical URL, `og:url`, sitemap entry and
# absolute social-image URL against it, and the statically rendered pages bake it
# in. An image built with the default and deployed to production serves a sitemap
# full of `localhost` — which a crawler believes. It is an argument rather than an
# environment variable for exactly that reason: a value that must differ per
# image cannot come from the runtime.
ARG IDEANEST_SITE_URL=http://localhost:3000
ENV IDEANEST_SITE_URL=${IDEANEST_SITE_URL}

# The API origin is *not* an argument. It is read at request time by the proxy and
# by the server reads, so one image runs against staging and production alike.

RUN pnpm --filter @ideanest/web build

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

# Not root. The server writes nothing outside its own cache directory.
RUN addgroup --system --gid 1001 ideanest && adduser --system --uid 1001 --ingroup ideanest ideanest

WORKDIR /app
ENV NODE_ENV=production

# `next build` with `output: 'standalone'` traces exactly what the server
# imports and writes it here, so there is no install step and no `node_modules`
# full of pnpm symlinks that would not survive a COPY.
COPY --from=build --chown=ideanest:ideanest /repo/apps/web/.next/standalone ./
COPY --from=build --chown=ideanest:ideanest /repo/apps/web/.next/static ./apps/web/.next/static

# NO `public/`, BECAUSE THERE IS NOT ONE. This application serves no file from a
# static directory: `robots.txt`, `sitemap.xml` and the Open Graph images are
# route handlers, and the fonts are subset by `next/font` into the build output.
# The line copying it is the one every standalone Dockerfile carries, and here it
# would fail the build — which is a better outcome than the alternative, and is
# why this comment is here rather than an empty directory being checked in to
# make a copy succeed.

USER ideanest

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

# `/en/about` and not `/`. The root path is a 307 to a language, which a health
# check that follows redirects would pass on a broken application and one that
# does not would fail on a working one. A localised static page exercises the
# router, the proxy and a render.
#
# `127.0.0.1` AND NOT `localhost`. Inside the container `localhost` resolves to
# `::1` first and the server binds IPv4 `0.0.0.0`, so the check answered
# "connection refused" against an application that was serving perfectly - the
# container reported unhealthy while returning 200 to everything outside it.
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/en/about || exit 1

# The standalone server, at the path the workspace layout puts it. `exec` form,
# so node is PID 1 and SIGTERM reaches it.
CMD ["node", "apps/web/server.js"]
