import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_CURRENCY } from '@ideanest/money';
import { LOCALE_NAMES, SUPPORTED_LOCALES, isLocale, type Locale } from '@ideanest/messages';
import { api } from '../../api/client';
import { queryKeys } from '../../api/queries';
import {
  Body,
  Card,
  Field,
  InlineAlert,
  Pill,
  Radio,
  RadioGroup,
  Select,
  Skeleton,
  Subheading,
} from '../../components/ui';
import { ACCOUNT_KEYS, useMe } from '../../lib/account';
import { useOnline } from '../../lib/connectivity';
import { useT } from '../../lib/i18n';
import { currentLocale, useLocale } from '../../lib/locale';
import { chooseLocale, pushPendingLocale } from '../../lib/locale-sync';
import { useSession } from '../../lib/use-session';
import { size, spacing } from '../../theme';
import { saveDisplayCurrency } from './api';
import { SettingsCard, SettingsPage } from './settings-page';

/**
 * `settings/language` — the web's language and currency page (#150, #216, #161).
 *
 * <p>The language is a property of this phone first: choosing one re-renders the app at once,
 * persists it, and — signed in — writes it to the account, keeping the local choice pending when
 * that fails. The currency is the account's only, so it is offered to a signed-in reader alone.
 */
export function LanguageSettingsScreen() {
  const t = useT('settings.language');
  const { signedIn } = useSession();
  return (
    <SettingsPage
      section="language"
      title={t('title')}
      intro={t('intro')}
      requireSession={false}
      offlineNotice={signedIn}
    >
      <View style={styles.section}>
        <Subheading accessibilityRole="header">{t('languageHeading')}</Subheading>
        <LanguageChoice />
      </View>
      {signedIn ? <CurrencySection /> : null}
    </SettingsPage>
  );
}

function LanguageChoice() {
  const t = useT();
  const active = useLocale();
  const { signedIn } = useSession();
  const [unsaved, setUnsaved] = useState<Locale | null>(null);
  const queryClient = useQueryClient();

  async function saveToAccount(locale: Locale): Promise<void> {
    if (!signedIn) return;
    const saved = await pushPendingLocale();
    if (saved === true) void queryClient.invalidateQueries({ queryKey: ACCOUNT_KEYS.me });
    // A slow answer for a language since replaced says nothing about the current choice.
    if (locale === currentLocale()) setUnsaved(saved === false ? locale : null);
  }

  function choose(locale: Locale): void {
    chooseLocale(locale, signedIn);
    // Category names, collection titles and facet labels arrive already translated.
    void queryClient.invalidateQueries();
    setUnsaved(null);
    void saveToAccount(locale);
  }

  return (
    <>
      <Card size="sm">
        <RadioGroup
          label={t('settings.language.fieldLabel')}
          value={active}
          onChange={(value) => {
            if (isLocale(value)) choose(value);
          }}
        >
          {SUPPORTED_LOCALES.map((locale) => (
            <Radio key={locale} value={locale} label={LOCALE_NAMES[locale]} accessibilityLanguage={locale} />
          ))}
        </RadioGroup>
      </Card>
      {unsaved === null ? null : (
        <InlineAlert
          variant="warning"
          description={t('mobile.language.saveFailed')}
          action={
            <Pill
              label={t('mobile.language.retry')}
              variant="ghost"
              size="sm"
              onPress={() => void saveToAccount(unsaved)}
            />
          }
        />
      )}
    </>
  );
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/** The web's `CurrencyPanel`: the reader's display currency, from the published rates. */
function CurrencySection() {
  const t = useT('settings.currency');
  const tAll = useT();
  const online = useOnline();
  const queryClient = useQueryClient();
  const account = useMe();
  const me = account.data ?? null;
  // Failed, answered "nobody", or not asked because the app lock is still closed: the current
  // currency is unknown, and a form that guessed it could save over the reader's choice.
  const accountUnread =
    me === null && (!account.isPending || account.fetchStatus === 'idle');
  const rates = useQuery({
    queryKey: queryKeys.exchangeRates(),
    queryFn: ({ signal }) => api().get('/v1/exchange-rates', { signal }),
    staleTime: 10 * 60_000,
  });

  const [chosen, setChosen] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>('idle');

  const base = rates.data?.base ?? DEFAULT_CURRENCY;
  const currencies = [
    base,
    ...(rates.data?.rates ?? [])
      .map((rate) => rate.currency)
      .filter((currency): currency is string => currency !== undefined && currency !== base),
  ];
  const value = chosen ?? me?.currency ?? base;

  async function save(): Promise<void> {
    if (state === 'saving' || !online) return;
    setState('saving');
    try {
      await saveDisplayCurrency(value);
    } catch {
      setState('failed');
      return;
    }
    setState('saved');
    await queryClient.invalidateQueries({ queryKey: ACCOUNT_KEYS.me });
  }

  return (
    <View style={styles.section} testID="currency-section">
      <Subheading accessibilityRole="header">{t('title')}</Subheading>
      <Body>{t('intro')}</Body>
      {rates.isError || accountUnread ? (
        <InlineAlert
          variant="danger"
          description={tAll('mobile.settings.currency.loadFailed')}
          action={
            <Pill
              label={tAll('common.tryAgain')}
              variant="ghost"
              size="sm"
              busy={rates.isFetching || account.isFetching}
              onPress={() => {
                if (rates.isError) void rates.refetch();
                if (me === null) void account.refetch();
              }}
            />
          }
          testID="currency-load-failed"
        />
      ) : rates.isPending || me === null ? (
        <Card size="md" testID="currency-loading">
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.form}>
            <Skeleton width="40%" height={size.touchTarget / 3} />
            <Skeleton height={size.touchTarget} />
          </View>
        </Card>
      ) : currencies.length < 2 ? (
        <SettingsCard testID="currency-unavailable">
          <Body>{t('unavailable')}</Body>
        </SettingsCard>
      ) : (
        <SettingsCard testID="currency-form">
          <Field label={t('fieldLabel')} hint={t('fieldHint')}>
            <Select
              options={currencies.map((currency) => ({ value: currency, label: currency }))}
              value={value}
              onChange={(next) => {
                setChosen(next);
                setState('idle');
              }}
              disabled={state === 'saving'}
              testID="currency-select"
            />
          </Field>
          {state === 'saved' ? (
            <InlineAlert variant="success" politeness="polite" description={t('saved')} />
          ) : null}
          {state === 'failed' ? (
            <InlineAlert variant="danger" description={tAll('mobile.settings.currency.failed')} />
          ) : null}
          <Pill
            label={state === 'saving' ? tAll('common.saving') : t('save')}
            variant="outline"
            busy={state === 'saving'}
            disabled={!online}
            onPress={() => void save()}
            testID="currency-save"
          />
        </SettingsCard>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing[3] },
  form: { gap: spacing[3] },
});
