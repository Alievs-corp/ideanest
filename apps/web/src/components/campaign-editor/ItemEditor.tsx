'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import {
  CharacterCount,
  Field,
  FileDropZone,
  InlineAlert,
  Media,
  Pill,
  Switch,
  Textarea,
  TextInput,
} from '@ideanest/ui';
import { createItem, patchItem, type Item } from '../../lib/projects/api';
import { characterCount } from '@ideanest/campaign-editor/basics';
import {
  EMPTY_ITEM,
  ITEM_NAME_MAX_CHARACTERS,
  fieldErrorsFrom,
  heldItemFields,
  isEmptyPatch,
  isItemField,
  itemDraftFrom,
  itemPatchFrom,
  newItemFrom,
  validateItem,
  type ItemDraft,
  type ItemErrors,
  type ItemField,
} from '@ideanest/campaign-editor/rewards';
import { EditorDrawer } from './EditorDrawer';
import type { SaveFailure } from '@ideanest/campaign-editor/autosave';
import { describeFailure } from './useAutosave';
import { useImageUpload } from '../../lib/media/useImageUpload';

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
 *
 * <h3>WHAT WAITS FOR A MODERATOR</h3>
 *
 * On a launched campaign, an item an approved tier contains keeps its public
 * name, description, picture, weight and kind until a moderator approves the
 * new ones (#587); its SKU is written at once. The service answers with the
 * proposed values and names the held fields, so the form is seeded with what
 * the creator asked for and each held field says, in its description, that
 * backers still see the approved value. Said once at the top and again at the
 * field, because a creator who opens the drawer to fix one field reads that
 * field and not the banner.
 */
import type {
  ItemEditorCopy,
  ItemValidationCopy,
} from '@ideanest/campaign-editor/copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

export interface ItemEditorProps {
  /** This drawer's words. */
  copy: ItemEditorCopy;
  /** The vocabulary `validateItem` refuses in. */
  validation: ItemValidationCopy;
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
  validation,
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
  /*
   * The image upload — the cover's, through `lib/media/useImageUpload.ts` (#313).
   * Its result is an address, which is all `items.image_url` holds, so it lands in
   * the draft like a typed one and is kept when the drawer is saved.
   */
  const { stage, upload: send } = useImageUpload(copy.upload);
  const [imageNote, setImageNote] = useState<{
    tone: 'success' | 'danger';
    title?: string;
    text: string;
  } | null>(null);

  const digitalHintId = useId();

  /* The fields a moderator still has to approve, as the service last answered for this item. */
  const held = item === null ? [] : heldItemFields(item);

  /*
   * A field's hint with the held marker under it. In the hint rather than the
   * label, so it reaches a screen reader as the control's description and the
   * field keeps its plain name.
   */
  function hintFor(field: ItemField, hint: string): ReactNode {
    if (!held.includes(field)) return hint;
    return (
      <>
        {hint}
        <HeldMark text={copy.held.field} />
      </>
    );
  }

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
    setImageNote(null);
  }, [open, item]);

  const errors = validateItem(draft, validation);
  const serverErrors = fieldErrorsFrom(failure, isItemField);

  /*
   * A blank form is not a form full of mistakes. The client's own messages
   * appear once a save has been attempted; the server's appear as soon as they
   * arrive, because by then something has certainly been pressed.
   */
  const visible: ItemErrors = { ...(attempted ? errors : {}), ...serverErrors };
  const invalid = Object.keys(errors).length > 0;

  async function uploadImage(file: File): Promise<void> {
    setImageNote(null);
    const result = await send(file);
    // Abandoned for a newer file, which is the one this field now reports on.
    if (result === null) return;
    if ('refusal' in result) {
      setImageNote({ tone: 'danger', title: copy.upload.notUsedTitle, text: result.refusal });
      return;
    }
    const { image } = result;

    // Into the draft as it is NOW: a name typed while the file uploaded is kept.
    setDraft((current) => ({ ...current, imageUrl: image.url }));
    setImageNote({ tone: 'success', text: copy.imageUploaded });
  }

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
      setFailure(describeFailure(cause, copy.failures));
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
      // Saving mid-upload would store the item without the image being waited for.
      waiting={stage !== null}
      onSave={() => void save()}
    >
      <div className="flex flex-col gap-6">
        {held.length > 0 && (
          <InlineAlert variant="info" title={copy.held.title}>
            {copy.held.body}
          </InlineAlert>
        )}

        {failure !== null && (
          <InlineAlert variant="danger" title={copy.notSavedTitle}>
            <p>{failure.message}</p>
            <p className="mt-2 text-fg-64">{copy.notSavedDetail}</p>
          </InlineAlert>
        )}

        <Field
          label={copy.name}
          required
          hint={hintFor('name', fillPlaceholders(copy.nameHint, { max: String(ITEM_NAME_MAX_CHARACTERS) }))}
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
          hint={hintFor('description', copy.descriptionHint)}
          error={visible.description}
        >
          <Textarea
            rows={3}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </Field>

        <Field
          grouped
          label={copy.image}
          hint={hintFor('imageUrl', copy.imageHint)}
          error={visible.imageUrl}
        >
          <div className="flex flex-col gap-3">
            {/*
              An upload, or an address: the column holds an address either way.
              The cover's pipeline reaches this field since #313, and the app
              uploads here too (#162).

              The preview is attempted only for an https address, the service's
              own rule for this column, so a half-typed one fires no request.
              NOT `next/image`, for the reason `CoverImageField` gives; decorative,
              because the item's name beside it says what it is.
            */}
            {draft.imageUrl.trim().startsWith('https://') && (
              <div className="flex items-center gap-4">
                <div className="size-20 shrink-0 overflow-hidden rounded-lg border border-fg/8 bg-surface-3">
                  <Media src={draft.imageUrl.trim()} ratio="1/1" decorative />
                </div>
                <Pill
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={stage !== null}
                  onClick={() => {
                    setImageNote(null);
                    setDraft((current) => ({ ...current, imageUrl: '' }));
                  }}
                >
                  {copy.imageRemove}
                </Pill>
              </div>
            )}

            <FileDropZone
              accept="image/*"
              disabled={saving || stage !== null}
              prompt={copy.imagePrompt}
              dragPrompt={copy.imageDragPrompt}
              buttonLabel={copy.imageButtonLabel}
              hint={copy.imageDropHint}
              onFiles={(files) => {
                const [first] = files;
                if (first) void uploadImage(first);
              }}
            />

            {/*
              Two regions, for the reason `CoverImageField` gives: an alert inside
              a polite live region is two contradictory instructions about one
              sentence.
            */}
            <div role="status" aria-live="polite" className="empty:hidden">
              {stage !== null && <InlineAlert variant="info">{copy.upload.stage[stage]}</InlineAlert>}
              {stage === null && imageNote !== null && imageNote.tone === 'success' && (
                <InlineAlert variant="success">{imageNote.text}</InlineAlert>
              )}
            </div>
            {imageNote !== null && imageNote.tone === 'danger' && (
              <InlineAlert variant="danger" title={imageNote.title}>
                {imageNote.text}
              </InlineAlert>
            )}

            <TextInput
              type="url"
              inputMode="url"
              autoComplete="off"
              /*
                The `Field` label names the group, so this box needs a name of its
                own, or it is announced as "edit text" and nothing else.
              */
              aria-label={copy.imageUrl}
              placeholder={copy.imageUrlPlaceholder}
              value={draft.imageUrl}
              disabled={stage !== null}
              onChange={(event) => {
                setImageNote(null);
                setDraft({ ...draft, imageUrl: event.target.value });
              }}
            />
          </div>
        </Field>

        <div className="rounded-lg border border-fg/8 bg-surface-2 p-5">
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
          <p id={digitalHintId} className="mt-2 text-[13px] text-fg-64">
            {copy.isDigitalHint}
            {held.includes('isDigital') && <HeldMark text={copy.held.field} />}
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            label={copy.weight}
            hint={hintFor('weightGrams', draft.isDigital ? copy.weightHintDigital : copy.weightHint)}
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

/*
 * Words and an icon, never a colour alone (docs/ui-kit.md §9.2). The pencil is
 * the one the tier and item lists wear for "changed, waiting for review".
 */
function HeldMark({ text }: { text: string }) {
  return (
    <span className="mt-1 flex items-center gap-1.5">
      <Pencil aria-hidden="true" className="size-3.5 shrink-0" />
      {text}
    </span>
  );
}
