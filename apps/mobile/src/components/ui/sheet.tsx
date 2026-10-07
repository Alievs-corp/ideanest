import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Glyphs } from '../../icons';
import { useT } from '../../lib/i18n';
import {
  colors,
  font,
  fontSize,
  lineHeight,
  radius,
  size as measure,
  spacing,
  spring,
  tint,
  tracking,
} from '../../theme';
import { useHeldWhileShut } from '../../lib/app-lock';
import { useFocusRing } from './focus';
import { IconButton } from './icon-button';
import { useMotionAllowed } from './motion-budget';
import { OverlayHostContext, useHostLift, useOverlayFocus } from './overlay';
import { SurfaceProvider, TONES } from './surface';

/**
 * A bottom sheet for a TRANSIENT picker or form — `Select`'s options, `FilePicker`'s two sources,
 * the WhatsApp form. Issues #151, #277 and #282, `mobile-design` skill §2 and §6.3.
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
 * The skill's white sheet: `whiteSurface`, a top radius of `radius.xl`, a grabber, at most 85% of
 * the screen, a title and a close `IconButton`, a scrolling body and an optional footer, over a
 * black/64 scrim. It is always white (#282 retired the earlier dark panel): what it holds reads in
 * the white surface's tones, through `SurfaceProvider`.
 *
 * <h2>Motion</h2>
 *
 * It rises from its own height on `spring.sheet` while the scrim fades in, and falls back the same
 * way when closed: the modal stays mounted until the fall ends, so `onDismiss` still means "gone",
 * but from the moment it is closed nothing in it takes a touch or reaches a screen reader.
 * Under a {@link SheetHost} the page behind scales to 0.96 as the sheet rises. A drag on the header
 * follows the finger — direct manipulation, so it survives Reduce Motion — and on release the
 * distance or the velocity decides: past either, it closes; short of both, it springs back. With
 * Reduce Motion on, it appears and goes at once.
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
 * provide, and a pan on a sheet's header is the one thing the built-in responder does as well.
 *
 * <p>Focus moves to the title on open and back to `returnFocusTo` on close, as the dialog's does.
 *
 * <h2>The keyboard</h2>
 *
 * The panel sits in a `KeyboardAvoidingView` — `padding` on iOS, where the keyboard overlays the
 * window; Android resizes the window itself — and the body keeps `keyboardShouldPersistTaps` at
 * `handled`, so the first tap on a button under an open keyboard presses the button. The footer's
 * controls sit above the bottom safe area.
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
  /**
   * Called once the modal has actually gone — after it was closed and its fall ended.
   *
   * <p>iOS presents one modal view controller at a time. Presenting another — the system photo
   * picker, a share sheet, a second sheet — while this one is still being dismissed fails without
   * an error, so anything that must open AFTER this closes is started here, not beside
   * `onClose`.
   */
  readonly onDismiss?: () => void;
  readonly testID?: string;
}

/** How far the header has to be pulled down before letting go closes the sheet. */
const DISMISS_DISTANCE = 96;
/** Or how fast, in points per millisecond: a flick closes it from a shorter pull. */
const DISMISS_VELOCITY = 1;

/** Whether letting go of a drag closes the sheet: far enough, or fast enough. */
export function dragDismisses(distance: number, velocity: number): boolean {
  return distance > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY;
}

/** The page behind, at full rise. */
export const SHEET_PAGE_SCALE = 0.96;

/** How far up the sheet is, 0 (gone) to 1 (fully risen), from its offset and its height. */
export function sheetRise(offset: number, travel: number): number {
  'worklet';
  return travel > 0 ? Math.max(0, Math.min(1, 1 - offset / travel)) : 0;
}

/** The page behind's scale at a given rise. */
export function pageScale(rise: number): number {
  'worklet';
  return 1 - (1 - SHEET_PAGE_SCALE) * rise;
}

/**
 * The page a sheet (or a dialog) rises over. Wrap the app's content once; an overlay open anywhere
 * under it scales the page to {@link SHEET_PAGE_SCALE} in step with its rise. Transform only.
 */
export function SheetHost({ children }: { readonly children: ReactNode }) {
  const lift = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: pageScale(lift.value) }],
  }));
  return (
    <OverlayHostContext.Provider value={lift}>
      <Animated.View style={[styles.host, style]}>{children}</Animated.View>
    </OverlayHostContext.Provider>
  );
}

export function Sheet({
  visible: requested,
  onClose,
  title,
  children,
  footer,
  returnFocusTo,
  onDismiss,
  testID,
}: SheetProps) {
  // Held while the app lock is shut: a window opened behind it would sit above it (#319).
  const visible = useHeldWhileShut(requested);
  const t = useT('mobile.kitForm');
  const heading = useRef<Text>(null);
  const moves = useMotionAllowed('minimal');
  const window = useWindowDimensions();
  // The context rather than the hook: a sheet rendered outside a provider (a test, a story) gets
  // no insets instead of throwing.
  const insets = useContext(SafeAreaInsetsContext);
  const handleRing = useFocusRing();

  const [mounted, setMounted] = useState(visible);
  // Focus goes back to the opener once the modal has gone: a window still presented swallows it.
  useOverlayFocus(visible || mounted, heading, returnFocusTo);
  const shown = useRef(visible);
  const active = useSharedValue(visible);
  const travel = useSharedValue(window.height);
  const offset = useSharedValue(moves ? window.height : 0);
  const rise = useDerivedValue(() => sheetRise(offset.value, travel.value));
  const host = useHostLift(rise, active);

  useEffect(() => {
    if (visible) {
      const wasShown = shown.current;
      shown.current = true;
      active.value = true;
      setMounted(true);
      if (moves) {
        // Reopened while it was still falling: rise from where it is, not from the bottom.
        if (!wasShown) offset.value = travel.value;
        offset.value = withSpring(0, spring.sheet);
      } else {
        offset.value = 0;
      }
      return;
    }
    const gone = () => {
      shown.current = false;
      setMounted(false);
    };
    if (!moves) {
      offset.value = travel.value;
      if (host !== null && active.value) host.value = 0;
      active.value = false;
      gone();
      return;
    }
    offset.value = withSpring(travel.value, spring.sheet, (finished) => {
      if (finished === true) {
        active.value = false;
        runOnJS(gone)();
      }
    });
  }, [visible, moves, offset, travel, active, host]);

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: rise.value }));

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Claimed only by a mostly vertical, downward move: a tap still reaches the X and the
        // handle, and a sideways swipe is not a dismissal.
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          // Upward is clamped: the sheet is already as tall as it gets.
          offset.value = Math.max(0, gesture.dy);
        },
        onPanResponderRelease: (_, gesture) => {
          if (dragDismisses(gesture.dy, gesture.vy)) {
            onClose();
            return;
          }
          offset.value = moves ? withSpring(0, { ...spring.sheet, velocity: gesture.vy * 1000 }) : 0;
        },
        onPanResponderTerminate: () => {
          offset.value = moves ? withSpring(0, spring.sheet) : 0;
        },
      }),
    [offset, onClose, moves],
  );

  const tones = TONES.white;

  return (
    <Modal
      visible={mounted}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Animated.View style={[styles.scrim, scrimStyle]} pointerEvents={visible ? 'box-none' : 'none'}>
          <Pressable
            style={styles.fill}
            onPress={onClose}
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            testID={testID === undefined ? undefined : `${testID}-scrim`}
          />
        </Animated.View>
        <Animated.View
          testID={testID}
          accessibilityViewIsModal={visible}
          accessibilityElementsHidden={!visible}
          importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
          pointerEvents={visible ? 'auto' : 'none'}
          onAccessibilityEscape={onClose}
          onLayout={(event) => {
            travel.value = event.nativeEvent.layout.height;
          }}
          style={[
            styles.panel,
            { paddingBottom: Math.max(insets?.bottom ?? 0, spacing[4]) },
            panelStyle,
          ]}
        >
          <SurfaceProvider surface="white">
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
                <Text ref={heading} accessibilityRole="header" style={[styles.title, { color: tones.primary }]}>
                  {title}
                </Text>
                <IconButton icon={Glyphs.Close} label={t('close')} variant="ghost" size="sm" onPress={onClose} />
              </View>
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>

            {footer !== undefined && footer !== null ? (
              <View style={styles.footer}>{footer}</View>
            ) : null}
          </SurfaceProvider>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const HANDLE_TARGET_HEIGHT = 24;
const HANDLE_SLOP = (measure.touchTarget - HANDLE_TARGET_HEIGHT) / 2;

const styles = StyleSheet.create({
  host: { flex: 1 },
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: tint(colors.black, 0.64),
  },
  fill: { flex: 1 },
  panel: {
    maxHeight: '85%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.whiteSurface,
  },
  header: { paddingHorizontal: spacing[5] },
  handleTarget: {
    alignSelf: 'center',
    width: 88,
    height: HANDLE_TARGET_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  handle: { width: 36, height: 4, borderRadius: radius.full, backgroundColor: TONES.white.tertiary },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
    paddingBottom: spacing[3],
  },
  title: {
    flex: 1,
    ...font.medium,
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
    borderTopColor: tint(colors.black, 0.08),
  },
});
