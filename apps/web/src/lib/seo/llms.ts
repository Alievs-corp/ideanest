import en from '@ideanest/messages/en.json';
import { LOCALE_NAMES, SUPPORTED_LOCALES } from '../i18n/locale';
import { SITE_DESCRIPTION, SITE_NAME } from './metadata';
import { localePath } from './sitemap/localised';
import { absoluteUrl, siteUrl } from './sitemap/config';

/**
 * `/llms.txt` — the site described for a language model, in the llmstxt.org shape.
 *
 * <h2>Every sentence here is one the site already says</h2>
 *
 * The summary is `SITE_DESCRIPTION` and each link's note is that page's own English
 * `metaDescription`, read from the catalogue rather than retyped. A model that quotes this
 * file therefore quotes the same claim the page makes about itself, and the day a page's
 * description changes this file changes with it — a second wording kept by hand is how a
 * summary comes to contradict the page it points at.
 *
 * <h2>English, linking to `/en`</h2>
 *
 * The convention is one file at the origin, and the catalogue every other language is
 * translated from is English. The other three homes are listed so a model that is answering
 * in Azerbaijani, Russian or Turkish is pointed at the page in that language.
 *
 * <p>Only indexable pages are linked. The private prefixes in `robots.txt` are absent on
 * purpose: a file inviting a crawler to read pages robots.txt asks it to skip would be the
 * same contradiction `identity.ts` refuses for `SearchAction`.
 */
interface Entry {
  readonly title: string;
  readonly path: string;
  readonly note: string;
}

const PLATFORM: readonly Entry[] = [
  { title: en.discovery.discover.metaTitle, path: '/discover', note: en.discovery.discover.metaDescription },
  { title: en.discovery.categories.metaTitle, path: '/categories', note: en.discovery.categories.metaDescription },
  { title: en.discovery.collections.metaTitle, path: '/collections', note: en.discovery.collections.metaDescription },
  { title: en.static.howItWorks.metaTitle, path: '/how-it-works', note: en.static.howItWorks.metaDescription },
  { title: en.pricing.metaTitle, path: '/pricing', note: en.pricing.metaDescription },
];

const ABOUT: readonly Entry[] = [
  { title: en.static.about.metaTitle, path: '/about', note: en.static.about.metaDescription },
  { title: en.static.trustSafety.metaTitle, path: '/trust-safety', note: en.static.trustSafety.metaDescription },
  { title: en.static.support.metaTitle, path: '/support', note: en.static.support.metaDescription },
  { title: en.legal.index.metaTitle, path: '/legal', note: en.legal.index.metaDescription },
];

function line(entry: Entry, base: string): string {
  return `- [${entry.title}](${absoluteUrl(localePath(entry.path, 'en'), base)}): ${entry.note}`;
}

export function llmsText(base: string = siteUrl()): string {
  const languages = SUPPORTED_LOCALES.map(
    (locale) => `- [${LOCALE_NAMES[locale]}](${absoluteUrl(localePath('/', locale), base)})`,
  );

  return [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_DESCRIPTION}`,
    '',
    `${SITE_NAME} is published in ${SUPPORTED_LOCALES.length} languages. Every page below exists in each of them under its own language prefix.`,
    '',
    '## Platform',
    '',
    ...PLATFORM.map((entry) => line(entry, base)),
    '',
    '## About',
    '',
    ...ABOUT.map((entry) => line(entry, base)),
    '',
    '## Languages',
    '',
    ...languages,
    '',
  ].join('\n');
}
