import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import { Glyphs } from '../../../icons';
import { queryKeys } from '../../../api/queries';
import {
  Body,
  ErrorState,
  Field,
  Icon,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
  TextInput,
} from '../../../components/ui';
import { useAppActive } from '../../../lib/app-active';
import { useOnline } from '../../../lib/connectivity';
import { useT } from '../../../lib/i18n';
import { useLocale } from '../../../lib/locale';
import { colors, size, spacing } from '../../../theme';
import { SettingsCard, SettingsPage } from '../settings-page';
import {
  beginCardRegistration,
  readLegalSubject,
  readPayoutDestination,
  saveLegalSubject,
  type DestinationStanding,
  type LegalSubject,
  type PayoutDestination,
  type SubjectKind,
} from './api';
import {
  CHECKS,
  cardReturnFor,
  openCardRegistration,
  readCardHint,
  useCardSettling,
  type CardReturnHint,
} from './card-return';

/**
 * `settings/payout` — the web's `PayoutDetailsPanel` (#161): who is paid, saved as a form, and the
 * card the money goes to, which is registered on the provider's page in the in-app browser and
 * never typed here.
 *
 * <p>`card` is the route's `?card=returned|failed` — a return that arrived as a link rather than
 * through the browser session (a cold start from `ideanest://settings/payout?card=…`).
 */
export function PayoutSettingsScreen({ card }: { readonly card?: unknown }) {
  const t = useT('settings.pages.payout');
  return (
    <SettingsPage section="payout" title={t('title')} intro={t('intro')}>
      <PayoutDetails card={card} />
    </SettingsPage>
  );
}

/**
 * `dismissed`: the browser was closed without coming back through the return address. The card
 * may still have been filed, so the destination is re-read as after a return, without claiming
 * that the provider is confirming anything.
 */
type ReturnKind = CardReturnHint | 'dismissed';

interface CardReturn {
  readonly kind: ReturnKind | null;
  /** The destination's `updatedAt` before the provider was opened; `undefined` until known. */
  readonly baseline: string | null | undefined;
  readonly epoch: number;
}

function PayoutDetails({ card }: { readonly card?: unknown }) {
  const t = useT('settings.panels.payout');
  const router = useRouter();
  const online = useOnline();
  const active = useAppActive();

  const subject = useQuery({
    queryKey: queryKeys.legalSubject(),
    queryFn: ({ signal }) => readLegalSubject(signal),
  });
  const destination = useQuery({
    queryKey: queryKeys.payoutDestination(),
    queryFn: ({ signal }) => readPayoutDestination(signal),
  });
  const current = destination.data;

  const [cardReturn, setCardReturn] = useState<CardReturn>({ kind: null, baseline: undefined, epoch: 0 });

  const startReturn = useCallback((kind: ReturnKind, baseline: string | null | undefined) => {
    setCardReturn((previous) => ({ kind, baseline, epoch: previous.epoch + 1 }));
  }, []);

  useEffect(() => {
    if (card === undefined) return;
    const hint = readCardHint(card);
    if (hint !== null) startReturn(hint, undefined);
    router.setParams({ card: undefined });
  }, [card, router, startReturn]);

  // A return that arrived before the first read compares against that read, as the web does.
  useEffect(() => {
    if (cardReturn.kind === null || cardReturn.baseline !== undefined || current === undefined) return;
    const baseline = current.updatedAt ?? null;
    setCardReturn((previous) => (previous.baseline === undefined ? { ...previous, baseline } : previous));
  }, [cardReturn.kind, cardReturn.baseline, current]);

  const changed =
    cardReturn.baseline !== undefined && current !== undefined && (current.updatedAt ?? null) !== cardReturn.baseline;
  const settling = (cardReturn.kind === 'returned' || cardReturn.kind === 'dismissed') && !changed;
  const { refetch } = destination;
  const reread = useCallback(() => refetch({ cancelRefetch: false }), [refetch]);
  const checks = useCardSettling(settling, active && online, reread, cardReturn.epoch);
  const waiting = cardReturn.kind === 'returned' && settling && checks < CHECKS;

  /*
   * The form copies the record once, so it waits for this visit's read: a copy kept in memory
   * from an earlier visit could be saved back over a change made on the web since. Offline the
   * cached copy is shown, read-only.
   */
  const subjectReady =
    subject.data !== undefined && (subject.isFetchedAfterMount || subject.fetchStatus === 'paused');

  if (!subjectReady || current === undefined) {
    if (subject.isError || destination.isError) {
      return (
        <ErrorState
          title={t('failed')}
          onRetry={() => {
            void subject.refetch();
            void destination.refetch();
          }}
          retrying={subject.isFetching || destination.isFetching}
          testID="payout-failed"
        />
      );
    }
    return (
      <SkeletonGroup label={t('loading')} testID="payout-loading">
        <View style={styles.skeletons}>
          <Skeleton height={size.touchTarget * 8} radius="lg" />
          <Skeleton height={size.touchTarget * 4} radius="lg" />
        </View>
      </SkeletonGroup>
    );
  }

  return (
    <>
      <SubjectForm initial={subject.data!} onSaved={() => void reread()} />
      <CardSection
        destination={current}
        waiting={waiting}
        failed={cardReturn.kind === 'failed'}
        onReturn={(kind) => startReturn(kind, current.updatedAt ?? null)}
      />
    </>
  );
}

function SubjectForm({ initial, onSaved }: { readonly initial: LegalSubject; readonly onSaved: () => void }) {
  const t = useT('settings.panels.payout');
  const online = useOnline();
  const queryClient = useQueryClient();
  const recorded = initial.recorded;

  const [kind, setKind] = useState<SubjectKind>((recorded ? initial.subjectKind : null) ?? 'INDIVIDUAL');
  const [legalName, setLegalName] = useState(recorded ? (initial.legalName ?? '') : '');
  const [taxId, setTaxId] = useState(recorded ? (initial.taxId ?? '') : '');
  const [registeredAddress, setRegisteredAddress] = useState(recorded ? (initial.registeredAddress ?? '') : '');
  const [registrationNumber, setRegistrationNumber] = useState(recorded ? (initial.registrationNumber ?? '') : '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [taxIdError, setTaxIdError] = useState<string | null>(null);
  const inFlight = useRef(false);

  function edit<T>(set: (value: T) => void): (value: T) => void {
    return (value) => {
      set(value);
      setSaved(false);
    };
  }

  async function save(): Promise<void> {
    if (inFlight.current || !online) return;
    inFlight.current = true;
    setSaving(true);
    setSaved(false);
    setFailed(false);
    setTaxIdError(null);
    const company = kind === 'LEGAL_ENTITY';
    try {
      const next = await saveLegalSubject({
        subjectKind: kind,
        legalName: legalName.trim(),
        taxId: blankToNull(taxId),
        registeredAddress: company ? blankToNull(registeredAddress) : null,
        registrationNumber: company ? blankToNull(registrationNumber) : null,
      });
      queryClient.setQueryData(queryKeys.legalSubject(), next);
      setSaved(true);
      // The card's standing depends on the legal name.
      onSaved();
    } catch (cause) {
      if (cause instanceof ApiError && cause.problem?.code === 'MALFORMED_TAX_IDENTIFIER') {
        setTaxIdError(t('malformedTaxId'));
      } else {
        setFailed(true);
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  const locked = saving || !online;

  return (
    <SettingsCard title={t('subjectHeading')} intro={t('subjectIntro')} testID="payout-subject">
      <View style={styles.form}>
        <Field label={t('kind')} grouped>
          <View style={styles.kinds}>
            {(['INDIVIDUAL', 'LEGAL_ENTITY'] as const).map((option) => (
              <Pill
                key={option}
                label={option === 'INDIVIDUAL' ? t('kindIndividual') : t('kindEntity')}
                variant={kind === option ? 'outline' : 'ghost'}
                size="sm"
                selected={kind === option}
                disabled={locked}
                onPress={() => edit(setKind)(option)}
                testID={`payout-kind-${option}`}
              />
            ))}
          </View>
        </Field>

        <Field label={t('legalName')} hint={t('legalNameHint')} required>
          <TextInput
            value={legalName}
            onChangeText={edit(setLegalName)}
            autoComplete="name"
            textContentType="name"
            disabled={locked}
            testID="payout-legal-name"
          />
        </Field>

        <Field label={t('taxId')} hint={t('taxIdHint')} error={taxIdError}>
          <TextInput
            value={taxId}
            onChangeText={edit(setTaxId)}
            keyboardType="number-pad"
            autoComplete="off"
            autoCorrect={false}
            disabled={locked}
            testID="payout-tax-id"
          />
        </Field>

        {kind === 'LEGAL_ENTITY' ? (
          <>
            <Field label={t('registeredAddress')}>
              <TextInput
                value={registeredAddress}
                onChangeText={edit(setRegisteredAddress)}
                autoComplete="street-address"
                disabled={locked}
                testID="payout-registered-address"
              />
            </Field>
            <Field label={t('registrationNumber')}>
              <TextInput
                value={registrationNumber}
                onChangeText={edit(setRegistrationNumber)}
                autoCorrect={false}
                disabled={locked}
                testID="payout-registration-number"
              />
            </Field>
          </>
        ) : null}

        {failed ? <InlineAlert variant="danger" description={t('failed')} testID="payout-subject-failed" /> : null}
        {saved ? (
          <InlineAlert variant="success" politeness="polite" description={t('saved')} testID="payout-subject-saved" />
        ) : null}

        <View style={styles.start}>
          <Pill
            label={saving ? t('saving') : t('save')}
            variant="outline"
            busy={saving}
            disabled={!online || legalName.trim() === ''}
            onPress={() => void save()}
            testID="payout-subject-save"
          />
        </View>
      </View>
    </SettingsCard>
  );
}

type CardFailure = 'unavailable' | 'failed';

function CardSection({
  destination,
  waiting,
  failed,
  onReturn,
}: {
  readonly destination: PayoutDestination;
  readonly waiting: boolean;
  readonly failed: boolean;
  readonly onReturn: (kind: ReturnKind) => void;
}) {
  const t = useT('settings.panels.payout');
  const online = useOnline();
  const locale = useLocale();
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState<CardFailure | null>(null);
  const inFlight = useRef(false);
  const recorded = destination.recorded === true;

  async function register(): Promise<void> {
    if (inFlight.current || !online) return;
    inFlight.current = true;
    setOpening(true);
    setFailure(null);
    try {
      const page = await beginCardRegistration(cardReturnFor(locale));
      if (page.redirectUrl === undefined || page.redirectUrl === '') throw new Error('No provider page.');
      const outcome = await openCardRegistration(page.redirectUrl);
      onReturn(outcome.kind === 'returned' ? outcome.hint : 'dismissed');
    } catch (cause) {
      setFailure(
        cause instanceof ApiError && cause.problem?.code === 'PAYOUT_CARDS_UNAVAILABLE' ? 'unavailable' : 'failed',
      );
    } finally {
      inFlight.current = false;
      setOpening(false);
    }
  }

  return (
    <SettingsCard title={t('cardHeading')} intro={t('cardIntro')} testID="payout-card">
      {waiting ? (
        <InlineAlert variant="info" politeness="polite" description={t('waiting')} testID="payout-card-waiting" />
      ) : null}
      {failed ? <InlineAlert variant="warning" description={t('cardFailed')} testID="payout-card-failed" /> : null}

      <View style={styles.onFile}>
        <Icon icon={Glyphs.Card} size={20} color={colors.textTertiary} />
        {recorded ? (
          <View style={styles.onFileWords} accessible testID="payout-card-on-file">
            <Body tone="primary">
              {t('cardOnFile', { hint: destination.displayHint ?? '', holder: destination.holderName ?? '' })}
            </Body>
            <Body>{t(standingKey(destination.standing))}</Body>
          </View>
        ) : (
          <View style={styles.onFileWords}>
            <Body testID="payout-card-none">{t('cardNone')}</Body>
          </View>
        )}
      </View>

      {failure === null ? null : (
        <InlineAlert
          variant="danger"
          description={failure === 'unavailable' ? t('unavailable') : t('failed')}
          testID="payout-card-error"
        />
      )}

      <View style={styles.start}>
        <Pill
          label={opening ? t('opening') : recorded ? t('replace') : t('register')}
          variant="outline"
          busy={opening}
          disabled={!online}
          onPress={() => void register()}
          testID="payout-card-register"
        />
      </View>
    </SettingsCard>
  );
}

type StandingKey =
  | 'standingAwaiting'
  | 'standingVerified'
  | 'standingWaived'
  | 'standingMismatch'
  | 'standingRejected'
  | 'cardNone';

function standingKey(standing: DestinationStanding | undefined): StandingKey {
  switch (standing) {
    case 'AWAITING_VERIFICATION':
      return 'standingAwaiting';
    case 'VERIFIED':
      return 'standingVerified';
    case 'WAIVED':
      return 'standingWaived';
    case 'NAME_MISMATCH':
      return 'standingMismatch';
    case 'REJECTED':
      return 'standingRejected';
    default:
      return 'cardNone';
  }
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

const styles = StyleSheet.create({
  skeletons: { gap: spacing[6] },
  form: { gap: spacing[5] },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  start: { alignItems: 'flex-start' },
  onFile: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  onFileWords: { flex: 1, minWidth: 0, gap: spacing[1] },
});
