import type { Metadata } from 'next';
import { AccountPageHeader } from '../../../../components/account/AccountPageHeader';
import { ProfileVisibilityPanel } from '../../../../components/profile/ProfileVisibilityPanel';
import { AccountClosurePanel } from '../../../../components/settings/AccountClosurePanel';
import { DataExportPanel } from '../../../../components/settings/DataExportPanel';
import { privatePageMetadata } from '../../../../lib/seo/metadata';
import { getTranslations } from 'next-intl/server';
import {
  accountClosurePanelCopy,
  dataExportPanelCopy,
  profileVisibilityCopy,
} from '../../../../lib/i18n/shell-copy.server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.pages.privacy');

  /*
   * A function rather than a `const` since #324: the tab title is the one piece of
   * this screen a reader sees before the page paints, and it followed the build
   * rather than the reader until the catalogue reached it.
   */
  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

/**
 * `/settings/privacy` — §4.1 A-10 and A-11 and §4.2 P-07, issues #279 and #274.
 *
 * <h2>The visibility switch is first, and the other two keep their order</h2>
 *
 * §4.2's P-07 needed a home, and this is the page about who can see what: it already holds
 * the data export and the account closure. `ProfileVisibilityPanel` explains why it is not on
 * a profile editor — there is no `PATCH /v1/me` for a name or a biography, so a
 * `/settings/profile` built to hold one switch would be a screen whose other four fields do
 * not exist.
 *
 * It goes **above** the pair below rather than between them. Those two are read as one
 * argument, in the order given here, and a control about something else in the middle of it
 * would break the argument rather than join it. It is also the smallest of the three and the
 * only one that is reversible in a keystroke, which is the right thing to meet first on a page
 * whose last panel closes an account.
 *
 * <h2>The export is above the closure, and the order is the point</h2>
 *
 * They are the two halves of the same moment: §17.4 anonymises a closed account after thirty
 * days, and the export is the only way to keep anything after that. Putting the closure first
 * would be putting the irreversible action above the one that makes it survivable. Somebody
 * who scrolls to the bottom of this page has read the offer to take their data with them.
 *
 * **The order is not enforcement.** A closure does not require an export first, and it should
 * not: making somebody download a file before they may leave is a dark pattern wearing a
 * safety argument.
 */
export default async function PrivacyPage() {
  // Both panels are client islands behind a bearer token, so the route resolves their words
  // and hands them down — lib/i18n/settings-copy.ts carries the reasoning.
  const [t, exportCopy, closureCopy, visibility] = await Promise.all([
    getTranslations('settings.pages.privacy'),
    dataExportPanelCopy(),
    accountClosurePanelCopy(),
    profileVisibilityCopy(),
  ]);

  return (
    <>
      <AccountPageHeader title={t('title')}>
        {t('intro')}
      </AccountPageHeader>

      <div className="mt-8 flex flex-col gap-6">
        <ProfileVisibilityPanel copy={visibility} />
        <DataExportPanel copy={exportCopy} />
        <AccountClosurePanel copy={closureCopy} />
      </div>
    </>
  );
}
