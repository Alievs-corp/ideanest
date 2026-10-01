import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowUpRight } from 'lucide-react-native';
import type { CampaignCreator } from '../../../../lib/campaign-page';
import { formatDay, useT } from '../../../../lib/i18n';
import { useLocale } from '../../../../lib/locale';
import {
  colors,
  font,
  fontSize,
  lineHeight,
  radius,
  size,
  spacing,
} from '../../../../theme';
import { Avatar, Icon, useFocusRing } from '../../../ui';
import { entryText } from '../shared/tab-section';
import type { CreatorProfile, CreatorProject } from './creator-profile';

/**
 * The Creator tab's two blocks — the web's `CreatorPanel` (#155).
 *
 * <p>`CreatorAbout`: a 56pt round avatar (decorative — the name is beside it), the name, "Member
 * since {day}" and the biography. `CreatorCampaigns`: "Their other campaigns", up to six rows that
 * each open that campaign, then "See everything {name} has made".
 *
 * <p>Each row is omitted when the field behind it is absent, as on the web: no biography box for
 * a creator who has not written one, and nothing at all — not "no previous campaigns" — for a
 * creator on their first, because printing the absence of a track record beside a campaign
 * asking for money turns it into a sentence about them.
 *
 * <p>The web's Follow control is not here: following a creator from the app is #156's profile
 * screen's, and this tab links to it.
 */

/**
 * The words `campaign.state` has, so a campaign is called the same thing here as on its own page.
 * A closed list: `state` is an open string, and one with no word is drawn without one rather than
 * as its enum.
 */
const STATE_WORDS = [
  'PRELAUNCH',
  'LIVE',
  'SUCCESSFUL',
  'COLLECTING',
  'LATE_PLEDGE',
  'FULFILLING',
  'COMPLETED',
  'UNSUCCESSFUL',
  'CANCELED',
  'CLOSING_WINDOW',
  'EXTENDED',
  'WITHDRAWN',
] as const;
type StateWord = (typeof STATE_WORDS)[number];

function isStateWord(state: string): state is StateWord {
  return (STATE_WORDS as readonly string[]).includes(state);
}

/**
 * The heading, the face, the name and the biography.
 *
 * <p>`profile` is `null` while it could not be read — refused, private, unreachable — and the
 * campaign's own `creator` is then the whole of it: the name and avatar the header already shows,
 * with no link and no explanation (`./creator-profile.ts` says why there is none).
 */
export function CreatorAbout({
  creator,
  profile,
}: {
  readonly creator: CampaignCreator;
  readonly profile: CreatorProfile | null;
}) {
  const t = useT('campaign.creator');
  const locale = useLocale();
  const router = useRouter();

  // The campaign's own fields are the fallback: they came with the page and are true whatever
  // the profile endpoint says.
  const name = profile?.name ?? creator.name;
  const avatarUrl = profile?.avatarUrl ?? creator.avatarUrl;
  const joined = formatDay(profile?.joinedAt ?? null, locale);

  return (
    <View style={styles.about} testID="creator-about">
      <Text accessibilityRole="header" style={styles.heading}>
        {t('heading')}
      </Text>

      <View style={styles.identity}>
        <Avatar name={name} src={avatarUrl} size="lg" decorative testID="creator-avatar" />
        <View style={styles.names}>
          {profile === null ? (
            <Text style={styles.name} testID="creator-name">
              {name}
            </Text>
          ) : (
            <Link
              label={name}
              onPress={() =>
                router.push({ pathname: '/u/[slug]', params: { slug: profile.slug } })
              }
              testID="creator-name"
            >
              <View style={styles.nameLink}>
                <Text style={styles.name}>{name}</Text>
                <Icon icon={ArrowUpRight} size={16} color={colors.textPrimary} />
              </View>
            </Link>
          )}
          {joined === null ? null : (
            <Text style={styles.since} testID="creator-member-since">
              {/* A tag rather than `{date}`: Azerbaijani and Turkish put the day first. */}
              {t.rich('memberSince', { date: () => joined })}
            </Text>
          )}
        </View>
      </View>

      {profile?.bio == null ? null : (
        <Text style={entryText.body} testID="creator-bio">
          {profile.bio}
        </Text>
      )}
    </View>
  );
}

/**
 * "Their other campaigns": one link row each — the title, two lines of the blurb and the state as
 * a word (never as a colour) — then the way to everything else on the creator's profile. Nothing
 * at all when there are none. The link to the profile is offered only when the profile was read:
 * a private one has no page to go to.
 */
export function CreatorCampaigns({
  projects,
  profile,
}: {
  readonly projects: readonly CreatorProject[];
  readonly profile: CreatorProfile | null;
}) {
  const t = useT('campaign.creator');
  const states = useT('campaign.state');
  const router = useRouter();

  return (
    <View style={styles.others} testID="creator-others">
      <Text accessibilityRole="header" style={styles.subheading}>
        {t('others')}
      </Text>
      <View style={styles.rows}>
        {projects.map((project) => (
          <CampaignRow
            key={project.id}
            project={project}
            word={isStateWord(project.state) ? states(project.state) : null}
            onPress={() =>
              router.push({
                pathname: '/projects/[creatorSlug]/[projectSlug]',
                params: { creatorSlug: project.creatorSlug, projectSlug: project.slug },
              })
            }
          />
        ))}
      </View>
      {profile === null ? null : (
        <Link
          label={t('seeAll', { name: profile.name })}
          onPress={() => router.push({ pathname: '/u/[slug]', params: { slug: profile.slug } })}
          testID="creator-see-all"
        >
          <Text style={styles.seeAll}>{t('seeAll', { name: profile.name })}</Text>
        </Link>
      )}
    </View>
  );
}

function CampaignRow({
  project,
  word,
  onPress,
}: {
  readonly project: CreatorProject;
  readonly word: string | null;
  readonly onPress: () => void;
}) {
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed, ring]}
      testID={`creator-project-${project.id}`}
    >
      <Text style={styles.rowTitle}>{project.title}</Text>
      {project.blurb === null ? null : (
        <Text style={styles.rowBlurb} numberOfLines={2}>
          {project.blurb}
        </Text>
      )}
      {word === null ? null : <Text style={styles.rowState}>{word}</Text>}
    </Pressable>
  );
}

/**
 * Words that navigate: at least 44pt tall however small they are (a minimum, so Dynamic Type grows
 * it rather than clipping), the kit's focus ring, and one accessible name — the words themselves.
 */
function Link({
  label,
  onPress,
  children,
  testID,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      style={({ pressed }) => [styles.link, pressed && styles.linkPressed, ring]}
      testID={testID}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {children}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The web's `gap-4` inside the block, and the Campaign tab's 32 above it.
  about: { gap: spacing[4], paddingTop: spacing[8] },
  heading: {
    ...font.medium,
    fontSize: fontSize.h3,
    lineHeight: lineHeight.h3,
    color: colors.textPrimary,
  },
  identity: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[4] },
  names: { flex: 1, gap: spacing[1] },
  nameLink: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  name: {
    ...font.medium,
    flexShrink: 1,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
    color: colors.textPrimary,
  },
  since: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
  },
  // The web's `gap-8` between the two blocks, and `gap-4` inside this one.
  others: { gap: spacing[4], paddingTop: spacing[8] },
  subheading: {
    ...font.medium,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
    color: colors.textPrimary,
  },
  rows: { gap: spacing[2] },
  row: {
    gap: spacing[1],
    minHeight: size.touchTarget,
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  rowPressed: { backgroundColor: colors.surface3 },
  rowTitle: {
    ...font.medium,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textPrimary,
  },
  rowBlurb: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
  },
  rowState: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
    color: colors.textTertiary,
  },
  link: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: size.touchTarget,
    borderRadius: radius.sm,
  },
  linkPressed: { opacity: 0.64 },
  seeAll: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },
});
