import { assetLinks } from '../../../lib/mobile/association';

/**
 * `/.well-known/assetlinks.json` — §4.12 MB-02, Android's half.
 *
 * Android fetches this at install time when an intent filter carries
 * `autoVerify` (`apps/mobile/app.config.ts`), and it retries on its own
 * afterwards — so unlike Apple's file, an absence here is recoverable without a
 * reinstall. It is still served by a handler rather than from `public/`, because
 * the fingerprints it names differ per signing key and are read from the
 * environment for the reasons in `lib/mobile/association.ts`.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const statements = assetLinks();

  if (statements === null) {
    return new Response(null, { status: 404 });
  }

  return Response.json(statements, {
    headers: { 'cache-control': 'public, max-age=3600, must-revalidate' },
  });
}
