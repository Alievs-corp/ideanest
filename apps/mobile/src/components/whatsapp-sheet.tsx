import { useRef, useState } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from 'use-intl';
import {
  MESSAGE_MAX_LENGTH,
  missingFields,
  whatsappHref,
  type EnquiryField,
} from '@ideanest/messages';
import { pluralCategory, useT } from '../lib/i18n';
import { colors, radius, size, spacing } from '../theme';
import { Button, TextField } from './form';
import { InlineAlert } from './ui';
import { Body, CardTitle } from './text';

/**
 * The WhatsApp enquiry, as a bottom sheet — issue #150. The web's `WhatsAppLauncher` without
 * its floating button: the same three fields, the same rule, the same link, and the same
 * refusal to say "sent".
 *
 * <h2>What pressing send does</h2>
 *
 * It hands the written message to WhatsApp (`wa.me`, which opens the app, or the browser when
 * the app is not installed) and the reader presses send there. `@ideanest/messages`'
 * `whatsapp.ts` carries the reasoning; the short version is that the message then comes from
 * the reader's own number, so the reply reaches a person. **So the sheet never says "sent"**:
 * the handoff state says WhatsApp is open and keeps the link one press away, for the phone
 * where the first hand-off went nowhere.
 *
 * <h2>Why React Native's `Modal` and not a sheet library</h2>
 *
 * A slide-up `Modal` is the whole of what this needs — one form, no snap points, no drag to
 * resize — and it is already in the framework, where a sheet library would be a native
 * dependency and a rebuild for a contact form. `onRequestClose` is Android's back button and
 * the backdrop is a convenience; Cancel is the way out that every reader can see.
 *
 * <h2>Errors, for somebody who cannot see them</h2>
 *
 * Every empty field gets its sentence under it (`TextField` announces it as an alert), and
 * focus moves to the FIRST one, whose sentence is also read out: a keyboard that stays where
 * it was, over a form that turned red somewhere above it, is the failure `docs/ui-kit.md`
 * §7.13 describes.
 */
export function WhatsAppSheet({
  visible,
  onClose,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
}) {
  const t = useT('shell.whatsapp');
  const tAll = useT();
  const locale = useLocale();
  /*
   * The root `SafeAreaProvider`'s insets. React context crosses the `Modal`'s portal, so the
   * sheet reads the same numbers as every screen: its top stays clear of the status bar (the
   * modal draws under it) and its last button clear of the home indicator.
   */
  const insets = useSafeAreaInsets();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [message, setMessage] = useState('');
  const [missing, setMissing] = useState<readonly EnquiryField[]>([]);
  /** The link that was handed over, kept so it can be followed again. */
  const [handoff, setHandoff] = useState<string | null>(null);

  const firstNameField = useRef<TextInput>(null);
  const lastNameField = useRef<TextInput>(null);
  const messageField = useRef<TextInput>(null);
  const fields: Record<EnquiryField, typeof firstNameField> = {
    firstName: firstNameField,
    lastName: lastNameField,
    message: messageField,
  };

  /*
   * What closing clears, and what it keeps — the web's rule. The refusals and the handoff go:
   * both answer a press, and neither is true the next time the sheet opens. THE THREE FIELDS
   * STAY: the backdrop is one stray tap from the message box, and a sheet that empties itself
   * on a mistaken tap is a paragraph somebody has to type again.
   */
  function close(): void {
    setMissing([]);
    setHandoff(null);
    onClose();
  }

  function handOver(href: string): void {
    /*
     * A rejection means nothing on the phone would take the link. It is not an error to show:
     * the handoff state below already says what happened next and offers the link again.
     */
    void Linking.openURL(href).catch(() => undefined);
  }

  function submit(): void {
    const enquiry = { firstName, lastName, message };
    const empty = missingFields(enquiry);
    setMissing(empty);

    const first = empty[0];
    if (first !== undefined) {
      fields[first].current?.focus();
      AccessibilityInfo.announceForAccessibility(t(`errors.${first}`));
      return;
    }

    const href = whatsappHref(enquiry);
    setHandoff(href);
    AccessibilityInfo.announceForAccessibility(t('handoff.title'));
    handOver(href);
  }

  const errorFor = (field: EnquiryField): string | undefined =>
    missing.includes(field) ? t(`errors.${field}`) : undefined;

  const remaining = MESSAGE_MAX_LENGTH - message.length;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
      statusBarTranslucent
    >
      <View style={[styles.frame, { paddingTop: insets.top + spacing[4] }]}>
        {/*
          Out of the accessibility tree: it is a convenience, and every way out of this sheet
          exists as a real control (Cancel, and Android's back button).
        */}
        <Pressable
          style={styles.backdrop}
          onPress={close}
          accessible={false}
          importantForAccessibility="no"
        />
        {/*
          Bounded, all the way down: the frame is the screen, the avoiding view may take no
          more of it than is left above the keyboard, and the panel shrinks to fit that — so
          the scroll view is the part that gives, and the title and the first field can be
          scrolled back to with the keyboard up. iOS pads for the keyboard; Android resizes
          the window itself, and a second adjustment there pushes the form off the top.
        */}
        <KeyboardAvoidingView
          style={styles.avoider}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.panel} accessibilityViewIsModal>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={[
                styles.content,
                { paddingBottom: insets.bottom + size.cardPaddingLarge },
              ]}
            >
              <CardTitle accessibilityRole="header">{t('title')}</CardTitle>

              {handoff === null ? (
                <>
                  <Body>{t('intro')}</Body>

                  <TextField
                    ref={firstNameField}
                    label={t('fields.firstName')}
                    value={firstName}
                    onChangeText={setFirstName}
                    error={errorFor('firstName')}
                    autoComplete="given-name"
                    textContentType="givenName"
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={() => lastNameField.current?.focus()}
                  />

                  <TextField
                    ref={lastNameField}
                    label={t('fields.lastName')}
                    value={lastName}
                    onChangeText={setLastName}
                    error={errorFor('lastName')}
                    autoComplete="family-name"
                    textContentType="familyName"
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={() => messageField.current?.focus()}
                  />

                  {/*
                    The cap is the field's, not a warning after the fact: the text travels in a
                    URL, and where a handler stops reading one is neither specified nor the same
                    on every phone. The count says how much room is left before the cap bites.
                  */}
                  <TextField
                    ref={messageField}
                    label={t('fields.message')}
                    value={message}
                    onChangeText={setMessage}
                    error={errorFor('message')}
                    hint={tAll(
                      `common.characterCount.remaining.${pluralCategory(locale, remaining)}`,
                      { count: remaining },
                    )}
                    multiline
                    maxLength={MESSAGE_MAX_LENGTH}
                    style={styles.message}
                    textAlignVertical="top"
                  />

                  <View style={styles.actions}>
                    <Button label={t('submit')} onPress={submit} />
                    <Button label={t('cancel')} variant="secondary" onPress={close} />
                  </View>
                </>
              ) : (
                <>
                  {/*
                    `info` and not a success: nothing has been sent — the reader presses send in
                    WhatsApp — and a screen that claimed otherwise would be claiming something it
                    cannot know.
                  */}
                  <InlineAlert title={t('handoff.title')} description={t('handoff.detail')} />
                  <View style={styles.actions}>
                    <Button label={t('handoff.again')} onPress={() => handOver(handoff)} />
                    <Button label={t('cancel')} variant="secondary" onPress={close} />
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, justifyContent: 'flex-end' },
  /*
   * The web's `bg-black/60`, as the black token under an opacity rather than a colour literal
   * of its own: `theme.test.ts` refuses a second palette, and a scrim is not a new colour.
   */
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.black,
    opacity: 0.6,
  },
  avoider: { maxHeight: '100%', flexShrink: 1 },
  panel: {
    maxHeight: '100%',
    flexShrink: 1,
    backgroundColor: colors.surface2,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  content: { gap: spacing[5], padding: size.cardPaddingLarge },
  message: { minHeight: size.touchTarget * 3 },
  actions: { gap: spacing[3] },
});
