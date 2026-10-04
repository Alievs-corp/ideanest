import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Glyphs } from '../../icons';
import type { ReportTarget } from '@ideanest/campaign/report';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, size, spacing, tint } from '../../theme';
import { Icon, TONES, useFocusRing, usePressScale, useSurface } from '../ui';
import { ReportSheet } from './report-sheet';

/**
 * Block 14 — "Report this campaign" at the foot of the page (#155), the web's `ReportControl` with
 * a campaign target, and the same control under each comment.
 *
 * <p>Under the rewards on every tab, after a thin rule that is the link's own (so the page does
 * not end on a rule over nothing). The link is the web's: a Flag and the whole phrase
 * `moderation.report.triggerOn.campaign`, quiet in the surface's secondary tone because it is not
 * an action the page is asking for — on the dark canvas or inside the white content sheet, which
 * the page draws it in. It gives under the thumb (`usePressScale`). Pressing it opens the report
 * sheet (`./report-sheet.tsx`) about this campaign, titled with its name.
 *
 * <p>Offline the link is disabled and says why — under it, and as its hint — as Save and Remind
 * do: a report needs the service, and a sheet that could only fail at the last step is worse than
 * a control that says so first.
 */
export interface ReportLinkProps {
  readonly projectId: string;
  readonly title: string;
  readonly offline: boolean;
}

export function ReportLink({ projectId, title, offline }: ReportLinkProps) {
  const onWhite = useSurface() === 'white';
  return (
    <View
      style={[styles.foot, { borderTopColor: onWhite ? tint(colors.black, 0.08) : colors.divider }]}
      testID="report-link"
    >
      <ReportTrigger target={{ kind: 'campaign', id: projectId }} name={title} offline={offline} />
    </View>
  );
}

/**
 * The trigger and its sheet, for any target: the campaign at the foot of the page, a comment under
 * the comment (`name` is then `moderation.report.commentOn` filled with the campaign's title). The
 * phrase is the catalogue's whole sentence per kind — "Report this campaign", "Report this
 * comment" — never a noun dropped into a template, which the other three languages cannot decline.
 */
export function ReportTrigger({
  target,
  name,
  offline,
  showsOfflineReason = true,
}: {
  readonly target: ReportTarget;
  readonly name: string;
  readonly offline: boolean;
  /**
   * Whether the offline reason is drawn under the trigger as well as given as its hint. Off under
   * each comment, where the tab's own line already says that reporting needs a connection and the
   * same sentence under every comment would be noise.
   */
  readonly showsOfflineReason?: boolean;
}) {
  const t = useT('moderation.report');
  const tAll = useT();
  const [open, setOpen] = useState(false);
  const trigger = useRef<View>(null);
  const { ring, onFocus, onBlur } = useFocusRing();
  const press = usePressScale();
  const tone = TONES[useSurface()];
  const offlineReason = tAll('mobile.campaign.report.offline');
  const label = t(`triggerOn.${target.kind}`);

  return (
    <View style={styles.column}>
      {/* The scale is on a wrapper so the ref stays on the Pressable that `returnFocusTo` needs. */}
      <Animated.View style={press.style}>
        <Pressable
          ref={trigger}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={offline ? offlineReason : undefined}
          accessibilityState={{ disabled: offline }}
          disabled={offline}
          onPress={() => setOpen(true)}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          onFocus={onFocus}
          onBlur={onBlur}
          hitSlop={{ top: REACH, bottom: REACH }}
          style={[styles.link, offline && styles.disabled, ring]}
          testID={`report-trigger-${target.kind}`}
        >
          <Icon icon={Glyphs.Flag} size={16} color={tone.secondary} />
          <Text style={[styles.label, { color: tone.secondary }]}>{label}</Text>
        </Pressable>
      </Animated.View>
      {offline && showsOfflineReason ? (
        <Text style={[styles.offline, { color: tone.secondary }]}>{offlineReason}</Text>
      ) : null}
      <ReportSheet
        visible={open}
        onClose={() => setOpen(false)}
        target={target}
        name={name}
        offline={offline}
        returnFocusTo={trigger}
      />
    </View>
  );
}

/** The hit area's reach above and below a one-line link, to the 44pt minimum. */
const REACH = Math.max(0, (size.touchTarget - lineHeight.small) / 2);

const styles = StyleSheet.create({
  foot: {
    paddingTop: spacing[6],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  column: { gap: spacing[1], alignItems: 'flex-start' },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: radius.sm,
  },
  // The kit's disabled control: a row that cannot be pressed reads as one.
  disabled: { opacity: 0.4 },
  label: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
  },
  offline: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
  },
});
