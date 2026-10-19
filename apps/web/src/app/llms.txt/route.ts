import { llmsText } from '../../lib/seo/llms';

/**
 * `/llms.txt`. The content and the argument for it are in `lib/seo/llms.ts`.
 *
 * `force-dynamic` for `robots.ts`'s reason: every link is absolute and the origin is read
 * from the environment at request time, so a prerendered file would carry the origin of
 * whichever machine ran `next build`. The proxy's matcher already passes a path with a
 * file extension straight through, so this is not redirected to a language.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return new Response(llmsText(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
