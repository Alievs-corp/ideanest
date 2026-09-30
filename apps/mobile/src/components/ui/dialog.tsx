import { useRef, type ReactNode, type RefObject } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { X } from 'lucide-react-native';
import { useT } from '../../lib/i18n';
import {
  colors,
  font,
  fontSize,
  lineHeight,
  radius,
  shadow,
  spacing,
  tint,
  tracking,
} from '../../theme';
import { IconButton } from './icon-button';
import { useOverlayEntry, useOverlayFocus } from './overlay';
import { SurfaceProvider, TONES } from './surface';

/**
 * A short confirmation — the native `Dialog`, the web's `Modal` (`docs/ui-kit.md` §7.14).
 *
 * <h2>The one white thing in a dark system</h2>
 *
 * A dialog is the only surface genuinely above the plane, so, as on the web, it takes the floating
 * panel treatment: white, radius 28, `shadow.float` (the token string, through React Native's
 * `boxShadow`), near-black text. It provides `SurfaceProvider surface="white"`, so a `Body`, an
 * `IconButton` or a focus ring inside it switches to its on-white tone by itself — `white/64` on
 * white is invisible, and this is what stops it.
 *
 * <h2>The focus trap, natively</h2>
 *
 * The web traps focus, closes on Escape and locks the page's scroll. Here:
 *
 * <ul>
 *   <li>The panel is `accessibilityViewIsModal` — iOS reads nothing outside it, including the
 *       scrim beside it. React Native's `Modal` is its own window on Android, so TalkBack stays
 *       in it too; the scrim is additionally `importantForAccessibility="no-hide-descendants"`,
 *       so the one sibling inside that window is not a stop either.</li>
 *   <li>On open, focus moves to the title; on close, back to the control that opened it
 *       (`returnFocusTo`). See `overlay.ts`.</li>
 *   <li>Android's back button (`onRequestClose`) and iOS's two-finger scrub
 *       (`onAccessibilityEscape`) dismiss it — the Escape key's job on the web.</li>
 * </ul>
 *
 * <h2>Buttons</h2>
 *
 * On a phone the footer's buttons stack full width, the primary action FIRST — the thumb reaches
 * the top of the stack, and the order a screen reader meets them in is the order of importance.
 * Pass `fullWidth` pills. Note that `Pill`'s `primary` is white and vanishes on this white panel;
 * a dialog's confirming action is `danger` for a destructive one and `accent` for the one urgent
 * one, with `ghost` or `outline` for the way out.
 *
 * <h2>Motion</h2>
 *
 * 200ms of opacity and a 24pt rise on entry, none under Reduce Motion or a `none` budget, and no
 * exit animation at all.
 *
 * <p>Controlled only: whether a confirmation is open is the screen's state.
 *
 * <h2>The keyboard</h2>
 *
 * A confirmation can ask for a word (a reason, a name typed to confirm), so the panel sits in a
 * `KeyboardAvoidingView` — `padding` on iOS, where the keyboard overlays the window; Android
 * resizes the window itself — and the body's `ScrollView` keeps `keyboardShouldPersistTaps` at
 * `handled`, so the first tap on a button under an open keyboard presses the button instead of
 * only closing the keyboard.
 */

export interface DialogProps {
  readonly open: boolean;
  /** Called by the close button, the scrim, Android back and the iOS escape gesture. */
  readonly onClose: () => void;
  /** Required: it is the first thing read, and what the dialog is about. */
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
  /** The actions, stacked full width, primary first. */
  readonly footer?: ReactNode;
  /** Hide the corner X when the footer already has a way out. */
  readonly showClose?: boolean;
  /** Set false when a choice must be made: the scrim then does nothing. */
  readonly dismissOnScrim?: boolean;
  /** The control that opened the dialog, which gets focus back when it closes. */
  readonly returnFocusTo?: RefObject<unknown>;
  /**
   * Called once the modal has actually gone — after it was closed, not at the moment it was.
   *
   * <p>iOS presents one modal view controller at a time. Presenting another — the system photo
   * picker, a share sheet, a second sheet — while this one is still being dismissed fails without
   * an error, so anything that must open AFTER this closes is started here, not beside
   * `onClose`.
   */
  readonly onDismiss?: () => void;
  readonly testID?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  showClose = true,
  dismissOnScrim = true,
  returnFocusTo,
  onDismiss,
  testID,
}: DialogProps) {
  const t = useT('mobile.kitForm');
  const heading = useRef<Text>(null);
  const entry = useOverlayEntry(open);

  useOverlayFocus(open, heading, returnFocusTo);

  const tones = TONES.white;

  const panel = (
    <SurfaceProvider surface="white">
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text
            ref={heading}
            accessibilityRole="header"
            style={[styles.title, { color: tones.primary }]}
          >
            {title}
          </Text>
          {description !== undefined && description !== '' ? (
            <Text style={[styles.description, { color: tones.secondary }]}>{description}</Text>
          ) : null}
        </View>
        {showClose ? (
          <IconButton icon={X} label={t('close')} variant="ghost" size="sm" onPress={onClose} />
        ) : null}
      </View>

      {children !== undefined && children !== null ? (
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : null}

      {footer !== undefined && footer !== null ? <View style={styles.footer}>{footer}</View> : null}
    </SurfaceProvider>
  );

  return (
    <Modal
      visible={open}
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
        <Pressable
          style={styles.scrim}
          onPress={dismissOnScrim ? onClose : undefined}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        {entry.animated ? (
          <Animated.View
            testID={testID}
            accessibilityViewIsModal
            onAccessibilityEscape={onClose}
            style={[styles.panel, entry.style]}
          >
            {panel}
          </Animated.View>
        ) : (
          <View
            testID={testID}
            accessibilityViewIsModal
            onAccessibilityEscape={onClose}
            style={styles.panel}
          >
            {panel}
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const PANEL_PADDING = spacing[6];

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
  },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: tint(colors.black, 0.64),
  },
  panel: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '100%',
    backgroundColor: colors.whiteSurface,
    borderRadius: radius.xl,
    boxShadow: shadow.float,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[4],
    paddingHorizontal: PANEL_PADDING,
    paddingTop: PANEL_PADDING,
    paddingBottom: spacing[4],
  },
  heading: { flex: 1, gap: spacing[1] },
  title: {
    ...font.medium,
    fontSize: fontSize.lg,
    lineHeight: lineHeight.cardTitle,
    letterSpacing: tracking.cardTitle,
  },
  description: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small },
  body: { flexGrow: 0 },
  bodyContent: { paddingHorizontal: PANEL_PADDING, paddingBottom: PANEL_PADDING },
  footer: {
    gap: spacing[2],
    paddingHorizontal: PANEL_PADDING,
    paddingVertical: spacing[4],
    borderTopWidth: 1,
    borderTopColor: tint(colors.black, 0.08),
  },
});
