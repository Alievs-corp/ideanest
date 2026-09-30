import { useContext, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useT } from '../../lib/i18n';
import {
  colors,
  font,
  fontSize,
  lineHeight,
  motion,
  radius,
  size as measure,
  spacing,
  tint,
  tracking,
} from '../../theme';
import { useFocusRing } from './focus';
import { IconButton } from './icon-button';
import { useMotionAllowed } from './motion-budget';
import { useOverlayEntry, useOverlayFocus } from './overlay';

/**
 * A bottom sheet for a TRANSIENT picker — `Select`'s options, `FilePicker`'s two sources, the
 * WhatsApp form. The native half of the web's bottom `Drawer` (`docs/ui-kit.md` §7.14).
 *
 * <h2>A sheet is not a place</h2>
 *
 * Drawers that are places — the editor's panels, filters, version history — are Expo Router
 * routes with `presentation: 'formSheet'` (issue #151): native drag-to-dismiss, native modality
 * for VoiceOver and TalkBack, and a back stack. This component is for the choice that is made
 * and gone: it has no route, because nobody navigates back to a list of currencies.
 *
 * <h2>Shape</h2>
 *
 * The web's bottom drawer: `--surface-2`, a top radius of 28, at most 85% of the screen, a title
 * and a close `IconButton`, a scrolling body and an optional footer. It stays dark, as every
 * overlay but the dialog does: it belongs to the screen rather than interrupting it. The scrim is
 * black at 64%, derived from the token.
 *
 * <h2>Closing, every way</h2>
 *
 * The X; the scrim; Android's back button (`onRequestClose`); iOS's two-finger scrub
 * (`onAccessibilityEscape`); dragging the header down; and the grab handle, which is a named
 * button ("Drag handle — closes the panel"), because a drag is a gesture a screen-reader user
 * cannot make and the handle must still do what it looks like it does.
 *
 * <p>The drag is React Native's `PanResponder` rather than `react-native-gesture-handler`: the
 * handler's gesture detectors need its native module, which the test environment does not
 * provide and this kit may not mock, and a pan on a sheet's header is the one thing the built-in
 * responder does as well as the library.
 *
 * <p>Focus moves to the title on open and back to `returnFocusTo` on close, as the dialog's does.
 * Entry is the overlay's 200ms rise, only where motion is allowed; there is no exit animation.
 */

export interface SheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** The sheet's heading, and the first thing read when it opens. */
  readonly title: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  /** The control that opened the sheet, which gets focus back when it closes. */
  readonly returnFocusTo?: RefObject<unknown>;
  readonly testID?: string;
}

/** How far the header has to be pulled down before letting go closes the sheet. */
const DISMISS_DISTANCE = 96;
/** Or how fast, in points per millisecond: a flick closes it from a shorter pull. */
const DISMISS_VELOCITY = 1;

export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
  returnFocusTo,
  testID,
}: SheetProps) {
  const t = useT('mobile.kitForm');
  const heading = useRef<Text>(null);
  const entry = useOverlayEntry(visible);
  const settles = useMotionAllowed('minimal');
  // The context rather than the hook: a sheet rendered outside a provider (a test, a story) gets
  // no insets instead of throwing.
  const insets = useContext(SafeAreaInsetsContext);
  const handleRing = useFocusRing();

  useOverlayFocus(visible, heading, returnFocusTo);

  const drag = useSharedValue(0);
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value }] }));

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Claimed only by a mostly vertical, downward move: a tap still reaches the X and the
        // handle, and a sideways swipe is not a dismissal.
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          // Follows the finger — direct manipulation, not an animation, so it survives Reduce
          // Motion. Upward is clamped: the sheet is already as tall as it gets.
          drag.value = Math.max(0, gesture.dy);
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY) {
            drag.value = 0;
            onClose();
            return;
          }
          drag.value = settles ? withTiming(0, { duration: motion.fast }) : 0;
        },
        onPanResponderTerminate: () => {
          drag.value = 0;
        },
      }),
    [drag, onClose, settles],
  );

  const body = (
    <>
      <View {...pan.panHandlers} style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('grabber')}
          accessibilityHint={t('grabberHint')}
          onPress={onClose}
          onFocus={handleRing.onFocus}
          onBlur={handleRing.onBlur}
          hitSlop={{ top: HANDLE_SLOP, bottom: HANDLE_SLOP }}
          style={[styles.handleTarget, handleRing.ring]}
        >
          <View style={styles.handle} />
        </Pressable>
        <View style={styles.titleRow}>
          <Text ref={heading} accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <IconButton icon={X} label={t('close')} variant="ghost" size="sm" onPress={onClose} />
        </View>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {children}
      </ScrollView>

      {footer !== undefined && footer !== null ? <View style={styles.footer}>{footer}</View> : null}
    </>
  );

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.scrim}
          onPress={onClose}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <Animated.View
          testID={testID}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={[
            styles.panel,
            { paddingBottom: Math.max(insets?.bottom ?? 0, spacing[4]) },
            dragStyle,
          ]}
        >
          {entry.animated ? (
            <Animated.View style={[styles.fill, entry.style]}>{body}</Animated.View>
          ) : (
            <View style={styles.fill}>{body}</View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const HANDLE_TARGET_HEIGHT = 24;
const HANDLE_SLOP = (measure.touchTarget - HANDLE_TARGET_HEIGHT) / 2;

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: tint(colors.black, 0.64),
  },
  panel: {
    maxHeight: '85%',
    backgroundColor: colors.surface2,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  fill: { flexShrink: 1 },
  header: { paddingHorizontal: spacing[5] },
  handleTarget: {
    alignSelf: 'center',
    width: 88,
    height: HANDLE_TARGET_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.borderStrong,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
    paddingBottom: spacing[3],
  },
  title: {
    flex: 1,
    ...font.medium,
    color: colors.textPrimary,
    fontSize: fontSize.lg,
    lineHeight: lineHeight.cardTitle,
    letterSpacing: tracking.cardTitle,
  },
  body: { flexGrow: 0 },
  bodyContent: { paddingHorizontal: spacing[5], paddingBottom: spacing[4] },
  footer: {
    gap: spacing[2],
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
});
