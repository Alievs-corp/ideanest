import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import * as WebBrowser from 'expo-web-browser';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import type { Locale } from '@ideanest/messages';
import { SurfaceProvider } from '../../components/ui';
import { setLocale } from '../../lib/locale';
import { colors, tint } from '../../theme';
import { CreatorObligationSummary } from './obligation-summary';
import { ProfileAbout } from './profile-about';
import { ProfileCampaignCard } from './profile-campaign-card';
import type { ProfileProjectCard, PublicProfile } from './wire';

/**
 * The profile's pieces (#156): the campaign card (states, funding shown and withheld, the decimal
 * percent, backers in four languages), the About tab, and the late-updates card.
 */

const CATALOGUES = { az, en, ru, tr } as const;
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

async function show(node: ReactElement, locale: Locale = 'en') {
  await act(async () => setLocale(locale));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale={locale} messages={CATALOGUES[locale]}>
        <SurfaceProvider surface="white">{node}</SurfaceProvider>
      </IntlProvider>
    </SafeAreaProvider>,
  );
}

const card = (overrides: Partial<ProfileProjectCard> = {}): ProfileProjectCard => ({
  id: 'p1',
  title: 'Solar Lamp',
  slug: 'solar-lamp',
  creatorSlug: 'aysel',
  blurb: 'Light for the village',
  state: 'LIVE',
  goal: { amount: '1000.00', currency: 'AZN' },
  pledged: { amount: '795.00', currency: 'AZN' },
  backersCount: 12,
  coverUrl: null,
  ...overrides,
});

const S = en.profile.card.states;

describe('ProfileCampaignCard', () => {
  it.each(Object.keys(S) as (keyof typeof S)[])('names the %s state from the catalogue', async (state) => {
    await show(<ProfileCampaignCard card={card({ state })} funding="shown" onOpen={jest.fn()} />);
    expect(screen.getByTestId('profile-card-state')).toHaveTextContent(S[state], { exact: false });
  });

  it('draws an unknown state as its raw value, never an empty tag', async () => {
    await show(<ProfileCampaignCard card={card({ state: 'ARCHIVED' })} funding="shown" onOpen={jest.fn()} />);
    expect(screen.getByTestId('profile-card-state')).toHaveTextContent('ARCHIVED', { exact: false });
  });

  it('marks funded and completed with the success token, and uses no lime', async () => {
    for (const state of ['SUCCESSFUL', 'COMPLETED']) {
      await show(<ProfileCampaignCard card={card({ state })} funding="shown" onOpen={jest.fn()} />);
      expect(screen.getByTestId('profile-card-state')).toHaveStyle({
        backgroundColor: tint(colors.success, 0.12),
      });
      const tree = JSON.stringify(screen.toJSON());
      for (const lime of [colors.lime300, colors.lime400, colors.lime500, colors.lime600, colors.lime700]) {
        expect(tree).not.toContain(lime);
      }
      await cleanup();
    }
  });

  it('shows the funding on Created: amount, percent from Decimal, goal', async () => {
    await show(<ProfileCampaignCard card={card()} funding="shown" onOpen={jest.fn()} />);
    const node = screen.getByTestId('profile-card-p1');
    expect(node).toHaveTextContent(/795\.00 AZN/);
    expect(node).toHaveTextContent(/80% funded/);
    expect(node).toHaveTextContent(/of 1,000\.00 AZN goal/);
    expect(screen.getByTestId('profile-card-funding')).toBeTruthy();
    expect(node.props.accessibilityValue.text).toContain('80% funded');
  });

  it('withholds every amount on Backed: no money, no percent, no bar, nothing announced', async () => {
    await show(<ProfileCampaignCard card={card()} funding="withheld" onOpen={jest.fn()} />);
    const node = screen.getByTestId('profile-card-p1');
    expect(node).not.toHaveTextContent(/AZN/);
    expect(node).not.toHaveTextContent(/%/);
    expect(screen.queryByTestId('profile-card-funding')).toBeNull();
    expect(screen.getByTestId('profile-card-no-funding')).toBeTruthy();
    expect(screen.queryAllByRole('progressbar', { includeHiddenElements: true })).toHaveLength(0);
    expect(screen.queryByTestId('progress-fill', { includeHiddenElements: true })).toBeNull();
    const value = String(node.props.accessibilityValue.text);
    expect(value).not.toMatch(/AZN|%|795|1000/);
    expect(value).toContain('12 backers');
  });

  it('hides the funding for a goal of zero', async () => {
    await show(
      <ProfileCampaignCard card={card({ goal: { amount: '0.00', currency: 'AZN' } })} funding="shown" onOpen={jest.fn()} />,
    );
    expect(screen.queryByTestId('profile-card-funding')).toBeNull();
    expect(screen.getByTestId('profile-card-p1')).not.toHaveTextContent(/%/);
  });

  it.each([
    ['en', 1, '1 backer'],
    ['en', 5, '5 backers'],
    ['ru', 1, ru.common.card.backers.one.replace('{count}', '1')],
    ['ru', 3, ru.common.card.backers.few.replace('{count}', '3')],
    ['ru', 5, ru.common.card.backers.many.replace('{count}', '5')],
    ['az', 1, az.common.card.backers.one.replace('{count}', '1')],
    ['az', 4, az.common.card.backers.other.replace('{count}', '4')],
    ['tr', 1, tr.common.card.backers.one.replace('{count}', '1')],
    ['tr', 7, tr.common.card.backers.other.replace('{count}', '7')],
  ] as const)('counts backers in %s: %i', async (locale, count, words) => {
    await show(
      <ProfileCampaignCard card={card({ backersCount: count })} funding="withheld" onOpen={jest.fn()} />,
      locale,
    );
    expect(screen.getByTestId('profile-card-p1')).toHaveTextContent(words, { exact: false });
  });

  it('is one link named by the title, and opens the campaign', async () => {
    const onOpen = jest.fn();
    await show(<ProfileCampaignCard card={card()} funding="shown" onOpen={onOpen} />);
    fireEvent.press(screen.getByRole('link', { name: 'Solar Lamp' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ slug: 'solar-lamp', creatorSlug: 'aysel' }));
  });
});

const profile = (overrides: Partial<PublicProfile> = {}): PublicProfile => ({
  slug: 'aysel',
  name: 'Aysel',
  avatarUrl: null,
  bio: 'I make lamps.',
  joinedAt: '2025-03-14T10:00:00Z',
  websiteUrl: 'https://aysel.example',
  location: { slug: 'baku', name: 'Baku' },
  socialLinks: [],
  ...overrides,
});

const A = en.profile.about;

describe('ProfileAbout', () => {
  it('says so when there is no biography', async () => {
    await show(<ProfileAbout profile={profile({ bio: null })} />);
    expect(screen.getByTestId('profile-bio')).toHaveTextContent(A.empty.replace('{name}', 'Aysel'), { exact: false });
    expect(screen.getByText(A.heading.replace('{name}', 'Aysel'))).toBeTruthy();
  });

  it('shows the facts that exist: location as text, the website, the join month', async () => {
    await show(<ProfileAbout profile={profile()} />);
    expect(screen.getByTestId('profile-fact-location')).toHaveTextContent(/Baku/);
    expect(screen.queryByRole('link', { name: /Baku/ })).toBeNull();
    expect(screen.getByTestId('profile-fact-since')).toHaveTextContent(/March 2025/);
    fireEvent.press(screen.getByRole('link', { name: 'https://aysel.example' }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://aysel.example');
  });

  it('hides the website row when there is none', async () => {
    await show(<ProfileAbout profile={profile({ websiteUrl: null })} />);
    expect(screen.queryByTestId('profile-fact-website')).toBeNull();
  });

  it('hides the since row for an unparseable join date', async () => {
    await show(<ProfileAbout profile={profile({ joinedAt: 'soon' })} />);
    expect(screen.queryByTestId('profile-fact-since')).toBeNull();
  });

  it('draws no facts list at all when there are none', async () => {
    await show(<ProfileAbout profile={profile({ websiteUrl: null, location: null, joinedAt: null })} />);
    expect(screen.queryByText(A.basedIn)).toBeNull();
    expect(screen.queryByText(A.since)).toBeNull();
  });

  it('names each social link by platform and address, opens https only, and prints an unknown platform raw', async () => {
    jest.mocked(WebBrowser.openBrowserAsync).mockClear();
    await show(
      <ProfileAbout
        profile={profile({
          socialLinks: [
            { platform: 'GITHUB', url: 'https://github.com/aysel' },
            { platform: 'MASTODON', url: 'https://mastodon.social/@aysel' },
            { platform: 'X', url: 'http://x.com/aysel' },
          ],
        })}
      />,
    );
    expect(screen.getByText(A.elsewhere)).toBeTruthy();
    fireEvent.press(screen.getByRole('link', { name: 'GitHub https://github.com/aysel' }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://github.com/aysel');
    expect(screen.getByRole('link', { name: 'MASTODON https://mastodon.social/@aysel' })).toBeTruthy();

    // Not https: printed, never a link.
    expect(screen.getByTestId('profile-social-X')).toHaveTextContent('X http://x.com/aysel', { exact: false });
    expect(screen.queryByRole('link', { name: /x\.com/ })).toBeNull();
  });
});

describe('CreatorObligationSummary', () => {
  it('draws nothing for a creator who is up to date', async () => {
    await show(<CreatorObligationSummary lapsedCount={0} name="Aysel" />);
    expect(screen.queryByTestId('profile-obligations')).toBeNull();
  });

  it.each(['en', 'az', 'ru', 'tr'] as const)('says one and several apart in %s', async (locale) => {
    await show(<CreatorObligationSummary lapsedCount={1} name="Aysel" />, locale);
    const one = screen.getByTestId('profile-obligations');
    expect(one).toHaveTextContent(/Aysel/);
    expect(one).not.toHaveTextContent(/3/);
    const oneHeading = String(screen.getByRole('header').props.children);
    await cleanup();

    await show(<CreatorObligationSummary lapsedCount={3} name="Aysel" />, locale);
    const several = screen.getByRole('header');
    expect(several).toHaveTextContent(/3/);
    expect(String(several.props.children)).not.toBe(oneHeading);
  });

  it('uses the English words exactly', async () => {
    await show(<CreatorObligationSummary lapsedCount={1} name="Aysel" />);
    expect(screen.getByRole('header')).toHaveTextContent('One campaign is late on updates', { exact: false });
    expect(screen.getByTestId('profile-obligations')).toHaveTextContent(en.profile.obligations.rule, { exact: false });
    await cleanup();
    await show(<CreatorObligationSummary lapsedCount={2} name="Aysel" />);
    expect(screen.getByRole('header')).toHaveTextContent('2 campaigns are late on updates', { exact: false });
    expect(screen.getByTestId('profile-obligations')).toHaveTextContent(
      /2 campaigns by Aysel have gone past the date/,
    );
  });
});
