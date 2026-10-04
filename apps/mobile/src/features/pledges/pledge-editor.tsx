import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { formatMoney } from '@ideanest/money';
import { NO_REWARD } from '@ideanest/checkout/draft';
import type { CheckoutFailure } from '@ideanest/checkout/failure';
import type { PaymentReturnHint } from '@ideanest/checkout/pledge';
import { toAmounts } from '@ideanest/checkout/quote';
import { contributionMessage, refusalMessage } from '@ideanest/checkout/refusals';
import type { PledgeResponse, PublicReward } from '@ideanest/checkout/types';
import {
  AccentScopeProvider,
  Body,
  Field,
  InlineAlert,
  Meta,
  Pill,
  Select,
  SkeletonCard,
  SkeletonGroup,
  Subheading,
  TextInput,
} from '../../components/ui';
import { Checkbox } from '../../components/ui/checkbox';
import { useOnline } from '../../lib/connectivity';
import { signInHrefFor } from '../../lib/guard';
import { catalogue as messages, formatDateTime, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { colors, font, fontSize, lineHeight, spacing, tint } from '../../theme';
import { AddonChoice } from '../checkout/addon-choice';
import { countryName } from '../checkout/format';
import { PledgeSummary } from '../checkout/pledge-summary';
import { RewardChoice } from '../checkout/reward-choice';
import { usePledgeEditor, type EditorMode } from './use-pledge-editor';

export interface PledgeEditorProps {
  readonly pledge: PledgeResponse;
  readonly mode: EditorMode;
  readonly disabled: boolean;
  readonly onSaved: (next: PledgeResponse) => void;
  readonly onReload: () => void;
  readonly onRaiseReturned: (hint: PaymentReturnHint | null) => void;
  readonly mintKey?: () => string;
}

export function PledgeEditor({ pledge, mode, disabled, onSaved, onReload, onRaiseReturned, mintKey }: PledgeEditorProps) {
  const t = useT();
  const locale = useLocale();
  const online = useOnline();
  const router = useRouter();
  const copy = messages(locale).checkout;
  const raising = mode === 'raise';
  const editor = usePledgeEditor({
    pledge,
    mode,
    online: online && !disabled,
    language: locale,
    failures: copy.failures,
    onSaved,
    onReload,
    onRaiseReturned,
    ...(mintKey === undefined ? {} : { mintKey }),
  });
  const locked = disabled || editor.saving;
  const { catalogue, quote, failure } = editor;
  const refusal = quote !== null && !quote.ok ? quote.refusal : null;
  const minimum = editor.reward === null ? null : formatMoney(editor.reward.price);

  let contributionError: string | null = null;
  if (editor.draft.contributionText !== '' && !editor.contribution.ok) {
    contributionError = contributionMessage(editor.contribution.reason, minimum, copy);
  } else if (refusal !== null && (refusal.reason === 'contribution-below-price' || refusal.reason === 'nothing-pledged')) {
    contributionError = refusalMessage(refusal, copy);
  } else if (failure?.field === 'contribution') {
    contributionError = failure.detail;
  }

  let destinationError: string | null = null;
  if (refusal?.reason === 'destination-unpriced' || refusal?.reason === 'destination-missing') {
    destinationError = refusalMessage(refusal, copy);
  } else if (failure?.field === 'destination') {
    destinationError = failure.detail;
  }

  const destinationChoices = editor.destinations
    .map((code) => ({ value: code, label: countryName(code, locale) }))
    .sort((left, right) => left.label.localeCompare(right.label, locale));

  const heading = raising ? t('account.pledges.editor.raiseHeading') : t('account.pledges.editor.heading');
  const intro = raising ? t('account.pledges.editor.raiseIntro') : t('account.pledges.editor.intro');
  const raise = pledge.latestRaise;

  let body;
  if (editor.catalogueFailure !== null) {
    body = (
      <InlineAlert
        variant="danger"
        title={editor.catalogueFailure.title}
        description={editor.catalogueFailure.detail}
        action={<Pill size="sm" variant="ghost" label={t('common.tryAgain')} onPress={editor.reloadCatalogue} />}
        testID="editor-rewards-failed"
      />
    );
  } else if (catalogue === null) {
    body = (
      <SkeletonGroup label={t('account.pledges.editor.loadingRewards')}>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </SkeletonGroup>
    );
  } else {
    const amounts =
      editor.unchanged ? pledge.amounts : quote !== null && quote.ok ? toAmounts(quote.quote) : null;
    body = (
      <View style={styles.form}>
        <RewardChoice rewards={catalogue.rewards} value={editor.draft.choice} onChange={editor.choose} disabled={locked} />
        <Field
          label={
            editor.draft.choice === NO_REWARD ? t('checkout.contribution.legendNoReward') : t('checkout.contribution.legend')
          }
          hint={
            editor.reward === null
              ? t('checkout.contribution.hint')
              : t('checkout.contribution.rewardHint', { amount: formatMoney(editor.reward.price) })
          }
          error={contributionError}
          required
        >
          <TextInput
            value={editor.draft.contributionText}
            onChangeText={editor.setContributionText}
            keyboardType="decimal-pad"
            inputMode="decimal"
            autoComplete="off"
            disabled={locked}
            trailing={<Meta tone="secondary">{catalogue.currency}</Meta>}
            testID="editor-contribution"
          />
        </Field>
        <AddonChoice
          addons={catalogue.addons}
          quantity={editor.addonQuantity}
          onChange={editor.setAddonQuantity}
          disabled={locked}
        />
        {editor.needsDestination ? (
          <Field label={t('checkout.destination.label')} hint={t('checkout.destination.hint')} error={destinationError}>
            <Select
              options={destinationChoices}
              value={editor.draft.destination}
              onChange={editor.setDestination}
              placeholder={t('checkout.destination.placeholder')}
              disabled={locked}
              testID="editor-destination"
            />
          </Field>
        ) : null}
        {raising ? null : (
          <Checkbox
            label={t('checkout.anonymous.label')}
            description={t('account.pledges.editor.anonymousHint')}
            checked={editor.draft.isAnonymous}
            onChange={editor.setAnonymous}
            disabled={locked}
            testID="editor-anonymous"
          />
        )}
        <PledgeSummary
          amounts={amounts}
          source={editor.unchanged ? 'quoted' : 'preview'}
          rewardTitle={editor.reward?.title ?? null}
          destination={editor.draft.destination === null ? null : countryName(editor.draft.destination, locale)}
          waiting="pending"
        >
          <AccentScopeProvider>
            {raising ? (
              <>
                {editor.due === null ? null : (
                  <Text style={styles.due} testID="editor-due">
                    {t('account.pledges.editor.raiseDue', { amount: editor.due })}
                  </Text>
                )}
                <Pill
                  variant="accent"
                  fullWidth
                  label={
                    editor.saving
                      ? t('account.pledges.editor.raiseOpening')
                      : editor.due === null
                        ? t('account.pledges.editor.raiseHeading')
                        : t('account.pledges.editor.raisePay', { amount: editor.due })
                  }
                  busy={editor.saving}
                  disabled={locked || editor.inFlight || editor.unchanged || editor.due === null || !editor.contribution.ok}
                  onPress={editor.raise}
                  testID="editor-raise"
                />
                {editor.unchanged ? (
                  <Text style={styles.note}>{t('account.pledges.editor.noChanges')}</Text>
                ) : editor.notHigher ? (
                  <Text style={styles.note} testID="editor-not-higher">
                    {t('account.pledges.editor.raiseNotHigher')}
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                <Pill
                  variant="accent"
                  fullWidth
                  label={editor.saving ? t('account.pledges.editor.saving') : t('account.pledges.editor.save')}
                  busy={editor.saving}
                  disabled={locked || editor.unchanged || !editor.contribution.ok}
                  onPress={editor.save}
                  testID="editor-save"
                />
                {editor.unchanged && !editor.saved ? (
                  <Text style={styles.note} testID="editor-no-changes">
                    {t('account.pledges.editor.noChanges')}
                  </Text>
                ) : null}
              </>
            )}
          </AccentScopeProvider>
        </PledgeSummary>
        {editor.saved && failure === null ? (
          <InlineAlert
            variant="success"
            title={t('account.pledges.editor.savedTitle')}
            description={t('account.pledges.editor.savedBody')}
            testID="editor-saved"
          />
        ) : null}
        {failure === null ? null : (
          <EditorFailure
            failure={failure}
            rewards={catalogue.rewards}
            onChoose={editor.choose}
            onRetry={raising ? editor.raise : editor.save}
            onSignIn={() => router.push(signInHrefFor(`/pledges/${encodeURIComponent(pledge.id)}`))}
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.section} testID={raising ? 'pledge-raise-editor' : 'pledge-editor'}>
      <Subheading accessibilityRole="header">{heading}</Subheading>
      <Body>{intro}</Body>
      {editor.inFlight && raise != null ? (
        <InlineAlert
          variant="info"
          title={t('account.pledges.editor.raiseHeading')}
          description={t(
            editor.resumeUrl === null
              ? 'account.pledges.editor.raisePending'
              : 'account.pledges.editor.raisePendingResumable',
            { time: formatDateTime(raise.holdExpiresAt, locale) },
          )}
          action={
            editor.resumeUrl === null ? undefined : (
              <Pill
                size="sm"
                variant="primary"
                label={t('account.pledges.editor.raiseResume')}
                disabled={locked}
                onPress={editor.resume}
                testID="editor-resume"
              />
            )
          }
          testID="editor-in-flight"
        />
      ) : null}
      {body}
    </View>
  );
}

function EditorFailure({
  failure,
  rewards,
  onChoose,
  onRetry,
  onSignIn,
}: {
  readonly failure: CheckoutFailure;
  readonly rewards: readonly PublicReward[];
  readonly onChoose: (rewardId: string) => void;
  readonly onRetry: () => void;
  readonly onSignIn: () => void;
}) {
  const t = useT();
  const alternatives = failure.alternatives
    .map((id) => rewards.find((reward) => reward.id === id))
    .filter((reward): reward is PublicReward => reward !== undefined);
  const action =
    failure.status === 401 ? (
      <Pill size="sm" variant="ghost" label={t('mobile.checkout.signIn')} onPress={onSignIn} testID="editor-sign-in" />
    ) : failure.recovery === 'retry' && !failure.clientBug ? (
      <Pill size="sm" variant="ghost" label={t('checkout.tryAgain')} onPress={onRetry} testID="editor-try-again" />
    ) : null;

  return (
    <InlineAlert
      variant="danger"
      title={failure.title}
      description={failure.detail}
      politeness="assertive"
      testID="editor-failure"
      action={
        alternatives.length === 0 && action === null ? undefined : (
          <View style={styles.actions}>
            {alternatives.length === 0 ? null : <Meta tone="primary">{t('checkout.stillAvailable')}</Meta>}
            {alternatives.map((reward) => (
              <Pill
                key={reward.id}
                size="sm"
                variant="ghost"
                label={`${reward.title} · ${formatMoney(reward.price)}`}
                onPress={() => onChoose(reward.id)}
                testID={`editor-alternative-${reward.id}`}
              />
            ))}
            {action}
          </View>
        )
      }
    />
  );
}

const muted = tint(colors.textOnWhite, 0.64);

const styles = StyleSheet.create({
  // A section of the pledge page's white sheet, not a block of its own.
  section: { gap: spacing[4] },
  form: { gap: spacing[6] },
  due: {
    ...font.medium,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
    color: colors.textOnWhite,
    fontVariant: ['tabular-nums'],
  },
  note: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small, color: muted },
  actions: { gap: spacing[2], alignItems: 'flex-start' },
});
