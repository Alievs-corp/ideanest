import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { Bookmark, Heart, Share2, Trash2, X } from 'lucide-react-native';
import { LOCALE_NAMES, SUPPORTED_LOCALES } from '@ideanest/messages';
import { siteUrl } from '../../api/config';
import {
  Avatar,
  Body,
  Caption,
  Card,
  CardTitle,
  CharacterCount,
  Checkbox,
  Chip,
  ChipRow,
  Dialog,
  Display,
  EmptyState,
  ErrorState,
  Eyebrow,
  Field,
  FilePicker,
  FloatingPanel,
  Heading,
  Icon,
  IconButton,
  InlineAlert,
  Media,
  MediaFrame,
  Meta,
  MotionBudgetProvider,
  PasswordInput,
  Pill,
  ProgressBar,
  Radio,
  RadioGroup,
  RemovableChip,
  Screen,
  SearchField,
  Select,
  Sheet,
  Skeleton,
  SkeletonCard,
  SkeletonGroup,
  StatBlock,
  StatRow,
  Story,
  Subheading,
  Switch,
  Tag,
  TextInput,
  Textarea,
  haptics,
  type AvatarSize,
  type CardVariant,
  type HapticEvent,
  type IconButtonSize,
  type IconButtonVariant,
  type InlineAlertVariant,
  type MediaRatioToken,
  type PillSize,
  type PillVariant,
  type StatTrend,
  type TagVariant,
} from '../../components/ui';
import { formatCount, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { colors, radius, size, spacing } from '../../theme';

/**
 * The kit gallery — issue #151. Every component in `components/ui`, in every variant, size and
 * state, grouped by the barrel's sections, so a reviewer can hold the phone next to the web's
 * Storybook and compare them side by side.
 *
 * <h2>Development builds only</h2>
 *
 * The route renders only when `__DEV__` is true, and that check is the guard. A link CAN reach
 * this file: Expo Router's own linking maps `ideanest://dev/kit` (and the universal-link path) to
 * it by itself, before and regardless of our parser. So in a release build the route redirects to
 * `+not-found`, and such a link lands on the ordinary "not found" screen instead of a page of test
 * fixtures. The app's own deep-link parser (`lib/links.ts`) additionally never names it as a
 * destination; `links.test.ts` asserts that, which is a narrower claim than "unreachable".
 *
 * <h2>No words of its own</h2>
 *
 * `lib/no-literal-prose.test.ts` holds this screen to the rule every screen follows: nothing is
 * typed in English. The section headings and the text samples are the components' own names,
 * read from the code (`nameOf`), the variant and size names are the kit's own type values, and
 * every sentence is an existing catalogue key — so the gallery reads in whatever language the
 * phone is in, which is also how a reviewer checks the kit with Azerbaijani and Cyrillic text.
 *
 * <h2>Motion: full</h2>
 *
 * The gallery declares the `full` budget so every animated primitive shows its motion; switch on
 * Reduce Motion on the phone to see each one still.
 */
export default function KitGalleryRoute() {
  if (!__DEV__) return <Redirect href="/+not-found" />;
  return <KitGallery />;
}

/** A component's name as written in the code — a function's `name`, or a `forwardRef`'s render. */
function nameOf(component: unknown): string {
  const candidate = component as {
    displayName?: string;
    name?: string;
    render?: { name?: string };
  };
  return candidate.displayName ?? candidate.render?.name ?? candidate.name ?? '';
}

/** A section's heading: the names of the components in it, as the barrel groups them. */
function heading(components: readonly unknown[]): string {
  return components.map(nameOf).join(' · ');
}

const PILL_VARIANTS: readonly PillVariant[] = ['primary', 'accent', 'ghost', 'outline', 'danger'];
const PILL_SIZES: readonly PillSize[] = ['sm', 'md', 'lg'];
const ICON_BUTTON_VARIANTS: readonly IconButtonVariant[] = [
  'default',
  'light',
  'accent',
  'danger',
  'ghost',
];
const ICON_BUTTON_SIZES: readonly IconButtonSize[] = ['sm', 'md', 'lg'];
const DARK_TAGS: readonly TagVariant[] = ['default', 'success', 'warning', 'danger', 'hot'];
const CARD_VARIANTS: readonly CardVariant[] = ['default', 'active', 'floating'];
const AVATAR_SIZES: readonly AvatarSize[] = ['xs', 'sm', 'md', 'lg'];
const PROGRESS_VALUES = [0, 42, 100, 340] as const;
const TRENDS: readonly StatTrend[] = ['up', 'down', 'neutral'];
const ALERTS: readonly InlineAlertVariant[] = ['info', 'success', 'warning', 'danger'];
const RATIOS: readonly MediaRatioToken[] = ['16/9', '3/2', '4/3', '1/1'];
const HAPTICS = Object.keys(haptics) as HapticEvent[];
const BADGES: Record<StatTrend, string> = { up: '+12', down: '-3', neutral: '0' };
const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';

const noop = () => {};

function KitGallery() {
  const t = useT();
  const locale = useLocale();

  const [chosen, setChosen] = useState<string | null>('discover');
  const [removed, setRemoved] = useState(false);
  const [checked, setChecked] = useState(true);
  const [radio, setRadio] = useState<string | null>(SUPPORTED_LOCALES[0] ?? null);
  const [switched, setSwitched] = useState(true);
  const [select, setSelect] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);

  const trail = [
    { key: 'discover', label: t('common.trail.discover') },
    { key: 'categories', label: t('common.trail.categories') },
    { key: 'collections', label: t('common.trail.collections') },
  ];
  const languages = SUPPORTED_LOCALES.map((code) => ({
    value: code,
    label: LOCALE_NAMES[code],
    accessibilityLanguage: code,
  }));

  return (
    <MotionBudgetProvider level="full">
      <Stack.Screen options={{ title: nameOf(KitGallery) }} />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {/* Foundations ------------------------------------------------------------------ */}
        <Section title={heading([Icon])}>
          <Row>
            {[Heart, Bookmark, Share2, Trash2].map((glyph, index) => (
              <Icon key={index} icon={glyph} size={20} color={colors.textPrimary} />
            ))}
          </Row>
          <Row>
            {HAPTICS.map((event) => (
              <Pill key={event} label={event} size="sm" variant="ghost" onPress={haptics[event]} />
            ))}
          </Row>
        </Section>

        {/* Typography ------------------------------------------------------------------- */}
        <Section title={heading([Display, Heading, Subheading, CardTitle, Body, Story])}>
          <Display>{nameOf(Display)}</Display>
          <Heading>{nameOf(Heading)}</Heading>
          <Subheading>{nameOf(Subheading)}</Subheading>
          <CardTitle>{nameOf(CardTitle)}</CardTitle>
          <Body>{t('shell.tagline')}</Body>
          <Story>{t('shell.tagline')}</Story>
          <Caption>{nameOf(Caption)}</Caption>
          <Meta>{nameOf(Meta)}</Meta>
          <Eyebrow>{nameOf(Eyebrow)}</Eyebrow>
        </Section>

        {/* Actions ---------------------------------------------------------------------- */}
        <Section title={heading([Pill])}>
          {PILL_VARIANTS.map((variant) => (
            <Row key={variant}>
              {PILL_SIZES.map((pillSize) => (
                <Pill
                  key={pillSize}
                  label={`${variant} ${pillSize}`}
                  variant={variant}
                  size={pillSize}
                  onPress={noop}
                />
              ))}
              <Pill label={variant} variant={variant} busy onPress={noop} />
              <Pill label={variant} variant={variant} disabled onPress={noop} />
            </Row>
          ))}
          <Pill label={nameOf(Pill)} iconLeft={Heart} iconRight={Share2} fullWidth onPress={noop} />
        </Section>

        <Section title={heading([IconButton])}>
          {ICON_BUTTON_VARIANTS.map((variant) => (
            <Row key={variant}>
              {ICON_BUTTON_SIZES.map((buttonSize) => (
                <IconButton
                  key={buttonSize}
                  icon={Heart}
                  label={`${variant} ${buttonSize}`}
                  variant={variant}
                  size={buttonSize}
                  onPress={noop}
                />
              ))}
              <IconButton
                icon={Bookmark}
                label={variant}
                variant={variant}
                selected
                onPress={noop}
              />
              <IconButton icon={X} label={variant} variant={variant} disabled onPress={noop} />
            </Row>
          ))}
        </Section>

        {/* Primitives ------------------------------------------------------------------- */}
        <Section title={heading([Tag])}>
          <Row>
            {DARK_TAGS.map((variant) => (
              <Tag key={variant} label={variant} variant={variant} />
            ))}
            <Tag label={nameOf(Icon)} icon={Heart} />
          </Row>
        </Section>

        <Section title={heading([Chip, ChipRow, RemovableChip])}>
          <ChipRow>
            {trail.map((chip, index) => (
              <Chip
                key={chip.key}
                label={chip.label}
                count={index * 7}
                selected={chosen === chip.key}
                onPress={() => setChosen(chosen === chip.key ? null : chip.key)}
              />
            ))}
            <Chip label={t('common.trail.home')} icon={Heart} disabled onPress={noop} />
          </ChipRow>
          {removed ? (
            <Pill
              label={t('common.tryAgain')}
              variant="ghost"
              size="sm"
              onPress={() => setRemoved(false)}
            />
          ) : (
            <Row>
              <RemovableChip
                label={t('common.trail.discover')}
                removeLabel={t('discovery.feed.removeChip', {
                  group: t('common.trail.categories'),
                  label: t('common.trail.discover'),
                })}
                onRemove={() => setRemoved(true)}
              />
            </Row>
          )}
        </Section>

        <Section title={heading([Card])}>
          {CARD_VARIANTS.map((variant) => (
            <Card key={variant} variant={variant}>
              <CardTitle>{variant}</CardTitle>
              <Body>{t('common.card.rule')}</Body>
              <Row>
                <Tag
                  label={variant}
                  variant={
                    variant === 'active' ? 'onLime' : variant === 'floating' ? 'onWhite' : 'default'
                  }
                />
              </Row>
            </Card>
          ))}
          <Row>
            {(['sm', 'md', 'lg'] as const).map((cardSize) => (
              <Card key={cardSize} size={cardSize} onPress={noop} accessibilityLabel={cardSize}>
                <Meta>{cardSize}</Meta>
              </Card>
            ))}
            <Card
              variant="active"
              size="sm"
              selected
              onPress={noop}
              accessibilityLabel={nameOf(Card)}
            >
              <Meta>{nameOf(Card)}</Meta>
            </Card>
          </Row>
        </Section>

        <Section title={heading([Avatar])}>
          <Row>
            {AVATAR_SIZES.map((avatarSize) => (
              <Avatar key={avatarSize} name={`${avatarSize} ${nameOf(Avatar)}`} size={avatarSize} />
            ))}
            <Avatar name={nameOf(Avatar)} src={`${siteUrl()}/icon`} size="lg" />
          </Row>
        </Section>

        <Section title={heading([ProgressBar])}>
          {PROGRESS_VALUES.map((value) => (
            <ProgressBar
              key={value}
              completionPercent={String(value)}
              label={`${nameOf(ProgressBar)} ${value}`}
              size={value === 42 ? 'md' : 'sm'}
            />
          ))}
        </Section>

        <Section title={heading([StatBlock, StatRow])}>
          <StatRow>
            {TRENDS.map((trend, index) => (
              <StatBlock
                key={trend}
                value={formatCount(1280 * (index + 1), locale)}
                label={t('campaign.funding.backers.other')}
                badge={BADGES[trend]}
                badgeTone={trend}
                size={index === 0 ? 'lg' : 'md'}
              />
            ))}
          </StatRow>
        </Section>

        <Section title={heading([FloatingPanel])}>
          <FloatingPanel
            title={nameOf(FloatingPanel)}
            actions={<IconButton icon={X} label={t('common.cancel')} onPress={noop} />}
          >
            <Body>{t('common.card.rule')}</Body>
            <Pill label={t('common.save')} onPress={noop} />
          </FloatingPanel>
        </Section>

        {/* Data and media --------------------------------------------------------------- */}
        <Section title={heading([InlineAlert])}>
          {ALERTS.map((variant) => (
            <InlineAlert
              key={variant}
              variant={variant}
              title={variant}
              description={t('mobile.offline.banner')}
              politeness="polite"
              action={
                variant === 'danger' ? (
                  <Pill label={t('common.tryAgain')} variant="ghost" size="sm" onPress={noop} />
                ) : undefined
              }
              onDismiss={variant === 'info' ? noop : undefined}
            />
          ))}
        </Section>

        <Section title={heading([EmptyState, ErrorState])}>
          <EmptyState
            title={t('account.signals.saved.emptyTitle')}
            description={t('account.signals.saved.emptyBody')}
            action={<Pill label={t('common.save')} onPress={noop} />}
          />
          <EmptyState variant="filtered" title={t('discovery.feed.emptyFilteredTitle')} />
          <ErrorState
            title={t('discovery.feed.errorTitle')}
            description={t('discovery.feed.unreachable')}
            onRetry={noop}
            traceId={TRACE}
          />
        </Section>

        <Section title={heading([Skeleton, SkeletonGroup, SkeletonCard])}>
          <SkeletonGroup>
            <View style={styles.stack}>
              <Row>
                <Skeleton circle height={size.avatarInCard} />
                <View style={styles.grow}>
                  <Skeleton width="60%" />
                  <Skeleton width="40%" height={12} />
                </View>
              </Row>
              <SkeletonCard />
            </View>
          </SkeletonGroup>
        </Section>

        <Section title={heading([Media, MediaFrame])}>
          <Media
            src={`${siteUrl()}/icon`}
            ratio="1/1"
            radius="lg"
            decorative
            style={styles.thumb}
          />
          {RATIOS.map((ratio) => (
            <View key={ratio} style={styles.stack}>
              <Meta>{ratio}</Meta>
              <MediaFrame ratio={ratio} radius="md" />
            </View>
          ))}
        </Section>

        <Section title={heading([Screen])}>
          {/* The scaffold in a box: no content and no error, so it draws its empty state. */}
          <View style={styles.screenBox}>
            <Screen
              hasContent={false}
              scroll={false}
              offlineNotice={t('mobile.offline.banner')}
              empty={<EmptyState title={t('account.signals.saved.emptyTitle')} />}
            />
          </View>
        </Section>

        {/* Form ------------------------------------------------------------------------- */}
        <Section title={heading([Field, TextInput, PasswordInput, Textarea, CharacterCount])}>
          <Field label={t('auth.fields.email')} hint={t('mobile.signIn.recoveryHint')} required>
            <TextInput value={text} onChangeText={setText} />
          </Field>
          <Field label={t('auth.fields.email')} error={t('shell.whatsapp.errors.firstName')}>
            <TextInput value="" size="lg" />
          </Field>
          <Field label={t('auth.fields.email')}>
            <TextInput value={text} disabled />
          </Field>
          <Field label={t('auth.fields.password')}>
            <PasswordInput />
          </Field>
          <Field label={t('shell.whatsapp.fields.message')}>
            <Textarea value={text} onChangeText={setText} maxLength={120} />
            <CharacterCount count={text.length} limit={20} />
          </Field>
        </Section>

        <Section title={heading([Select, Checkbox, Radio, Switch])}>
          <Field label={t('mobile.language.title')}>
            <Select
              options={languages}
              value={select}
              onChange={setSelect}
              placeholder={t('mobile.language.title')}
            />
          </Field>
          <Checkbox label={t('common.save')} checked={checked} onChange={setChecked} />
          <Checkbox
            label={t('common.save')}
            description={t('common.card.rule')}
            checked
            indeterminate
            onChange={noop}
          />
          <Checkbox label={t('common.save')} checked={false} disabled onChange={noop} />
          <Field label={t('mobile.language.title')} grouped>
            <RadioGroup value={radio} onChange={setRadio}>
              {languages.map((language) => (
                <Radio
                  key={language.value}
                  value={language.value}
                  label={language.label}
                  accessibilityLanguage={language.accessibilityLanguage}
                />
              ))}
            </RadioGroup>
          </Field>
          <Switch
            label={t('mobile.lock.face')}
            description={t('mobile.lock.keychain')}
            value={switched}
            onValueChange={setSwitched}
          />
          <Switch label={t('mobile.lock.face')} value={false} disabled onValueChange={noop} />
        </Section>

        <Section title={heading([FilePicker, SearchField])}>
          <FilePicker onPick={noop} label={nameOf(FilePicker)} maxBytes={5 * 1024 * 1024} />
          <SearchField
            label={t('discovery.suggest.inputLabel')}
            placeholder={t('discovery.suggest.inputLabel')}
            value={search}
            onChangeText={setSearch}
            onSubmit={setSearch}
            suggestions={search === '' ? [] : trail}
          />
        </Section>

        {/* Overlay ---------------------------------------------------------------------- */}
        <Section title={heading([Dialog, Sheet])}>
          <Row>
            <Pill label={nameOf(Dialog)} variant="outline" onPress={() => setDialog(true)} />
            <Pill label={nameOf(Sheet)} variant="outline" onPress={() => setSheet(true)} />
          </Row>
        </Section>
      </ScrollView>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title={t('mobile.me.signOutConfirm.title')}
        description={t('mobile.me.signOutConfirm.body')}
        footer={
          <>
            <Pill
              label={t('shell.actions.signOut')}
              variant="danger"
              fullWidth
              onPress={() => setDialog(false)}
            />
            <Pill
              label={t('common.cancel')}
              variant="outline"
              fullWidth
              onPress={() => setDialog(false)}
            />
          </>
        }
      />

      <Sheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title={t('shell.whatsapp.title')}
        footer={<Pill label={t('common.cancel')} fullWidth onPress={() => setSheet(false)} />}
      >
        <Body>{t('shell.whatsapp.intro')}</Body>
      </Sheet>
    </MotionBudgetProvider>
  );
}

/** One section of the gallery, headed by the names of the components in it. */
function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Subheading accessibilityRole="header">{title}</Subheading>
      <View style={styles.stack}>{children}</View>
    </View>
  );
}

/** Samples side by side, wrapping. */
function Row({ children }: { readonly children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  page: {
    padding: size.cardPaddingSmall,
    gap: spacing[10],
    paddingBottom: spacing[16],
    backgroundColor: colors.surface1,
  },
  section: { gap: spacing[4] },
  stack: { gap: spacing[3] },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[3] },
  grow: { flex: 1, gap: spacing[2] },
  thumb: { width: 96 },
  screenBox: { height: 360, borderRadius: radius.lg, overflow: 'hidden' },
});

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
