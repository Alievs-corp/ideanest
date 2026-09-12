'use client';

import { useEffect, useId, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  CharacterCount,
  Field,
  IconButton,
  InlineAlert,
  Pill,
  Select,
  Switch,
  Textarea,
  TextInput,
} from '@ideanest/ui';
import { DEFAULT_CURRENCY } from '../../lib/money';
import {
  createReward,
  patchReward,
  replaceShippingRules,
  type Item,
  type ProjectEdit,
  type Reward,
} from '../../lib/projects/api';
import { characterCount } from '../../lib/projects/basics';
import {
  REWARD_TITLE_MAX_CHARACTERS,
  SHIPPING_SCOPES,
  emptyReward,
  isEmptyPatch,
  isRewardField,
  isShippedScope,
  isShippingType,
  newRewardFrom,
  rewardDraftFrom,
  rewardPatchFrom,
  shippingRatesChanged,
  shippingRatesFrom,
  validateReward,
  type RewardDraft,
  type RewardErrors,
  type RewardLineDraft,
  type ShippingRateDraft,
} from '../../lib/projects/rewards';
import { EditorDrawer } from './EditorDrawer';
import { fieldErrorsFrom } from './rewardFailure';
import { describeFailure, type SaveFailure } from './useAutosave';

/**
 * One reward tier: what a backer selects and pays for.
 *
 * <h3>WHY THIS DOES NOT AUTOSAVE</h3>
 *
 * The basics and story tabs write every keystroke through `useAutosave`, and
 * this tab does not. The service's own contract assumes it will —
 * `RewardPatchRequest` says "the rewards tab autosaves one input at a time" —
 * and merge-patch is exactly what makes an explicit save cheap here too: only
 * the fields that changed are sent, so the contract is honoured either way.
 * What differs is what a half-typed value MEANS.
 *
 *   A half-typed title is a title that is briefly wrong. A half-typed PRICE is
 *   a different, valid, chargeable price. Somebody typing 19.99 passes through
 *   1, 19, 19.9 — and each of those is a figure the service accepts, stores,
 *   and would quote to a backer looking at the page in that second.
 *
 *   A half-typed LIMIT is worse. Typing 100 over 5 passes through 1, and §5.3
 *   refuses a limit below what is already claimed — so an edit that is
 *   perfectly legal at the end of the word is refused in the middle of it, and
 *   autosave retries the same rejected body until the creator gives up.
 *
 *   And creating a tier is a `POST`. It cannot be debounced into existence
 *   without creating one tier per pause in typing.
 *
 * So the drawer commits on Save. Nothing is forked to do it: the failure is
 * described by `useAutosave`'s own `describeFailure`, and the field messages
 * land through the same `fieldErrorsFrom` the item editor uses. What is not
 * reused is the debounce, and that is the whole of the difference.
 *
 * <h3>TWO REQUESTS, DELIBERATELY</h3>
 *
 * The rate table is replaced through its own `PUT` (see `replaceShippingRules`)
 * because a rate table is read as a whole by whatever quotes from it. So a save
 * that changes both the tier and its rates is two requests, in that order — the
 * `PUT` is refused on a tier that is not shipped, so the scope has to have been
 * changed first. When the second one fails the first has already succeeded, and
 * this says exactly that rather than reporting a failure that would leave the
 * creator retyping a tier that is already saved.
 *
 * <h3>WHAT IS DELIBERATELY NOT HERE</h3>
 *
 * <strong>Images on a tier.</strong> §4.6 lists them. `reward_tiers` has no
 * image column and `RewardResponse` carries none, so there is nowhere to put
 * one; a tier's pictures are the pictures of the items it contains, which do
 * have an `imageUrl`. Inventing a column here would be a field that forgets
 * what it was told.
 *
 * <strong>A country picker.</strong> A destination is typed as its two-letter
 * code, which is what the service stores and re-checks. Nothing in the
 * repository holds a list of countries with their names, and a hard-coded one
 * in a drawer is a list that goes stale where nobody is looking.
 */
import type {
  RewardTierEditorCopy,
  RewardsVocabularyCopy,
} from '../../lib/i18n/campaign-editor-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralise } from '../../lib/i18n/plurals';

export interface RewardTierEditorProps {
  /** This drawer's words. */
  copy: RewardTierEditorCopy;
  /** The vocabulary `validateReward` refuses in, and the delivery scopes' names. */
  vocabulary: RewardsVocabularyCopy;
  project: ProjectEdit;
  open: boolean;
  /** The tier being edited, or null to create one. */
  reward: Reward | null;
  /** The campaign's items, which the composition is built from. */
  items: readonly Item[];
  onOpenChange: (open: boolean) => void;
  /** The server's answer, which is the authority on what the tier now is. */
  onSaved: (reward: Reward) => void;
}

export function RewardTierEditor({
  copy,
  vocabulary,
  project,
  open,
  reward,
  items,
  onOpenChange,
  onSaved,
}: RewardTierEditorProps) {
  /**
   * A tier is priced in the campaign's currency or the service refuses it, so
   * there is no currency control here — offering a choice would be offering a
   * refusal. The basics tab owns that decision; this reads it.
   */
  const currency = project.goal?.currency ?? DEFAULT_CURRENCY;

  const [draft, setDraft] = useState<RewardDraft>(() => emptyReward(currency));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  /** Set when the tier saved and its rates did not. See `save` below. */
  const [ratesUnsaved, setRatesUnsaved] = useState(false);
  const [attempted, setAttempted] = useState(false);

  /**
   * The tier as the service last confirmed it, which is what a patch is
   * measured against.
   *
   * <strong>Not the `reward` prop.</strong> A save can half-succeed — the tier
   * is stored and the rate table is refused — and the draft has to survive
   * that untouched so the creator can fix the rates and press Save again. If
   * the panel handed a new `reward` down and this component re-seeded from it,
   * that second save would be typing the rates in a third time.
   *
   * It also settles what the next save IS. After a creation succeeds this
   * holds the tier that now exists, so pressing Save again patches it rather
   * than creating a twin.
   */
  const [target, setTarget] = useState<Reward | null>(reward);

  const earlyBirdHintId = useId();
  const featuredHintId = useId();
  const secretHintId = useId();
  const addonHintId = useId();

  useEffect(() => {
    if (!open) return;
    /*
     * Seeded when the drawer opens, and only then. The panel never changes
     * which tier an open drawer is about — the list it would be changed from is
     * behind the drawer — so this runs once per editing session, which is
     * exactly the guarantee the draft needs.
     */
    setDraft(reward === null ? emptyReward(currency) : rewardDraftFrom(reward));
    setTarget(reward);
    setFailure(null);
    setRatesUnsaved(false);
    setAttempted(false);
    // `reward` and `currency` are read at the moment the drawer opens and are
    // deliberately not dependencies: re-running this while it is open is the
    // one thing that would destroy work.
  }, [open]);

  /**
   * Places already taken, which §5.3 makes the floor a limit may be lowered to.
   *
   * Claimed and reserved together: a reservation is somebody entering their
   * card details, and it is as taken as a confirmed pledge.
   */
  const committedQuantity =
    target === null ? 0 : target.claimedQuantity + target.reservedQuantity;

  const errors = validateReward(draft, vocabulary.reward, { committedQuantity });
  const serverErrors = fieldErrorsFrom(failure, isRewardField);
  const visible: RewardErrors = { ...(attempted ? errors : {}), ...serverErrors };
  const invalid = Object.keys(errors).length > 0;

  /*
   * The tier says whether its own price is frozen. This used to ask
   * `isLocked(project, 'price')`, which was a guess at a name that is never
   * there: `ProjectEdit.lockedFields` is filtered server-side to the campaign's
   * own patch keys, so it lists `goal` and `durationDays` and could not list a
   * field of a different body. The lookup silently never matched and the control
   * stayed enabled on live campaigns — #183.
   *
   * The client still does not implement the rule. It only stops offering an edit
   * the service has said it will refuse, and a refusal is rendered either way.
   */
  const priceLocked = target?.pricingLocked ?? false;

  const chosen = new Set(draft.items.map((line) => line.itemId));
  const available = items.filter((item) => !chosen.has(item.id));

  function line(itemId: string): Item | undefined {
    return items.find((item) => item.id === itemId);
  }

  function addLine(itemId: string): void {
    if (itemId === '') return;
    setDraft({ ...draft, items: [...draft.items, { itemId, quantity: '1' }] });
  }

  function changeLine(index: number, next: RewardLineDraft): void {
    setDraft({ ...draft, items: draft.items.map((old, at) => (at === index ? next : old)) });
  }

  function removeLine(index: number): void {
    setDraft({ ...draft, items: draft.items.filter((_, at) => at !== index) });
  }

  function addRate(): void {
    setDraft({
      ...draft,
      shippingRules: [
        ...draft.shippingRules,
        // Zero is the default for an additional item, and it is a real offer:
        // "one flat rate however many you order".
        { countryCode: '', amount: '', additionalItemAmount: '0.00' },
      ],
    });
  }

  function changeRate(index: number, next: ShippingRateDraft): void {
    setDraft({
      ...draft,
      shippingRules: draft.shippingRules.map((old, at) => (at === index ? next : old)),
    });
  }

  function removeRate(index: number): void {
    setDraft({ ...draft, shippingRules: draft.shippingRules.filter((_, at) => at !== index) });
  }

  async function save(): Promise<void> {
    setAttempted(true);
    if (invalid) return;

    setSaving(true);
    setFailure(null);
    setRatesUnsaved(false);

    /*
     * Whether the tier itself is already stored, which is what makes the
     * two-request save reportable. If the rates fail after this is true, the
     * creator has to be told the tier is safe — otherwise they retype it.
     */
    let stored: Reward | null = target;

    try {
      if (target === null) {
        stored = await createReward(project.id, newRewardFrom(draft));
      } else {
        const patch = rewardPatchFrom(draft, target);
        if (!isEmptyPatch(patch)) stored = await patchReward(target.id, patch);
      }

      /*
       * The rates go second because the `PUT` is refused on a tier that is not
       * shipped: a save that turns a digital tier into a shipped one has to
       * change the scope before the rates are accepted.
       */
      const rates = shippingRatesFrom(draft);
      const needsRates = target === null ? rates.length > 0 : shippingRatesChanged(draft, target);

      if (stored !== null && stored !== target) {
        // Recorded before the second request, so a refusal there leaves this
        // component knowing the tier is already stored.
        setTarget(stored);
        onSaved(stored);
      }

      if (needsRates && stored !== null) {
        try {
          const repriced = await replaceShippingRules(stored.id, rates);
          setTarget(repriced);
          onSaved(repriced);
        } catch (cause) {
          setRatesUnsaved(true);
          setFailure(describeFailure(cause));
          return;
        }
      }

      onOpenChange(false);
    } catch (cause) {
      setFailure(describeFailure(cause));
    } finally {
      setSaving(false);
    }
  }

  const shipped = isShippedScope(draft.shippingType);

  return (
    <EditorDrawer
      copy={copy.drawer}
      open={open}
      onOpenChange={onOpenChange}
      title={target === null ? copy.addTitle : copy.editTitle}
      description={copy.description}
      saving={saving}
      onSave={() => void save()}
    >
      <div className="flex flex-col gap-6">
        {failure !== null && (
          <InlineAlert
            variant="danger"
            title={ratesUnsaved ? copy.ratesNotSavedTitle : copy.notSavedTitle}
          >
            <p>{failure.message}</p>
            {ratesUnsaved ? (
              <p className="mt-2 text-white/64">
                {copy.rest} <strong className="text-white">was</strong> saved.
                Only the per-country rates were refused, so fix them and save again — the rest will
                not be sent twice.
              </p>
            ) : (
              <p className="mt-2 text-white/64">
                Nothing you typed has been lost — it is still in the fields below.
              </p>
            )}
          </InlineAlert>
        )}

        <Field
          label={copy.title}
          required
          hint={fillPlaceholders(copy.titleHint, { max: String(REWARD_TITLE_MAX_CHARACTERS) })}
          error={visible.title}
        >
          <TextInput
            value={draft.title}
            autoComplete="off"
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
          <CharacterCount
            count={characterCount(draft.title)}
            limit={REWARD_TITLE_MAX_CHARACTERS}
            copy={copy.characterCount}
            locale={copy.locale}
          />
        </Field>

        <Field
          label={copy.summary}
          hint={copy.summaryHint}
          error={visible.description}
        >
          <Textarea
            rows={3}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </Field>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            label={copy.price}
            required
            hint={
              priceLocked
                ? fillPlaceholders(copy.priceHintLocked, { currency })
                : fillPlaceholders(copy.priceHint, { currency })
            }
            error={visible.price}
          >
            {/*
              `inputMode="decimal"` rather than `type="number"`. A number input
              accepts `1e5`, hides what it cannot parse, and on several browsers
              loses the value to a scroll wheel — none of which is acceptable
              for the figure a card is charged. The value stays text here and
              becomes a `Decimal` on the way out.
            */}
            <TextInput
              inputMode="decimal"
              autoComplete="off"
              value={draft.priceAmount}
              disabled={priceLocked}
              trailing={<span aria-hidden="true">{currency}</span>}
              onChange={(event) => setDraft({ ...draft, priceAmount: event.target.value })}
            />
          </Field>

          <Field
            label={copy.estimatedDelivery}
            hint={copy.estimatedDeliveryHint}
            error={visible.estimatedDelivery}
          >
            {/*
              A date, because the column is one and "which tiers are overdue" is
              then a comparison rather than a parse. A month is what a creator
              can honestly promise, which is what the hint says.
            */}
            <TextInput
              type="date"
              value={draft.estimatedDelivery}
              onChange={(event) => setDraft({ ...draft, estimatedDelivery: event.target.value })}
            />
          </Field>
        </div>

        <Field
          label={copy.places}
          hint={
            committedQuantity > 0
              ? pluralise(copy.locale, copy.placesHintCommitted, committedQuantity)
              : copy.placesHint
          }
          error={visible.limitQuantity}
        >
          <TextInput
            inputMode="numeric"
            autoComplete="off"
            value={draft.limitQuantity}
            onChange={(event) => setDraft({ ...draft, limitQuantity: event.target.value })}
          />
        </Field>

        <Field
          label={copy.delivery}
          hint={vocabulary.scopes[draft.shippingType].hint}
          error={visible.shippingType}
        >
          <Select
            value={draft.shippingType}
            onChange={(event) => {
              // Narrowed rather than cast: the value arrives as a string, and
              // `isShippingType` checks it against the very list the options
              // below are rendered from.
              const scope = event.target.value;
              if (isShippingType(scope)) setDraft({ ...draft, shippingType: scope });
            }}
          >
            {SHIPPING_SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {vocabulary.scopes[scope].label}
              </option>
            ))}
          </Select>
        </Field>

        {shipped && (
          <ShippingRates
            copy={copy}
            rules={draft.shippingRules}
            currency={currency}
            error={visible.rules}
            onAdd={addRate}
            onChange={changeRate}
            onRemove={removeRate}
          />
        )}

        <Composition
            copy={copy}
          lines={draft.items}
          available={available}
          resolve={line}
          error={visible.items}
          onAdd={addLine}
          onChange={changeLine}
          onRemove={removeLine}
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            label={copy.opens}
            hint={copy.opensHint}
            error={visible.availableFrom}
          >
            <TextInput
              type="datetime-local"
              value={draft.availableFrom}
              onChange={(event) => setDraft({ ...draft, availableFrom: event.target.value })}
            />
          </Field>

          <Field
            label={copy.closes}
            hint={copy.closesHint}
            error={visible.availableUntil}
          >
            <TextInput
              type="datetime-local"
              value={draft.availableUntil}
              onChange={(event) => setDraft({ ...draft, availableUntil: event.target.value })}
            />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-5 rounded-lg border border-white/8 bg-surface-2 p-5">
          <legend className="px-1 text-sm font-medium text-white">{copy.offering}</legend>

          <div>
            <Switch
              checked={draft.isEarlyBird}
              label={copy.earlyBird}
              aria-describedby={earlyBirdHintId}
              onCheckedChange={(checked) => setDraft({ ...draft, isEarlyBird: checked })}
            />
            <p id={earlyBirdHintId} className="mt-2 text-[13px] text-white/64">
              A better deal that runs out. It needs either a closing date or a limited number of
              places — without one it is an ordinary reward with a label that hurries people for
              nothing.
            </p>
            {visible.isEarlyBird !== undefined && (
              <InlineAlert variant="danger" className="mt-3">
                {visible.isEarlyBird}
              </InlineAlert>
            )}
          </div>

          <div>
            <Switch
              checked={draft.isFeatured}
              label={copy.featured}
              aria-describedby={featuredHintId}
              onCheckedChange={(checked) => setDraft({ ...draft, isFeatured: checked })}
            />
            <p id={featuredHintId} className="mt-2 text-[13px] text-white/64">
              {copy.featuredHint}
            </p>
            {visible.isFeatured !== undefined && (
              <InlineAlert variant="danger" className="mt-3">
                {visible.isFeatured}
              </InlineAlert>
            )}
          </div>

          <div>
            <Switch
              checked={draft.isSecret}
              label={copy.secret}
              aria-describedby={secretHintId}
              onCheckedChange={(checked) => setDraft({ ...draft, isSecret: checked })}
            />
            <p id={secretHintId} className="mt-2 text-[13px] text-white/64">
              Left out of the public list and reached by a private token instead. Making it public
              again destroys that token, so any link already sent stops working.
            </p>
            {target?.isSecret === true && target.secretToken != null && (
              /*
                Read from the saved tier rather than from the draft, because the
                token is the service's to mint: it appears once the tier has
                been saved as secret and it changes if the tier is ever made
                public again.
              */
              <p className="mt-2 rounded-md bg-surface-3 p-3 font-mono text-[13px] break-all text-white/64">
                <span className="mr-2 font-sans text-white/40">{copy.token}</span>
                {target.secretToken}
              </p>
            )}
          </div>

          <div>
            <Switch
              checked={draft.isAddon}
              label={copy.addOn}
              aria-describedby={addonHintId}
              onCheckedChange={(checked) => setDraft({ ...draft, isAddon: checked })}
            />
            <p id={addonHintId} className="mt-2 text-[13px] text-white/64">
              {copy.addOnHint}
            </p>
          </div>
        </fieldset>
      </div>
    </EditorDrawer>
  );
}

/* -------------------------------------------------------------------------
 * The composition
 * ---------------------------------------------------------------------- */

/**
 * Which items the tier contains, and how many of each.
 *
 * A `Select` of the items not yet chosen, rather than a checkbox per item.
 * A campaign can hold dozens of items and a tier usually contains two or three,
 * so a list of every item with most of them unticked is a list a creator has to
 * read in full to find what is in the reward.
 *
 * The quantity is a text field per line, and each one is named after the item
 * it is about — "Quantity of Enamel mug" — because "Quantity" repeated four
 * times is four controls a screen-reader user cannot tell apart.
 */
function Composition({
  copy,
  lines,
  available,
  resolve,
  error,
  onAdd,
  onChange,
  onRemove,
}: {
  copy: RewardTierEditorCopy;
  lines: readonly RewardLineDraft[];
  available: readonly Item[];
  resolve: (itemId: string) => Item | undefined;
  error: string | undefined;
  onAdd: (itemId: string) => void;
  onChange: (index: number, next: RewardLineDraft) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <Field
      grouped
      label={copy.contents}
      hint={copy.contentsHint}
      error={error}
    >
      {lines.length > 0 && (
        <ul className="flex flex-col gap-2">
          {lines.map((entry, index) => {
            const item = resolve(entry.itemId);
            /*
             * An item the campaign no longer has. It cannot normally happen —
             * the service refuses deleting an item a tier contains — but a
             * stale list in another tab can produce it, and rendering nothing
             * would silently drop the line from the composition on the next
             * save.
             */
            const name = item?.name ?? copy.missingItem;

            return (
              <li
                key={entry.itemId}
                className="flex items-center gap-3 rounded-md border border-white/8 bg-surface-3 p-3"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-white">{name}</span>

                <span className="flex items-center gap-2 text-[13px] text-white/64">
                  {/*
                    The multiplication sign is decoration; the control's name is
                    the whole sentence, because "Quantity" repeated four times
                    is four controls a screen-reader user cannot tell apart.
                  */}
                  <span aria-hidden="true">×</span>
                  <TextInput
                    size="sm"
                    inputMode="numeric"
                    autoComplete="off"
                    aria-label={fillPlaceholders(copy.quantityOf, { name })}
                    className="w-16 text-center"
                    value={entry.quantity}
                    onChange={(event) =>
                      onChange(index, { ...entry, quantity: event.target.value })
                    }
                  />
                </span>

                <IconButton
                  icon={<Trash2 />}
                  label={fillPlaceholders(copy.removeFromReward, { name })}
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(index)}
                />
              </li>
            );
          })}
        </ul>
      )}

      {available.length > 0 ? (
        <Select
          placeholder={copy.addItemPlaceholder}
          value=""
          aria-label={copy.addItem}
          onChange={(event) => onAdd(event.target.value)}
        >
          {available.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
      ) : (
        <p className="text-[13px] text-white/40">
          {lines.length === 0
            ? copy.noItemsYet
            : copy.everyItemAdded}
        </p>
      )}
    </Field>
  );
}

/* -------------------------------------------------------------------------
 * The rate table
 * ---------------------------------------------------------------------- */

/**
 * What shipping this tier costs, per destination.
 *
 * A destination with no rate cannot be chosen at checkout, which is what makes
 * the table the thing that decides where a reward can go — so the hint says it
 * rather than leaving a creator to discover it from a backer's complaint.
 *
 * Every control is named after its destination, because a table of three
 * unnamed "Amount" fields is three controls a screen-reader user cannot tell
 * apart. A row with no destination yet is named by its position, which is the
 * only honest thing to call it.
 */
function ShippingRates({
  copy,
  rules,
  currency,
  error,
  onAdd,
  onChange,
  onRemove,
}: {
  copy: RewardTierEditorCopy;
  rules: readonly ShippingRateDraft[];
  currency: string;
  error: string | undefined;
  onAdd: () => void;
  onChange: (index: number, next: ShippingRateDraft) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <Field
      grouped
      label={copy.shipping}
      hint={fillPlaceholders(copy.ratesHint, { currency })}
      error={error}
    >
      {rules.length === 0 ? (
        <p className="text-[13px] text-white/40">
          {copy.noDestinations}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((rule, index) => {
            const named =
              rule.countryCode.trim() === ''
                ? `destination ${index + 1}`
                : rule.countryCode.trim().toUpperCase();

            return (
              /*
                Keyed by position, which is the only stable thing a row has: a
                destination starts empty and two rows may briefly hold the same
                code while one of them is being retyped, so the country cannot
                be the key. Every input here is controlled, so a removal
                re-renders the remaining rows with the right values; what a
                positional key costs is the caret staying put when a row above
                the focused one is deleted, which is a smaller price than a
                duplicate key silently dropping a rate.
              */
              <li
                key={index}
                className="grid grid-cols-[4.5rem_1fr_1fr_auto] items-center gap-2 rounded-md border border-white/8 bg-surface-3 p-3"
              >
                <TextInput
                  size="sm"
                  autoComplete="off"
                  maxLength={2}
                  placeholder={copy.countryPlaceholder}
                  aria-label={fillPlaceholders(copy.countryCodeFor, { name: named })}
                  className="uppercase"
                  value={rule.countryCode}
                  onChange={(event) => onChange(index, { ...rule, countryCode: event.target.value })}
                />
                <TextInput
                  size="sm"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={copy.ratePlaceholder}
                  aria-label={fillPlaceholders(copy.shippingRateTo, { name: named })}
                  value={rule.amount}
                  onChange={(event) => onChange(index, { ...rule, amount: event.target.value })}
                />
                <TextInput
                  size="sm"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={copy.extraPlaceholder}
                  aria-label={fillPlaceholders(copy.additionalRateTo, { name: named })}
                  value={rule.additionalItemAmount}
                  onChange={(event) =>
                    onChange(index, { ...rule, additionalItemAmount: event.target.value })
                  }
                />
                <IconButton
                  icon={<Trash2 />}
                  label={fillPlaceholders(copy.removeNamed, { name: named })}
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(index)}
                />
              </li>
            );
          })}
        </ul>
      )}

      <Pill
        variant="ghost"
        size="sm"
        className="self-start"
        iconLeft={<Plus aria-hidden="true" className="size-4" />}
        onClick={onAdd}
      >
        {copy.addDestination}
      </Pill>
    </Field>
  );
}
