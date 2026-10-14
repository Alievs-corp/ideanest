import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queries';
import { toneColor } from '../../components/text';
import { Icon, Pill, TONES, announce, useFocusRing, usePressScale, useSurface } from '../../components/ui';
import { FOCUS_DELAY_MS, focusOn } from '../../components/ui/overlay';
import { Glyphs } from '../../icons';
import { useMe } from '../../lib/account';
import { blockFailureOf, isBlocked, setBlocked, type BlockFailure } from '../../lib/blocks';
import { useT } from '../../lib/i18n';
import { useSession } from '../../lib/use-session';
import { colors, font, fontSize, lineHeight, radius, size, spacing } from '../../theme';

/**
 * "Block this account" at the foot of a public profile, under Report — §4.9's C-08, issue #324,
 * the web's `ProfileBlockControl`.
 *
 * <h2>Two readers see nothing</h2>
 *
 * A visitor, who has no blocks to keep, and the account the page is about, which cannot block
 * itself. Nothing is drawn until the service has said whether this reader blocked the account:
 * the control is at the foot of the page, below anything under a finger, so it appearing a
 * moment later moves nothing.
 *
 * <h2>Asked in place</h2>
 *
 * The sentence that matters before pressing — their comments hidden, no replies to yours, they
 * are not told, their campaigns stay visible — and two pills, like Withdraw under a comment.
 * Once blocked the line says so and offers Unblock, so a mistake is undone where it was made.
 * The profile addresses the account by slug, because a profile carries no account id.
 *
 * <p>The answer is written to the shared query, so the foot of every tab agrees, and the ids the
 * Comments tab hides by are read again. What happened is said in a polite live region that is
 * always mounted, and announced on iOS, which has none.
 */
export function ProfileBlock({ slug, offline }: { readonly slug: string; readonly offline: boolean }) {
  const session = useSession();
  const me = useMe();
  const viewer = typeof me.data?.slug === 'string' && me.data.slug !== '' ? me.data.slug : null;
  if (!session.signedIn || viewer === null || viewer === slug) return null;
  // Keyed by the person and the reader, so neither one's state is carried onto the other.
  return <BlockToggle key={`${slug}:${viewer}`} slug={slug} viewer={viewer} offline={offline} />;
}

const FAILURE_KEY = {
  staff: 'failures.staff',
  self: 'failures.self',
  refused: 'failures.refused',
  unreachable: 'failures.unreachable',
} as const satisfies Record<BlockFailure, string>;

function BlockToggle({
  slug,
  viewer,
  offline,
}: {
  readonly slug: string;
  readonly viewer: string;
  readonly offline: boolean;
}) {
  const t = useT('blocking');
  const tAll = useT();
  const client = useQueryClient();
  const surface = useSurface();
  const tone = TONES[surface];
  const key = queryKeys.profileBlocked(slug, viewer);

  const known = useQuery({
    queryKey: key,
    retry: false,
    queryFn: async ({ signal }) => {
      try {
        return await isBlocked(slug, signal);
      } catch {
        // Unread is not "not blocked", but offering Block is safe: it is idempotent, and the
        // service's answer decides what is drawn next.
        return false;
      }
    },
  });

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const warning = useRef<Text>(null);
  const [focusWarning, setFocusWarning] = useState(false);
  const offlineReason = tAll('mobile.blocking.offline');

  useEffect(() => {
    if (!focusWarning) return undefined;
    // After the frame that mounts it: a focus event sent to a view drawn in the same frame is lost.
    const timer = setTimeout(() => {
      focusOn(warning.current);
      setFocusWarning(false);
    }, FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [focusWarning]);

  const say = (message: string) => {
    setNotice(message);
    if (Platform.OS === 'ios') announce(message);
  };

  const change = async (block: boolean) => {
    if (busy || offline) return;
    setBusy(true);
    setNotice(null);
    try {
      const now = await setBlocked(slug, block);
      client.setQueryData(key, now);
      void client.invalidateQueries({ queryKey: queryKeys.blockedIds() });
      void client.invalidateQueries({ queryKey: queryKeys.blockedList() });
      setConfirming(false);
      say(now ? t('blocked') : t('unblocked'));
    } catch (cause) {
      say(t(FAILURE_KEY[blockFailureOf(cause)]));
    } finally {
      setBusy(false);
    }
  };

  if (known.data === undefined) return null;

  return (
    <View style={styles.column} testID="profile-block">
      {known.data ? (
        <View style={styles.row}>
          <Icon icon={Glyphs.Slash} size={16} color={tone.secondary} />
          <Text style={[styles.state, { color: tone.secondary }]} testID="profile-block-state">
            {t('blockedState')}
          </Text>
          <Pill
            label={busy ? t('unblocking') : t('unblock')}
            variant="outline"
            size="sm"
            busy={busy}
            disabled={offline}
            accessibilityHint={offline ? offlineReason : undefined}
            onPress={() => void change(false)}
            testID="profile-unblock"
          />
        </View>
      ) : confirming ? (
        <View
          style={[styles.confirm, { backgroundColor: surface === 'white' ? colors.whiteMuted : colors.surface3 }]}
          testID="profile-block-confirm"
        >
          <Text ref={warning} style={[styles.warning, { color: toneColor('reading', surface) }]}>
            {t('warning')}
          </Text>
          <View style={styles.actions}>
            <Pill
              label={busy ? t('blocking') : t('confirm')}
              size="sm"
              busy={busy}
              disabled={offline}
              accessibilityHint={offline ? offlineReason : undefined}
              onPress={() => void change(true)}
              testID="profile-block-it"
            />
            <Pill label={t('cancel')} variant="outline" size="sm" onPress={() => setConfirming(false)} />
          </View>
        </View>
      ) : (
        <BlockTrigger
          label={t('trigger')}
          disabled={offline}
          hint={offline ? offlineReason : undefined}
          onPress={() => {
            setConfirming(true);
            setFocusWarning(true);
          }}
        />
      )}
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.notice, { color: tone.secondary }]}
        testID="profile-block-notice"
      >
        {notice}
      </Text>
    </View>
  );
}

/** The quiet trigger, matching `ReportTrigger` above it: an icon and the words, a 44pt target. */
function BlockTrigger({
  label,
  disabled,
  hint,
  onPress,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly hint: string | undefined;
  readonly onPress: () => void;
}) {
  const { ring, onFocus, onBlur } = useFocusRing();
  const press = usePressScale();
  const tone = TONES[useSurface()];
  return (
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onFocus={onFocus}
        onBlur={onBlur}
        hitSlop={{ top: REACH, bottom: REACH }}
        style={[styles.link, disabled && styles.disabled, ring]}
        testID="profile-block-trigger"
      >
        <Icon icon={Glyphs.Slash} size={16} color={tone.secondary} />
        <Text style={[styles.label, { color: tone.secondary }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/** The hit area's reach above and below a one-line link, to the 44pt minimum. */
const REACH = Math.max(0, (size.touchTarget - lineHeight.small) / 2);

const styles = StyleSheet.create({
  column: { gap: spacing[2], alignItems: 'flex-start' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[2] },
  state: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small },
  link: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], borderRadius: radius.sm },
  disabled: { opacity: 0.4 },
  label: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small },
  // A block nested in the sheet: one step off the sheet's own fill, never a border-only box.
  confirm: { alignSelf: 'stretch', gap: spacing[3], padding: spacing[4], borderRadius: radius.lg },
  warning: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[3] },
  notice: { ...font.regular, fontSize: fontSize.xs, lineHeight: lineHeight.small },
});
