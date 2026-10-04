import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Linking, StyleSheet, View, type TextInput } from 'react-native';
import {
  MESSAGE_MAX_LENGTH,
  missingFields,
  whatsappHref,
  type EnquiryField,
} from '@ideanest/messages';
import { useT } from '../lib/i18n';
import { spacing } from '../theme';
import { Body } from './text';
import {
  CharacterCount,
  Field,
  InlineAlert,
  Pill,
  Sheet,
  TextInput as KitTextInput,
  Textarea,
} from './ui';

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
 * <h2>The kit's `Sheet`</h2>
 *
 * The form is exactly the transient picker the kit's `Sheet` is for (issue #151): one form, no
 * route, gone once it has done its job. So the sheet is that component rather than a `Modal`
 * of its own — the scrim, Android's back button (`onRequestClose`), iOS's escape gesture, the
 * close button and the drag all close it, focus moves to its title on open, and the panel
 * avoids the keyboard. Its footer holds the two actions, so they stay above the keyboard while
 * the message is being typed. Cancel stays as well as the sheet's own X: it is the way out
 * every reader can see beside the button that sends.
 *
 * <p>It is the kit's white sheet (`mobile-design` skill §2): the form reads on white, and the kit's
 * fields and pills follow the surface (`useSurface()`). The hand-over is the primary pill, which
 * on white inverts to the dark fill — it is this sheet's action but not an urgent one, so not
 * lime — and Cancel is the outline pill, a near-black hairline on white.
 *
 * <h2>Errors, for somebody who cannot see them</h2>
 *
 * Every empty field gets its sentence under it (the kit's `Field` draws it with an icon, puts it
 * in the field's hint and announces it), and focus moves to the FIRST one, whose sentence is also
 * read out: a keyboard that stays where it was, over a form that turned red somewhere above it,
 * is the failure `docs/ui-kit.md` §7.13 describes.
 */
export function WhatsAppSheet({
  visible,
  onClose,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
}) {
  const t = useT('shell.whatsapp');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [message, setMessage] = useState('');
  const [missing, setMissing] = useState<readonly EnquiryField[]>([]);
  /** The link that was handed over, kept so it can be followed again. */
  const [handoff, setHandoff] = useState<string | null>(null);
  /**
   * What to say once the press has rendered. A fresh object per press, so the same sentence is
   * said again on a second press.
   *
   * <p>Said from an effect rather than from the press handler, because each `Field` announces
   * its own error as it appears — three empty fields, three assertive announcements, the last one
   * the message's. This sheet's effect runs after its fields' (a parent's effects follow its
   * children's), so the sentence heard last is the one for the field that has the focus.
   */
  const [announcement, setAnnouncement] = useState<{ readonly text: string } | null>(null);

  useEffect(() => {
    if (announcement !== null) AccessibilityInfo.announceForAccessibility(announcement.text);
  }, [announcement]);

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
   * STAY: the scrim is one stray tap from the message box, and a sheet that empties itself on a
   * mistaken tap is a paragraph somebody has to type again.
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
      setAnnouncement({ text: t(`errors.${first}`) });
      return;
    }

    const href = whatsappHref(enquiry);
    setHandoff(href);
    setAnnouncement({ text: t('handoff.title') });
    handOver(href);
  }

  const errorFor = (field: EnquiryField): string | undefined =>
    missing.includes(field) ? t(`errors.${field}`) : undefined;

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={t('title')}
      footer={
        <>
          {handoff === null ? (
            <Pill label={t('submit')} onPress={submit} size="lg" fullWidth />
          ) : (
            <Pill
              label={t('handoff.again')}
              onPress={() => handOver(handoff)}
              size="lg"
              fullWidth
            />
          )}
          <Pill label={t('cancel')} variant="outline" size="lg" fullWidth onPress={close} />
        </>
      }
    >
      {handoff === null ? (
        <View style={styles.content}>
          <Body>{t('intro')}</Body>

          <Field label={t('fields.firstName')} error={errorFor('firstName')}>
            <KitTextInput
              ref={firstNameField}
              value={firstName}
              onChangeText={setFirstName}
              autoComplete="given-name"
              textContentType="givenName"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => lastNameField.current?.focus()}
            />
          </Field>

          <Field label={t('fields.lastName')} error={errorFor('lastName')}>
            <KitTextInput
              ref={lastNameField}
              value={lastName}
              onChangeText={setLastName}
              autoComplete="family-name"
              textContentType="familyName"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => messageField.current?.focus()}
            />
          </Field>

          {/*
            The cap is the field's, not a warning after the fact: the text travels in a URL, and
            where a handler stops reading one is neither specified nor the same on every phone.
            The count says how much room is left before the cap bites, in the reader's plural,
            and speaks up once it is close.
          */}
          <Field label={t('fields.message')} error={errorFor('message')}>
            <Textarea
              ref={messageField}
              value={message}
              onChangeText={setMessage}
              maxLength={MESSAGE_MAX_LENGTH}
            />
            <CharacterCount count={message.length} limit={MESSAGE_MAX_LENGTH} />
          </Field>
        </View>
      ) : (
        /*
          `info` and not a success: nothing has been sent — the reader presses send in WhatsApp —
          and a screen that claimed otherwise would be claiming something it cannot know.
        */
        <InlineAlert title={t('handoff.title')} description={t('handoff.detail')} />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing[5] },
});
