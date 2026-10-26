import { describe, expect, it } from 'vitest';
// A JSDoc-typed `.mjs` module; `next.config.mjs` explains why it cannot be TypeScript here.
import config, { TOKEN_PAGES, contentSecurityPolicy, securityHeaders } from '../../../next.config.mjs';

/**
 * The response headers of #587, asserted rather than trusted.
 *
 * Every one of them is invisible when it is missing: a page without `frame-ancestors` renders
 * exactly as it did, inside somebody else's frame. So they are held here, and the policy was
 * checked in a browser against `next start` with no violations on the home page, a campaign,
 * sign-in and the reset page.
 */

type Header = { key: string; value: string };

function directive(policy: string, name: string): string[] {
  const entry = policy
    .split(';')
    .map((part) => part.trim().split(/\s+/u))
    .find(([key]) => key === name);
  return entry === undefined ? [] : entry.slice(1);
}

function header(headers: Header[], key: string): string | undefined {
  return headers.find((entry) => entry.key === key)?.value;
}

describe('the content security policy', () => {
  const policy = contentSecurityPolicy();

  it('lets nobody frame the site, run a plugin, re-point relative addresses or take a form', () => {
    expect(directive(policy, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(policy, 'object-src')).toEqual(["'none'"]);
    expect(directive(policy, 'base-uri')).toEqual(["'self'"]);
    expect(directive(policy, 'form-action')).toEqual(["'self'"]);
    expect(directive(policy, 'default-src')).toEqual(["'self'"]);
  });

  it('loads script from this origin and the two sign-in SDKs, and from nowhere else', () => {
    const sources = directive(policy, 'script-src');

    expect(sources).toContain("'self'");
    expect(sources).toContain('https://accounts.google.com/gsi/client');
    expect(sources).toContain('https://appleid.cdn-apple.com');
    expect(sources).not.toContain('https:');
    expect(sources).not.toContain('*');
    expect(sources.filter((source) => !source.startsWith("'"))).toHaveLength(2);
  });

  /*
   * The reason is in `next.config.mjs`: a browser ignores `'unsafe-inline'` as soon as a hash
   * or nonce is listed beside it, and Next's own per-page inline scripts have neither. Adding
   * one "to be stricter" is the change that blanks every page, so it fails here first.
   */
  it('keeps inline script working by listing no hash and no nonce beside it', () => {
    const sources = directive(policy, 'script-src');

    expect(sources).toContain("'unsafe-inline'");
    expect(sources.some((source) => /^'(sha256|sha384|sha512|nonce)-/u.test(source))).toBe(false);
    expect(sources).not.toContain("'strict-dynamic'");
  });

  it('allows eval only in development, where React rebuilds its stack traces with it', () => {
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-eval'");
    expect(directive(contentSecurityPolicy({ development: true }), 'script-src')).toContain("'unsafe-eval'");
  });

  it('lets Google draw its button and Apple sign in', () => {
    expect(directive(policy, 'frame-src')).toEqual(
      expect.arrayContaining(['https://accounts.google.com/gsi/', 'https://appleid.apple.com']),
    );
    expect(directive(policy, 'style-src')).toContain('https://accounts.google.com/gsi/style');
  });

  it('reaches the media bucket for images, video and uploads', () => {
    expect(directive(policy, 'img-src')).toEqual(expect.arrayContaining(["'self'", 'data:', 'blob:', 'https:']));
    expect(directive(policy, 'media-src')).toEqual(expect.arrayContaining(['blob:', 'https:']));
    expect(directive(policy, 'connect-src')).toEqual(expect.arrayContaining(["'self'", 'https:', 'wss:']));
    expect(directive(policy, 'connect-src')).not.toContain('http:');
  });
});

describe('the headers every response carries', () => {
  const headers = securityHeaders();

  it('names each of them once', () => {
    const keys = headers.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        'Content-Security-Policy',
        'Strict-Transport-Security',
        'X-Frame-Options',
        'X-Content-Type-Options',
        'Referrer-Policy',
        'Permissions-Policy',
      ]),
    );
  });

  it('holds each to the value a browser needs', () => {
    expect(header(headers, 'Strict-Transport-Security')).toMatch(/^max-age=31536000/u);
    expect(header(headers, 'X-Frame-Options')).toBe('DENY');
    expect(header(headers, 'X-Content-Type-Options')).toBe('nosniff');
    expect(header(headers, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header(headers, 'Permissions-Policy')).toContain('camera=()');
    expect(header(headers, 'Content-Security-Policy')).toBe(contentSecurityPolicy());
  });
});

describe('the configuration', () => {
  type Entry = { source: string; headers: Header[] };
  const load = async (): Promise<Entry[]> =>
    (await (config as { headers: () => Promise<Entry[]> }).headers()) as Entry[];

  it('sends the security headers on every path', async () => {
    const [first] = await load();

    expect(first?.source).toBe('/:path*');
    expect(header(first?.headers ?? [], 'Content-Security-Policy')).toBeDefined();
  });

  /*
   * Next applies every matching entry in order and the later one wins, so the pages that carry
   * a single-use token in their address must come after the default to send no referrer.
   */
  it('sends no referrer at all from the pages whose address carries a token, after the default', async () => {
    const entries = await load();
    const tokenEntries = entries.slice(1);

    expect(TOKEN_PAGES).toEqual(['/verify-email', '/reset-password/:rest*', '/confirm-email-change']);
    expect(tokenEntries.map((entry) => entry.source)).toEqual([
      '/verify-email',
      '/:locale/verify-email',
      '/reset-password/:rest*',
      '/:locale/reset-password/:rest*',
      '/confirm-email-change',
      '/:locale/confirm-email-change',
    ]);
    for (const entry of tokenEntries) {
      expect(entry.headers).toEqual([{ key: 'Referrer-Policy', value: 'no-referrer' }]);
    }
  });
});
