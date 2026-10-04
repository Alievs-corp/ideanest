import { Glyphs, type IconGlyph } from '../../icons';
import type { MessageKey } from '../../lib/i18n';

/** The web's `ACCOUNT_GROUPS.settings`, in its order (#161). */
export const SETTINGS_SECTIONS = [
  'profile',
  'notifications',
  'sessions',
  'email',
  'password',
  'security',
  'privacy',
  'payout',
  'language',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function isSettingsSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/** "Security" rather than the web's "Two-factor authentication": the screen also holds the app lock. */
export function sectionLabelKey(section: SettingsSection): MessageKey {
  return section === 'security' ? 'mobile.settings.securityLabel' : `account.links.${section}.label`;
}

export function sectionPath(section: SettingsSection): `/settings/${SettingsSection}` {
  return `/settings/${section}`;
}

/** Each section's Bulk glyph in the Me hub and the settings list. */
const GLYPHS: Record<SettingsSection, IconGlyph> = {
  profile: Glyphs.User,
  notifications: Glyphs.Notification,
  sessions: Glyphs.Monitor,
  email: Glyphs.Sms,
  password: Glyphs.Key,
  security: Glyphs.ShieldTick,
  privacy: Glyphs.Archive,
  payout: Glyphs.Bank,
  language: Glyphs.Translate,
};

export function sectionGlyph(section: SettingsSection): IconGlyph {
  return GLYPHS[section];
}
