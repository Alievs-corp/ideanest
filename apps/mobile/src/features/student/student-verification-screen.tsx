import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { maySubmit, type StudentVerification } from '@ideanest/plans/student';
import { queryKeys } from '../../api/queries';
import {
  Body,
  Field,
  InlineAlert,
  Meta,
  Pill,
  Skeleton,
  SkeletonGroup,
  TextInput,
  type InlineAlertVariant,
} from '../../components/ui';
import { Glyphs } from '../../icons';
import { useOnline } from '../../lib/connectivity';
import { formatDay, useT, type MessageKey } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { forgetPicked } from '../../lib/media/upload';
import { useSession } from '../../lib/use-session';
import { radius, spacing } from '../../theme';
import { SettingsCard, SettingsPage } from '../settings/settings-page';
import {
  CARD_NUMBER_MAX,
  CARD_NUMBER_MIN,
  INSTITUTION_MAX,
  STUDENT_DOCUMENT_MAX_BYTES,
  maskCardNumber,
  preparePhoto,
  studentRefusalFrom,
  submitStudentVerification,
  useStudentVerification,
  type PreparedPhoto,
  type StudentDocumentField,
  type StudentRefusal,
} from './api';

/**
 * `settings/student` — the student card check (#655). Reached from the student plan's card on
 * Pricing and from the Me hub, beside Pricing.
 *
 * <p>The status first: what state the check is in, the institution and the card number (the last
 * four characters only), when it was sent, until when an approval counts, and staff's reason for a
 * refusal. Then, while a new submission is accepted (`maySubmit`: never sent, refused, expired), the
 * form: the institution, the card number, a photograph of the card (library or camera) and a
 * selfie (the front camera). Each photograph is converted to JPEG and brought under the service's
 * five-megabyte ceiling on the phone as soon as it is picked, so a picture that cannot be sent is
 * said at once rather than after the upload.
 *
 * <p>Why the selfie, and that one card belongs to one account, are said where they are asked for:
 * the selfie field's hint and the card number's.
 *
 * <p>A refusal is read from its `code` and, for a document, its `field`: the sentence goes on the
 * field it is about, and in the alert above the button.
 */
export function StudentVerificationScreen() {
  const t = useT('mobile.studentVerification');
  return (
    <SettingsPage section={null} returnTo="/settings/student" title={t('title')} intro={t('intro')}>
      <StudentVerificationBody />
    </SettingsPage>
  );
}

function StudentVerificationBody() {
  const t = useT('mobile.studentVerification');
  const tAll = useT();
  const { signedIn } = useSession();
  const verification = useStudentVerification(signedIn);
  const [sent, setSent] = useState(false);

  if (verification.data === undefined) {
    if (verification.isError) {
      return (
        <InlineAlert
          variant="danger"
          title={t('unavailable')}
          action={
            <Pill
              label={tAll('common.tryAgain')}
              variant="ghost"
              size="sm"
              busy={verification.isFetching}
              onPress={() => void verification.refetch()}
            />
          }
          testID="student-unavailable"
        />
      );
    }
    return (
      <SkeletonGroup label={t('loading')}>
        <Skeleton width="70%" />
        <Skeleton width="50%" />
      </SkeletonGroup>
    );
  }

  return (
    <>
      {sent ? (
        <InlineAlert variant="success" description={t('form.sent')} politeness="polite" testID="student-sent" />
      ) : null}
      <StatusCard verification={verification.data} />
      {maySubmit(verification.data) ? (
        <SubmissionForm onSent={() => setSent(true)} onAlreadySubmitted={() => void verification.refetch()} />
      ) : null}
    </>
  );
}

const STATE_VARIANT: Record<StudentVerification['state'], InlineAlertVariant> = {
  NONE: 'info',
  // Waiting is not finished: never a green tick.
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'info',
};

function StatusCard({ verification }: { readonly verification: StudentVerification }) {
  const t = useT('mobile.studentVerification');
  const locale = useLocale();
  const router = useRouter();
  const validUntil = formatDay(verification.validUntil, locale) ?? '';

  const title =
    verification.state === 'APPROVED'
      ? t('status.APPROVED', { date: validUntil })
      : verification.state === 'EXPIRED'
        ? t('status.EXPIRED', { date: validUntil })
        : t(`status.${verification.state}`);
  const detail =
    verification.state === 'PENDING'
      ? t('status.pendingBody')
      : verification.state === 'REJECTED'
        ? [
            verification.rejectionReason === null ? null : t('status.reason', { reason: verification.rejectionReason }),
            t('status.rejectedBody'),
          ]
            .filter((part): part is string => part !== null)
            .join(' ')
        : undefined;

  const facts: { readonly label: string; readonly value: string; readonly testID: string }[] = [];
  if (verification.institution !== null) {
    facts.push({ label: t('status.institution'), value: verification.institution, testID: 'student-institution' });
  }
  if (verification.cardNumber !== null) {
    facts.push({ label: t('status.cardNumber'), value: maskCardNumber(verification.cardNumber), testID: 'student-card-number' });
  }
  const submittedAt = formatDay(verification.submittedAt, locale);
  if (submittedAt !== null && verification.state !== 'NONE') {
    facts.push({ label: t('status.submittedAt'), value: submittedAt, testID: 'student-submitted-at' });
  }
  if (validUntil !== '' && (verification.state === 'APPROVED' || verification.state === 'EXPIRED')) {
    facts.push({ label: t('status.validUntil'), value: validUntil, testID: 'student-valid-until' });
  }

  return (
    <SettingsCard title={t('status.heading')} testID="student-status">
      <InlineAlert
        variant={STATE_VARIANT[verification.state]}
        title={title}
        description={detail}
        action={
          verification.state === 'APPROVED' ? (
            <Pill label={t('toPricing')} size="sm" onPress={() => router.push('/pricing')} testID="student-to-pricing" />
          ) : undefined
        }
        politeness="off"
        testID={`student-state-${verification.state}`}
      />
      {facts.length === 0 ? null : (
        <View style={styles.facts}>
          {facts.map((fact) => (
            <View key={fact.testID} style={styles.fact} testID={fact.testID}>
              <Meta>{fact.label}</Meta>
              <Body tone="primary">{fact.value}</Body>
            </View>
          ))}
        </View>
      )}
    </SettingsCard>
  );
}

type Problems = Partial<Record<'institution' | 'cardNumber' | StudentDocumentField, string>>;

const REFUSAL_KEY: Record<Exclude<StudentRefusal['refusal'], 'tooLarge'>, MessageKey> = {
  cardInUse: 'mobile.studentVerification.errors.cardInUse',
  alreadySubmitted: 'mobile.studentVerification.errors.alreadySubmitted',
  emptyFile: 'mobile.studentVerification.errors.emptyFile',
  unsupportedFile: 'mobile.studentVerification.errors.unsupportedFile',
  storageUnavailable: 'mobile.studentVerification.errors.storageUnavailable',
  signedOut: 'mobile.studentVerification.errors.signedOut',
  generic: 'mobile.studentVerification.errors.generic',
};

const MEGABYTES = String(STUDENT_DOCUMENT_MAX_BYTES / (1024 * 1024));

function SubmissionForm({
  onSent,
  onAlreadySubmitted,
}: {
  readonly onSent: () => void;
  readonly onAlreadySubmitted: () => void;
}) {
  const t = useT('mobile.studentVerification');
  const tAll = useT();
  const client = useQueryClient();
  const online = useOnline();

  const [institution, setInstitution] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [card, setCard] = useState<PreparedPhoto | null>(null);
  const [selfie, setSelfie] = useState<PreparedPhoto | null>(null);
  const [problems, setProblems] = useState<Problems>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // The prepared JPEGs are this screen's cache copies: removed when replaced, sent or left behind.
  const photos = useRef<{ card: PreparedPhoto | null; selfie: PreparedPhoto | null }>({ card: null, selfie: null });
  photos.current = { card, selfie };
  useEffect(
    () => () => {
      if (photos.current.card !== null) forgetPicked(photos.current.card.uri);
      if (photos.current.selfie !== null) forgetPicked(photos.current.selfie.uri);
    },
    [],
  );

  const refusalText = (found: StudentRefusal): string =>
    found.refusal === 'tooLarge'
      ? tAll('mobile.kitForm.filePicker.tooLarge', { megabytes: MEGABYTES })
      : tAll(REFUSAL_KEY[found.refusal]);

  const validate = (): Problems => {
    const found: Problems = {};
    const name = institution.trim();
    if (name === '') found.institution = t('form.institutionRequired');
    else if (name.length > INSTITUTION_MAX) found.institution = t('form.tooLong', { max: String(INSTITUTION_MAX) });
    const number = cardNumber.trim();
    if (number.length < CARD_NUMBER_MIN || number.length > CARD_NUMBER_MAX) found.cardNumber = t('form.cardNumberInvalid');
    if (card === null) found.studentCard = t('form.cardPhotoRequired');
    if (selfie === null) found.selfie = t('form.selfieRequired');
    return found;
  };

  const submit = async () => {
    if (sending || !online) return;
    const found = validate();
    setProblems(found);
    setRefusal(null);
    if (Object.keys(found).length > 0 || card === null || selfie === null) return;
    setSending(true);
    try {
      const next = await submitStudentVerification({
        institution: institution.trim(),
        cardNumber: cardNumber.trim(),
        studentCard: card,
        selfie,
      });
      forgetPicked(card.uri);
      forgetPicked(selfie.uri);
      setCard(null);
      setSelfie(null);
      // Pricing reads the same query: its student card stops offering the check at once.
      client.setQueryData(queryKeys.studentVerification(), next);
      onSent();
    } catch (cause) {
      const found = studentRefusalFrom(cause);
      const sentence = refusalText(found);
      setRefusal(sentence);
      if (found.field !== null) setProblems({ [found.field]: sentence });
      if (found.refusal === 'alreadySubmitted') onAlreadySubmitted();
    } finally {
      setSending(false);
    }
  };

  return (
    <SettingsCard title={t('form.heading')} testID="student-form">
      <Field label={t('status.institution')} hint={t('form.institutionHint')} error={problems.institution} required>
        <TextInput
          value={institution}
          onChangeText={setInstitution}
          maxLength={INSTITUTION_MAX}
          autoCapitalize="words"
          disabled={sending}
          testID="student-institution-input"
        />
      </Field>
      <Field label={t('status.cardNumber')} hint={t('form.oneAccount')} error={problems.cardNumber} required>
        <TextInput
          value={cardNumber}
          onChangeText={setCardNumber}
          maxLength={CARD_NUMBER_MAX}
          autoCapitalize="characters"
          autoCorrect={false}
          disabled={sending}
          testID="student-card-number-input"
        />
      </Field>
      <PhotoField
        kind="studentCard"
        label={t('form.card')}
        hint={t('form.cardHint')}
        error={problems.studentCard}
        photo={card}
        disabled={sending}
        onPrepared={(next) => {
          if (card !== null) forgetPicked(card.uri);
          setCard(next);
          setProblems(({ studentCard: _dropped, ...rest }) => rest);
        }}
        describe={refusalText}
      />
      <PhotoField
        kind="selfie"
        label={t('form.selfie')}
        hint={t('form.selfieWhy')}
        error={problems.selfie}
        photo={selfie}
        disabled={sending}
        onPrepared={(next) => {
          if (selfie !== null) forgetPicked(selfie.uri);
          setSelfie(next);
          setProblems(({ selfie: _dropped, ...rest }) => rest);
        }}
        describe={refusalText}
      />
      <Body tone="tertiary">{t('form.privacy')}</Body>
      {refusal === null ? null : (
        <InlineAlert variant="danger" title={t('errors.title')} description={refusal} testID="student-refusal" />
      )}
      <Pill
        label={sending ? t('form.submitting') : t('form.submit')}
        onPress={() => void submit()}
        busy={sending}
        disabled={!online}
        fullWidth
        wrap
        testID="student-submit"
      />
    </SettingsCard>
  );
}

/** A thumbnail's edge: enough to see it is the right picture, small enough not to dominate. */
const THUMBNAIL = 72;

function PhotoField({
  kind,
  label,
  hint,
  error,
  photo,
  disabled,
  onPrepared,
  describe,
}: {
  readonly kind: StudentDocumentField;
  readonly label: string;
  readonly hint: string;
  readonly error?: string;
  readonly photo: PreparedPhoto | null;
  readonly disabled: boolean;
  readonly onPrepared: (photo: PreparedPhoto) => void;
  readonly describe: (refusal: StudentRefusal) => string;
}) {
  const t = useT('mobile.studentVerification');
  const tPicker = useT('mobile.kitForm.filePicker');
  const [preparing, setPreparing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  async function pick(source: 'library' | 'camera'): Promise<void> {
    if (preparing || disabled) return;
    setNote(null);
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setNote(permission.canAskAgain === false ? tPicker('cameraDenied') : tPicker('cameraRefused'));
        return;
      }
    }
    let result: ImagePicker.ImagePickerResult;
    try {
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: 'images',
        // A document is read whole: no crop that could cut off the number.
        allowsEditing: false,
        quality: 1,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode?.Compatible,
        ...(kind === 'selfie' ? { cameraType: ImagePicker.CameraType?.front } : {}),
      };
      result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
    } catch {
      setNote(tPicker('openFailed'));
      return;
    }
    const asset = result.canceled ? undefined : result.assets[0];
    if (asset === undefined) return;

    setPreparing(true);
    try {
      const prepared = await preparePhoto(asset.uri, forgetPicked);
      if (mounted.current) onPrepared(prepared);
      else forgetPicked(prepared.uri);
    } catch (cause) {
      if (mounted.current) setNote(describe(studentRefusalFrom(cause)));
    } finally {
      // The picker's own copy: the JPEG made from it is what is kept.
      forgetPicked(asset.uri);
      if (mounted.current) setPreparing(false);
    }
  }

  return (
    <Field grouped label={label} hint={hint} error={note ?? error} required testID={`student-${kind}-field`}>
      <View style={styles.photo}>
        {photo === null ? null : (
          <View style={styles.preview}>
            <Image
              source={{ uri: photo.uri }}
              style={styles.thumbnail}
              contentFit="cover"
              transition={0}
              // A student card and a face: never written to the image disk cache, where a scaled
              // copy would outlive the submission.
              cachePolicy="none"
              accessibilityIgnoresInvertColors
              accessible={false}
              testID={`student-${kind}-preview`}
            />
            <Body tone="secondary" style={styles.added}>
              {t('form.added')}
            </Body>
          </View>
        )}
        <View style={styles.actions}>
          {kind === 'studentCard' ? (
            <Pill
              label={tPicker('library')}
              iconLeft={Glyphs.Gallery}
              variant="ghost"
              disabled={disabled || preparing}
              busy={preparing}
              onPress={() => void pick('library')}
              testID={`student-${kind}-library`}
            />
          ) : null}
          <Pill
            label={kind === 'selfie' ? t('form.takeSelfie') : tPicker('camera')}
            iconLeft={Glyphs.Camera}
            variant="ghost"
            disabled={disabled || preparing}
            busy={kind === 'selfie' && preparing}
            onPress={() => void pick('camera')}
            testID={`student-${kind}-camera`}
          />
        </View>
      </View>
    </Field>
  );
}

const styles = StyleSheet.create({
  facts: { gap: spacing[3] },
  fact: { gap: spacing[1] },
  photo: { gap: spacing[3] },
  preview: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  thumbnail: { width: THUMBNAIL, height: THUMBNAIL, borderRadius: radius.md },
  added: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
});
