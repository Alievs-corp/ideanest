import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { accent as accents, colors, font, fontSize, radius, spacing, type Accent } from '../../theme';
import { Avatar, type AvatarSize } from './avatar';
import { TONES, useSurface } from './surface';

/**
 * Overlapping avatars and source dots — issue #277, `mobile-design` skill §2.
 *
 * `AvatarStack` draws at most three faces and a `+N` pill for the rest, and is ONE element to a
 * screen reader, named by `label` ("128 backers"): reading three names and "+125" says less than
 * the sentence does.
 *
 * `SourceDot` puts a small accent dot on a child's corner — an avatar tied to its card or category
 * — and always writes `label` beside it, because colour alone never carries meaning.
 */

export interface StackPerson {
  readonly name: string;
  readonly src?: string | null;
}

export interface AvatarStackProps {
  readonly people: readonly StackPerson[];
  /** How many there are in all, when `people` is only the first few. Defaults to its length. */
  readonly total?: number;
  /** The group's accessible name. Required: the faces alone name nobody. */
  readonly label: string;
  readonly size?: Extract<AvatarSize, 'xs' | 'sm' | 'md'>;
  readonly testID?: string;
}

export const AVATAR_STACK_MAX = 3;

const SIDE = { xs: 24, sm: 28, md: 40 } as const;

export function AvatarStack({ people, total = people.length, label, size = 'sm', testID }: AvatarStackProps) {
  const surface = useSurface();
  const shown = people.slice(0, AVATAR_STACK_MAX);
  const rest = Math.max(0, total - shown.length);
  const side = SIDE[size];
  const overlap = -Math.round(side / 3);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      testID={testID}
      style={styles.row}
    >
      {shown.map((person, index) => (
        <View key={`${index}-${person.name}`} style={index === 0 ? undefined : { marginLeft: overlap }}>
          <Avatar name={person.name} src={person.src} size={size} decorative />
        </View>
      ))}
      {rest > 0 ? (
        <View
          style={[
            styles.more,
            { height: side, minWidth: side, marginLeft: shown.length > 0 ? overlap : 0 },
            surface === 'dark' ? styles.moreOnDark : styles.moreOnWhite,
          ]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={[styles.moreText, { color: TONES[surface].primary }]} maxFontSizeMultiplier={1}>
            {`+${rest}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export interface SourceDotProps {
  readonly accent: Accent;
  /** Written beside the dot. Required: the dot's colour is never the only signal. */
  readonly label: string;
  readonly children: ReactNode;
  readonly testID?: string;
}

const DOT = 10;

export function SourceDot({ accent, label, children, testID }: SourceDotProps) {
  const surface = useSurface();
  return (
    <View style={styles.source} testID={testID}>
      <View>
        {children}
        <View
          style={[
            styles.dot,
            {
              backgroundColor: accents[accent].surface,
              borderColor: surface === 'dark' ? colors.surface1 : colors.whiteSurface,
            },
          ]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID={testID === undefined ? undefined : `${testID}-dot`}
        />
      </View>
      <Text style={[styles.sourceLabel, { color: TONES[surface].secondary }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  more: {
    paddingHorizontal: spacing[2],
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    outlineWidth: 2,
    outlineStyle: 'solid',
  },
  moreOnDark: { backgroundColor: colors.surface3, outlineColor: colors.surface1 },
  moreOnWhite: { backgroundColor: colors.whiteMuted, outlineColor: colors.whiteSurface },
  moreText: { ...font.medium, fontSize: fontSize.xxs },
  source: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  dot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: DOT,
    height: DOT,
    borderRadius: radius.full,
    borderWidth: 2,
  },
  sourceLabel: { ...font.regular, fontSize: fontSize.caption, flexShrink: 1 },
});
