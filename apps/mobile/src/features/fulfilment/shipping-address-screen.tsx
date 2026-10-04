import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type TextInputProps as RNTextInputProps } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import {
  Body,
  Field,
  Heading,
  InlineAlert,
  Pill,
  Screen,
  Select,
  Skeleton,
  SkeletonGroup,
  TextInput,
  useFocusRing,
} from '../../components/ui';
import { queryKeys } from '../../api/queries';
import { useOnline } from '../../lib/connectivity';
import { signInHrefFor } from '../../lib/guard';
import { formatDateTime, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { useSession } from '../../lib/use-session';
import { formMeasure, size, spacing } from '../../theme';
import { countryName } from '../checkout/format';
import { readPledge } from '../pledges/api';
import { EMPTY_ADDRESS, readShippingAddress, saveShippingAddress, type PostalAddress } from './api';
import { COUNTRY_CODES } from './countries';

type FormKey =
  | 'recipient'
  | 'line1'
  | 'line2'
  | 'locality'
  | 'region'
  | 'postcode'
  | 'country'
  | 'countryHint'
  | 'phone'
  | 'phoneHint';

interface FieldSpec {
  readonly key: keyof PostalAddress;
  readonly labelKey: FormKey;
  readonly required: boolean;
  readonly hintKey?: FormKey;
  readonly autoComplete?: RNTextInputProps['autoComplete'];
  readonly textContentType?: RNTextInputProps['textContentType'];
  readonly autoCapitalize?: RNTextInputProps['autoCapitalize'];
  readonly keyboardType?: RNTextInputProps['keyboardType'];
}

const FIELDS: readonly FieldSpec[] = [
  {
    key: 'recipient',
    labelKey: 'recipient',
    required: true,
    autoComplete: 'name',
    textContentType: 'name',
    autoCapitalize: 'words',
  },
  {
    key: 'line1',
    labelKey: 'line1',
    required: true,
    autoComplete: 'address-line1',
    textContentType: 'streetAddressLine1',
  },
  {
    key: 'line2',
    labelKey: 'line2',
    required: false,
    autoComplete: 'address-line2',
    textContentType: 'streetAddressLine2',
  },
  {
    key: 'locality',
    labelKey: 'locality',
    required: true,
    autoComplete: 'postal-address-locality',
    textContentType: 'addressCity',
    autoCapitalize: 'words',
  },
  {
    key: 'region',
    labelKey: 'region',
    required: false,
    autoComplete: 'postal-address-region',
    textContentType: 'addressState',
    autoCapitalize: 'words',
  },
  {
    key: 'postcode',
    labelKey: 'postcode',
    required: false,
    autoComplete: 'postal-code',
    textContentType: 'postalCode',
    autoCapitalize: 'characters',
  },
  {
    key: 'countryCode',
    labelKey: 'country',
    required: true,
    hintKey: 'countryHint',
  },
  {
    key: 'phone',
    labelKey: 'phone',
    required: false,
    hintKey: 'phoneHint',
    autoComplete: 'tel',
    textContentType: 'telephoneNumber',
    keyboardType: 'phone-pad',
  },
];

const SKELETON_FIELDS = [0, 1, 2, 3] as const;

export function ShippingAddressScreen({ id }: { readonly id: string }) {
  return (
    <ShippingAddressGate id={id} />
  );
}

function ShippingAddressGate({ id }: { readonly id: string }) {
  const router = useRouter();
  const { signedIn } = useSession();

  useEffect(() => {
    if (!signedIn) router.replace(signInHrefFor(`/pledges/${encodeURIComponent(id)}/address`));
  }, [id, router, signedIn]);

  return signedIn ? <ShippingAddress id={id} /> : null;
}

function ShippingAddress({ id }: { readonly id: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const t = useT('account.fulfilment');
  const tAll = useT();
  const locale = useLocale();
  const online = useOnline();
  const link = useFocusRing();

  const query = useQuery({
    queryKey: queryKeys.shippingAddress(id),
    queryFn: ({ signal }) => readShippingAddress(id, signal),
  });
  const stored = query.data;

  const pledge = useQuery({
    queryKey: queryKeys.pledge(id),
    queryFn: ({ signal }) => readPledge(id, signal),
    retry: false,
  });
  const quoted = pledge.data?.shippingCountry?.trim().toUpperCase() ?? '';
  const destination = quoted === '' ? null : quoted;

  const [draft, setDraft] = useState<PostalAddress | null>(null);
  const [missing, setMissing] = useState<Partial<Record<keyof PostalAddress, string>>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const locked = stored?.locked === true;
  const base = stored?.address ?? { ...EMPTY_ADDRESS, countryCode: destination ?? '' };
  const address = locked || draft === null ? base : draft;
  const currentCountry = address.countryCode.trim().toUpperCase();

  const countries = useMemo(() => {
    const extra = new Set(
      [currentCountry, destination].filter(
        (code): code is string => code !== null && code !== '' && !COUNTRY_CODES.includes(code),
      ),
    );
    const named = [...COUNTRY_CODES, ...extra]
      .map((code) => ({ value: code, label: countryName(code, locale) }))
      .sort((left, right) => left.label.localeCompare(right.label, locale));
    return destination === null
      ? named
      : [...named.filter((option) => option.value === destination), ...named.filter((option) => option.value !== destination)];
  }, [currentCountry, destination, locale]);

  const header = (
    <View style={styles.header}>
      <Heading accessibilityRole="header">{t('address.title')}</Heading>
      <Body>{t('address.intro')}</Body>
    </View>
  );

  const back = (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push({ pathname: '/account/[section]', params: { section: 'deliveries' } })}
      onFocus={link.onFocus}
      onBlur={link.onBlur}
      style={[styles.back, link.ring]}
      testID="address-back"
    >
      <Body tone="secondary" style={styles.underlined}>
        {t('address.back')}
      </Body>
    </Pressable>
  );

  if (stored === undefined) {
    const failure = query.error;
    const answered = failure instanceof ApiError;
    const notFound = failure instanceof ApiError && failure.status === 404;
    const unreachable = !answered && (!online || query.fetchStatus === 'paused');
    return (
      <Screen hasContent offlineNotice={online ? null : tAll('mobile.offline.banner')}>
        <View style={styles.stack}>
          {header}
          {unreachable ? (
            <InlineAlert
              variant="warning"
              description={tAll('mobile.offline.nothingCached')}
              politeness="polite"
              testID="address-offline-empty"
            />
          ) : query.isError ? (
            <InlineAlert
              variant="danger"
              title={t('form.loadFailedTitle')}
              description={
                query.error instanceof ApiError
                  ? (query.error.problem?.detail ?? query.error.problem?.title ?? t('form.notFound'))
                  : t('form.unreachable')
              }
              politeness="assertive"
              action={
                notFound ? undefined : (
                  <Pill
                    size="sm"
                    variant="ghost"
                    label={tAll('common.tryAgain')}
                    busy={query.isFetching}
                    onPress={() => void query.refetch()}
                  />
                )
              }
              testID="address-load-failed"
            />
          ) : (
            <SkeletonGroup label={t('form.loading')} testID="address-loading">
              <View style={styles.form}>
                {SKELETON_FIELDS.map((row) => (
                  <View key={row} style={styles.skeletonField}>
                    <Skeleton height={14} width="40%" />
                    <Skeleton height={44} radius="md" />
                  </View>
                ))}
              </View>
            </SkeletonGroup>
          )}
          {back}
        </View>
      </Screen>
    );
  }

  const neverGiven = stored === null;
  const readOnly = locked || !online;

  function edit(key: keyof PostalAddress, value: string) {
    setDraft((previous) => ({ ...(previous ?? base), [key]: value }));
    setSaved(false);
  }

  async function submit() {
    if (busy || readOnly) return;

    const blanks: Partial<Record<keyof PostalAddress, string>> = {};
    for (const field of FIELDS) {
      if (field.required && address[field.key].trim() === '') blanks[field.key] = t('form.requiredField');
    }
    if (Object.keys(blanks).length > 0) {
      setMissing(blanks);
      setSaved(false);
      return;
    }

    setMissing({});
    setSaveError(null);
    setBusy(true);
    try {
      const next = await saveShippingAddress(id, address);
      client.setQueryData(queryKeys.shippingAddress(id), next);
      setDraft(null);
      setSaved(true);
    } catch (cause) {
      setSaved(false);
      if (cause instanceof ApiError && cause.status === 409) {
        void client.invalidateQueries({ queryKey: queryKeys.shippingAddress(id) });
      }
      if (cause instanceof ApiError && cause.problem?.code === 'ADDRESS_DESTINATION_MISMATCH') {
        void client.invalidateQueries({ queryKey: queryKeys.pledge(id), exact: true });
      }
      setSaveError(
        cause instanceof ApiError
          ? (cause.problem?.detail ?? cause.problem?.title ?? t('form.refused'))
          : t('form.unreachable'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen hasContent offlineNotice={online ? null : tAll('mobile.offline.banner')}>
      <View style={styles.stack}>
        {header}

        <View style={styles.form}>
          {locked ? (
            <InlineAlert
              variant="warning"
              title={t('form.lockedTitle')}
              description={
                stored?.lockedAt != null && stored.lockedAt !== ''
                  ? t('form.lockedBodyAt', { at: formatDateTime(stored.lockedAt, locale) })
                  : t('form.lockedBody')
              }
              politeness="polite"
              testID="address-locked"
            />
          ) : null}

          {neverGiven && !locked ? (
            <InlineAlert
              variant="info"
              title={t('form.noAddressTitle')}
              description={t('form.noAddressBody')}
              politeness="polite"
              testID="address-never-given"
            />
          ) : null}

          {saveError === null ? null : (
            <InlineAlert
              variant="danger"
              title={t('form.saveFailedTitle')}
              description={saveError}
              politeness="assertive"
              testID="address-save-failed"
            />
          )}

          {saved && saveError === null ? (
            <InlineAlert
              variant="success"
              title={t('form.savedTitle')}
              description={
                stored?.updatedAt != null && stored.updatedAt !== ''
                  ? t('form.savedBodyAt', { at: formatDateTime(stored.updatedAt, locale) })
                  : t('form.savedBody')
              }
              politeness="polite"
              testID="address-saved"
            />
          ) : null}

          {FIELDS.map((field) =>
            field.key === 'countryCode' ? (
              <Field
                key={field.key}
                label={t(`form.${field.labelKey}`)}
                required={field.required}
                error={missing[field.key]}
                testID={`address-field-${field.key}`}
              >
                <Select
                  options={countries}
                  value={currentCountry === '' ? null : currentCountry}
                  onChange={(code) => edit('countryCode', code)}
                  accessibilityHint={field.hintKey === undefined ? undefined : t(`form.${field.hintKey}`)}
                  disabled={readOnly}
                  testID={`address-${field.key}`}
                />
              </Field>
            ) : (
              <Field
                key={field.key}
                label={t(`form.${field.labelKey}`)}
                required={field.required}
                hint={field.hintKey === undefined ? undefined : t(`form.${field.hintKey}`)}
                error={missing[field.key]}
                testID={`address-field-${field.key}`}
              >
                <TextInput
                  value={address[field.key]}
                  onChangeText={(value) => edit(field.key, value)}
                  autoComplete={field.autoComplete}
                  textContentType={field.textContentType}
                  autoCapitalize={field.autoCapitalize}
                  keyboardType={field.keyboardType}
                  autoCorrect={false}
                  disabled={readOnly}
                  testID={`address-${field.key}`}
                />
              </Field>
            ),
          )}

          {locked ? null : (
            <View style={styles.start}>
              <Pill
                label={busy ? t('form.saving') : t('form.save')}
                busy={busy}
                disabled={!online}
                onPress={() => void submit()}
                testID="address-save"
              />
            </View>
          )}
        </View>

        {back}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing[6], paddingVertical: spacing[4] },
  header: { gap: spacing[2] },
  form: { gap: spacing[5], maxWidth: formMeasure },
  skeletonField: { gap: spacing[2] },
  start: { alignItems: 'flex-start' },
  back: { minHeight: size.touchTarget, justifyContent: 'center', alignSelf: 'flex-start' },
  underlined: { textDecorationLine: 'underline' },
});
