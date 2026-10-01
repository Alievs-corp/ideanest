import en from '@ideanest/messages/en.json';
import { filterVocabularyCopyFrom } from './copy';

/*
 * The vocabularies a screen resolves, built from the English catalogue by the same function both
 * applications call — issue #324. The group names and the band labels are asserted in the tests,
 * so building them from the catalogue is what makes a test fail when a word is edited to
 * something the feed no longer draws.
 */
const filters = en.discovery.filters as Readonly<Record<string, unknown>>;

export const VOCABULARY = filterVocabularyCopyFrom({ raw: (key) => filters[key] });
