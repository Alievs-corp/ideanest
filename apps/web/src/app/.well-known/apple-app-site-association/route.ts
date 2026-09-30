import { appleAppSiteAssociation } from '../../../lib/mobile/association';

/**
 * `/.well-known/apple-app-site-association` — §4.12 MB-02.
 *
 * <h2>A route handler, because the content type matters and has no extension</h2>
 *
 * The address is fixed by Apple and carries no file extension, so a copy in
 * `public/` would be served as `application/octet-stream`. iOS requires
 * `application/json`, and it does not tell you when it did not get it — the file
 * is fetched by Apple's CDN, rejected, and universal links simply never activate.
 *
 * <h2>It is also why `src/proxy.ts` excludes `.well-known`</h2>
 *
 * Having no extension is exactly what the matcher's `.*\.[\w]+$` clause relies
 * on to leave a file alone, so this address was the one that would have been
 * redirected to `/en/.well-known/...`. Apple's fetcher does not follow the
 * redirect. That is #362's failure again, in the one file whose failure is
 * invisible from the site itself.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const association = appleAppSiteAssociation();

  if (association === null) {
    // See `lib/mobile/association.ts`: a 404 is the safe absence, and a file
    // with a placeholder identifier in it is not.
    return new Response(null, { status: 404 });
  }

  return Response.json(association, {
    headers: {
      /*
       * Apple's CDN caches this for up to a week whatever we say, so a short
       * max-age here is about our own edge rather than about theirs: a
       * fingerprint that changes during a signing-key rotation should not stay
       * wrong on our side for longer than it has to.
       */
      'cache-control': 'public, max-age=3600, must-revalidate',
    },
  });
}
