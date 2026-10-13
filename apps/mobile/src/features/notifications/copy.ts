import { notificationsCopyOf, type NotificationsCopy } from '@ideanest/account/inbox';
import type { Locale } from '@ideanest/messages/locale';
import { catalogue } from '../../lib/i18n';

/**
 * The inbox's words in the app: the web's tables (`account.notifications`), with one sentence
 * replaced — #452.
 *
 * <p>A plan's renewal reminder says "renew it for {amount}" on the web and in email. The app does not
 * sell or renew plans (Apple 3.1.1 and Play Billing, #164), so it never puts a price beside a call to
 * pay: its row says the plan ends and that it is renewed on the website, and opening it opens the
 * website's pricing page.
 */
export function appNotificationsCopy(locale: Locale): NotificationsCopy {
  const messages = catalogue(locale);
  const copy = notificationsCopyOf(messages.account.notifications);
  return {
    ...copy,
    headline: { ...copy.headline, SUBSCRIPTION_RENEWAL_DUE: messages.mobile.notifications.renewalDue },
    unnamed: { ...copy.unnamed, SUBSCRIPTION_RENEWAL_DUE: messages.mobile.notifications.renewalDueUnnamed },
  };
}
