'use client';

import { useEffect, useId, useState } from 'react';
import { CharacterCount, Field, InlineAlert, Switch, Textarea, TextInput } from '@ideanest/ui';
import { createItem, patchItem, type Item } from '../../lib/projects/api';
import { characterCount } from '../../lib/projects/basics';
import {
  EMPTY_ITEM,
  ITEM_NAME_MAX_CHARACTERS,
  isEmptyPatch,
  isItemField,
  itemDraftFrom,
  itemPatchFrom,
  newItemFrom,
  validateItem,
  type ItemDraft,
  type ItemErrors,
} from '../../lib/projects/rewards';
import { EditorDrawer } from './EditorDrawer';
import { fieldErrorsFrom } from './rewardFailure';
import { describeFailure, type SaveFailure } from './useAutosave';

/**
 * One item: the atomic thing a campaign produces, which tiers are composed
 * from.
 *
 * <h3>IT SAVES WHEN THE CREATOR SAYS SO</h3>
 *
 * The basics and story tabs autosave, and this deliberately does not. The full
 * reasoning is on `RewardsPanel`; one half of it applies here on its own.
 * Creating an item is a `POST`, and a `POST` cannot be debounced — a form that
 * fired one on a pause in typing would create an item called "H" and five more
 * as the word was finished, each of them a row a creator then has to delete.
 *
 * Everything else is reused rather than reinvented. `describeFailure` turns a
 * refusal into a sentence exactly as it does for an autosave, and the field
 * messages land through the same `fieldErrorsFrom` both editors use, so a
 * refusal reads the same wherever in the editor it happened.
 */
import type { ItemEditorCopy } from '../../lib/i18n/campaign-editor-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

export interface ItemEditorProps {
  /** This drawer's words. */
  copy: ItemEditorCopy;
  projectId: string;
  open: boolean;
  /** The item being edited, or null to create one. */
  item: Item | null;
  onOpenChange: (open: boolean) => void;
  /** The server's answer, which is the authority on what the item now is. */
  onSaved: (item: Item) => void;
}

export function ItemEditor({
  projectId,
  copy,
  open,
  item,
  onOpenChange,
  onSaved,
}: ItemEditorProps) {
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_ITEM);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  /** Whether a save has been attempted. See `visible` below. */
  const [attempted, setAttempted] = useState(false);

  const digitalHintId = useId();

  useEffect(() => {
    if (!open) return;
    /*
     * Seeded each time the drawer opens, and only then. Re-seeding while it is
     * open would discard what is being typed the moment anything else on the
     * page reloaded the item list.
     */
    setDraft(item === null ? EMPTY_ITEM : itemDraftFrom(item));
    setFailure(null);
    setAttempted(false);
  }, [open, item]);

  const errors = validateItem(draft);
  const serverErrors = fieldErrorsFrom(failure, isItemField);

  /*
   * A blank form is not a form full of mistakes. The client's own messages
   * appear once a save has been attempted; the server's appear as soon as they
   * arrive, because by then something has certainly been pressed.
   */
  const visible: ItemErrors = { ...(attempted ? errors : {}), ...serverErrors };
  const invalid = Object.keys(errors).length > 0;

  async function save(): Promise<void> {
    setAttempted(true);
    if (invalid) return;

    setSaving(true);
    setFailure(null);
    try {
      if (item === null) {
        onSaved(await createItem(projectId, newItemFrom(draft)));
      } else {
        const patch = itemPatchFrom(draft, item);
        /*
         * Nothing changed, so nothing is sent. A request writing the same
         * values back would still move `updated_at`, and would still be refused
         * by a field lock #36 has yet to add — both for no reason at all.
         */
        if (!isEmptyPatch(patch)) onSaved(await patchItem(item.id, patch));
      }
      onOpenChange(false);
    } catch (cause) {
      setFailure(describeFailure(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <EditorDrawer
      copy={copy.drawer}
      open={open}
      onOpenChange={onOpenChange}
      title={item === null ? copy.addTitle : copy.editTitle}
      description={copy.drawerDescription}
      saving={saving}
      onSave={() => void save()}
    >
      <div className="flex flex-col gap-6">
        {failure !== null && (
          <InlineAlert variant="danger" title={copy.notSavedTitle}>
            <p>{failure.message}</p>
            <p className="mt-2 text-white/64">
              Nothing you typed has been lost — it is still in the fields below.
            </p>
          </InlineAlert>
        )}

        <Field
          label={copy.name}
          required
          hint={fillPlaceholders(copy.nameHint, { max: String(ITEM_NAME_MAX_CHARACTERS) })}
          error={visible.name}
        >
          {/*
            No `maxLength`, for the reason the basics tab gives: a hard cap
            truncates a pasted name without saying so, and takes away the
            counter's only actionable message.
          */}
          <TextInput
            value={draft.name}
            autoComplete="off"
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <CharacterCount
            count={characterCount(draft.name)}
            limit={ITEM_NAME_MAX_CHARACTERS}
            copy={copy.characterCount}
            locale={copy.locale}
          />
        </Field>

        <Field
          label={copy.description}
          hint={copy.descriptionHint}
          error={visible.description}
        >
          <Textarea
            rows={3}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </Field>

        <Field
          label={copy.imageUrl}
          hint={copy.imageUrlHint}
          error={visible.imageUrl}
        >
          {/*
            The same interim arrangement the cover image is in. There is no
            media pipeline (docs/architecture.md §13), the column holds an
            address the client declared, and saying so plainly is better than a
            drop zone that cannot accept anything.
          */}
          <TextInput
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder={copy.imageUrlPlaceholder}
            value={draft.imageUrl}
            onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })}
          />
        </Field>

        <div className="rounded-lg border border-white/8 bg-surface-2 p-5">
          {/*
            A switch rather than a checkbox: it takes effect on the item now
            rather than being collected for later, and `role="switch"` is what
            makes a screen reader say "on" instead of "checked"
            (docs/ui-kit.md §7.13).
          */}
          <Switch
            checked={draft.isDigital}
            label={copy.isDigital}
            aria-describedby={digitalHintId}
            onCheckedChange={(checked) =>
              setDraft({
                ...draft,
                isDigital: checked,
                /*
                 * A digital item has no shipping weight, and the database
                 * refuses one outright. Clearing it here means the creator is
                 * not made to undo a field whose relevance they cannot see.
                 */
                weightGrams: checked ? '' : draft.weightGrams,
              })
            }
          />
          <p id={digitalHintId} className="mt-2 text-[13px] text-white/64">
            {copy.isDigitalHint}
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            label={copy.weight}
            hint={
              draft.isDigital
                ? copy.weightHintDigital
                : 'Optional, and what shipping is worked out from later.'
            }
            error={visible.weightGrams}
          >
            <TextInput
              inputMode="numeric"
              autoComplete="off"
              value={draft.weightGrams}
              disabled={draft.isDigital}
              onChange={(event) => setDraft({ ...draft, weightGrams: event.target.value })}
            />
          </Field>

          <Field
            label={copy.sku}
            hint={copy.skuHint}
            error={visible.sku}
          >
            <TextInput
              autoComplete="off"
              value={draft.sku}
              onChange={(event) => setDraft({ ...draft, sku: event.target.value })}
            />
          </Field>
        </div>
      </div>
    </EditorDrawer>
  );
}
