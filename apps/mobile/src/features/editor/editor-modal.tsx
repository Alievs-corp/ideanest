import { useState, type ReactNode } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Dialog, MotionBudgetProvider, Pill, useReducedMotion } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, spacing } from '../../theme';
import { useEditorChromeCopy } from './translator';

/**
 * The web's `EditorDrawer`, as a phone's full-screen editor (#162): an item, a reward, a
 * question. A page sheet on iOS, full screen on Android, with Cancel on the left and Save on the
 * right of its own header, and the title on one line between them — at a large font it shrinks a
 * little and then truncates, and the full title stays its accessible name.
 *
 * <h2>Contract</h2>
 *
 * <ul>
 *   <li>`visible`, `title` (and an optional `description` under the header), `children` (the
 *       form, scrolled, keyboard-aware).</li>
 *   <li>`dirty` — the form differs from what was opened. `saving` — the save is in flight.</li>
 *   <li>`onSave` — Save was pressed. The caller saves, then closes it (sets `visible` false).</li>
 *   <li>`onClose` — the modal should close with nothing saved: Cancel, Android back or a swipe
 *       with nothing to lose, or "Discard" confirmed. The caller sets `visible` false.</li>
 * </ul>
 *
 * <p>While saving, nothing closes it — Cancel is disabled, back and the swipe do nothing — because
 * the answer still has to land and the creator must be able to see whether it did. While dirty,
 * the swipe is disabled and Cancel or back asks "Discard changes?" in a white dialog first. Save
 * is the kit's white primary, never lime. The words are the frame's (`drawer.cancel`, `save`,
 * `saving`) and `mobile.editor.discard.*`.
 *
 * <p>Motion: the platform's own modal presentation (a stack transition), none under Reduce Motion.
 */
export interface EditorModalProps {
  readonly visible: boolean;
  readonly title: string;
  readonly description?: string;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly onSave: () => void;
  readonly onClose: () => void;
  /** Disables Save — the form has nothing valid to send yet. Saving disables it too. */
  readonly saveDisabled?: boolean;
  readonly children: ReactNode;
  readonly testID?: string;
}

export function EditorModal({
  visible,
  title,
  description,
  dirty,
  saving,
  onSave,
  onClose,
  saveDisabled = false,
  children,
  testID = 'editor-modal',
}: EditorModalProps) {
  const chrome = useEditorChromeCopy();
  const t = useT('mobile.editor.discard');
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [confirming, setConfirming] = useState(false);

  /** Cancel, Android back, the iOS swipe: what each may do depends on what would be lost. */
  function requestClose(): void {
    if (saving) return;
    if (dirty) {
      setConfirming(true);
      return;
    }
    onClose();
  }

  return (
    <Modal
      visible={visible}
      animationType={reduced ? 'none' : 'slide'}
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      allowSwipeDismissal={!dirty && !saving}
      onRequestClose={requestClose}
      statusBarTranslucent
    >
      <MotionBudgetProvider level="none">
        <View style={styles.root} testID={testID}>
          <View style={[styles.header, { paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + spacing[3] }]}>
            <Pill
              label={chrome.drawer.cancel}
              variant="ghost"
              size="sm"
              disabled={saving}
              onPress={requestClose}
              testID={`${testID}-cancel`}
            />
            {/* One line between the two pills: shrunk a little at a large font, then ellipsised. The
                full title is still its accessible name. */}
            <Text
              style={styles.title}
              accessibilityRole="header"
              accessibilityLabel={title}
              numberOfLines={1}
              ellipsizeMode="tail"
              adjustsFontSizeToFit
              minimumFontScale={TITLE_MIN_SCALE}
              testID={`${testID}-title`}
            >
              {title}
            </Text>
            <Pill
              label={saving ? chrome.drawer.saving : chrome.drawer.save}
              size="sm"
              busy={saving}
              disabled={saving || saveDisabled}
              onPress={onSave}
              testID={`${testID}-save`}
            />
          </View>
          <ScrollView
            style={styles.body}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing[8] }]}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          >
            {description === undefined || description === '' ? null : (
              <Text style={styles.description}>{description}</Text>
            )}
            {children}
          </ScrollView>

          <Dialog
            open={confirming}
            onClose={() => setConfirming(false)}
            title={t('title')}
            description={t('body')}
            showClose={false}
            testID={`${testID}-discard`}
            footer={
              <>
                <Pill
                  label={t('confirm')}
                  variant="danger"
                  fullWidth
                  wrap
                  onPress={() => {
                    setConfirming(false);
                    onClose();
                  }}
                  testID={`${testID}-discard-confirm`}
                />
                <Pill
                  label={t('keep')}
                  variant="ghost"
                  fullWidth
                  wrap
                  onPress={() => setConfirming(false)}
                  testID={`${testID}-discard-keep`}
                />
              </>
            }
          />
        </View>
      </MotionBudgetProvider>
    </Modal>
  );
}

/** How far the header title may shrink to stay on one line before it is ellipsised. */
const TITLE_MIN_SCALE = 0.8;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    // Tight beside the pills, so the title has the room for one line at a large font.
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    ...font.semibold,
    fontSize: fontSize.row,
    lineHeight: lineHeight.small,
    color: colors.textPrimary,
  },
  body: { flex: 1 },
  content: { gap: spacing[6], padding: spacing[5] },
  description: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small, color: colors.textSecondary },
});
