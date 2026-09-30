import type { PartnerSection } from '../../admin/partners';
import type { AdminTranslator } from '../admin-copy';
import type { ConsoleChromeCopy } from './common-copy';
import { accountPickerCopyFrom, type AccountPickerCopy } from './people-copy';

/**
 * The words on the two partner screens — #206, part of #202.
 *
 * <p>Built from the catalogue by the same function the route calls and the tests call, like
 * every other console screen, so a key that is missing fails a test instead of rendering its own
 * path in a production page.
 */

/** The partner list, where a super admin sets a percentage and opens sections. */
export interface PartnerManagerCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly noticeTitle: string;
  readonly noticeBody: string;
  readonly rosterHeading: string;
  readonly loadingRoster: string;
  readonly rosterEmptyTitle: string;
  readonly rosterEmptyBody: string;
  /** Carries `{allocated}`, `{remaining}`. */
  readonly allocation: string;
  /** Carries `{date}`. */
  readonly updatedLine: string;
  readonly sectionsNone: string;
  /** Carries `{sections}`. */
  readonly sectionsOpen: string;
  readonly percentageLabel: string;
  readonly percentageHint: string;
  readonly sectionsLegend: string;
  readonly sectionLabel: Readonly<Record<PartnerSection, string>>;
  readonly sectionHint: Readonly<Record<PartnerSection, string>>;
  readonly sectionsNote: string;
  readonly saveChanges: string;
  readonly remove: string;
  readonly addHeading: string;
  readonly addIntro: string;
  readonly picker: AccountPickerCopy;
  readonly chooseAccountFirst: string;
  readonly addPartner: string;
  readonly working: string;
  /** Carries `{name}`, `{percentage}`. */
  readonly savedNotice: string;
  /** Carries `{name}`. */
  readonly removedNotice: string;
  readonly doneTitle: string;
  readonly failedTitle: string;
}

export function partnerManagerCopyFrom(t: AdminTranslator, chrome: ConsoleChromeCopy): PartnerManagerCopy {
  // `t.raw` for every template: `t('key')` on a message holding a placeholder renders the key's
  // own path, and `test-copy.ts` refuses it.
  const word = (key: string) => t(`screens.partners.${key}`);
  const template = (key: string) => String(t.raw(`screens.partners.${key}`));

  return {
    ...chrome,
    subject: word('subject'),
    noticeTitle: word('noticeTitle'),
    noticeBody: word('noticeBody'),
    rosterHeading: word('rosterHeading'),
    loadingRoster: word('loadingRoster'),
    rosterEmptyTitle: word('rosterEmptyTitle'),
    rosterEmptyBody: word('rosterEmptyBody'),
    allocation: template('allocation'),
    updatedLine: template('updatedLine'),
    sectionsNone: word('sectionsNone'),
    sectionsOpen: template('sectionsOpen'),
    percentageLabel: word('percentageLabel'),
    percentageHint: word('percentageHint'),
    sectionsLegend: word('sectionsLegend'),
    sectionLabel: t.raw('screens.partners.sectionLabel') as Readonly<Record<PartnerSection, string>>,
    sectionHint: t.raw('screens.partners.sectionHint') as Readonly<Record<PartnerSection, string>>,
    sectionsNote: word('sectionsNote'),
    saveChanges: word('saveChanges'),
    remove: word('remove'),
    addHeading: word('addHeading'),
    addIntro: word('addIntro'),
    picker: accountPickerCopyFrom(t, chrome.refusals),
    chooseAccountFirst: word('chooseAccountFirst'),
    addPartner: word('addPartner'),
    working: word('working'),
    savedNotice: template('savedNotice'),
    removedNotice: template('removedNotice'),
    doneTitle: word('doneTitle'),
    failedTitle: word('failedTitle'),
  };
}

/** The statistics page, for a partner and for a super admin. */
export interface PartnerStatisticsCopy extends ConsoleChromeCopy {
  readonly subject: string;
  /** Carries `{percentage}`. Said once in the page header, for a partner, and never repeated per figure. */
  readonly partnerLine: string;
  readonly realLine: string;
  /** Carries `{zone}`. */
  readonly zoneNote: string;
  readonly loadingStatistics: string;
  readonly notConfiguredTitle: string;
  readonly notConfiguredBody: string;
  readonly todayHeading: string;
  readonly monthHeading: string;
  readonly dailyHeading: string;
  readonly monthlyHeading: string;
  readonly planHeading: string;
  readonly revenue: string;
  readonly subscriptions: string;
  readonly reversals: string;
  readonly dateColumn: string;
  readonly monthColumn: string;
  readonly planColumn: string;
  readonly nothingRecorded: string;
  readonly dailyCaption: string;
  readonly monthlyCaption: string;
  readonly planCaption: string;
}

export function partnerStatisticsCopyFrom(t: AdminTranslator, chrome: ConsoleChromeCopy): PartnerStatisticsCopy {
  const word = (key: string) => t(`screens.partnerStatistics.${key}`);
  const template = (key: string) => String(t.raw(`screens.partnerStatistics.${key}`));

  return {
    ...chrome,
    subject: word('subject'),
    partnerLine: template('partnerLine'),
    realLine: word('realLine'),
    zoneNote: template('zoneNote'),
    loadingStatistics: word('loadingStatistics'),
    notConfiguredTitle: word('notConfiguredTitle'),
    notConfiguredBody: word('notConfiguredBody'),
    todayHeading: word('todayHeading'),
    monthHeading: word('monthHeading'),
    dailyHeading: word('dailyHeading'),
    monthlyHeading: word('monthlyHeading'),
    planHeading: word('planHeading'),
    revenue: word('revenue'),
    subscriptions: word('subscriptions'),
    reversals: word('reversals'),
    dateColumn: word('dateColumn'),
    monthColumn: word('monthColumn'),
    planColumn: word('planColumn'),
    nothingRecorded: word('nothingRecorded'),
    dailyCaption: word('dailyCaption'),
    monthlyCaption: word('monthlyCaption'),
    planCaption: word('planCaption'),
  };
}
