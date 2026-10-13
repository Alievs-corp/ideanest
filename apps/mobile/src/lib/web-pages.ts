import type { Locale } from '@ideanest/messages/locale';
import { siteUrl } from '../api/config';

/**
 * A page of the website, in the reader's language: what the in-app browser opens when the app
 * sends somebody to the web on purpose — the pricing page (#164), and since #452 every message
 * about the creator's own plan. `path` is locale-less and begins with `/`, as the parser and the
 * inbox write it.
 */
export function webPageUrl(locale: Locale, path: string, site: string = siteUrl()): string {
  return `${site}/${locale}${path}`;
}
