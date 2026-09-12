'use client';

import { useEffect, useState } from 'react';
import { CharacterCount, Field, InlineAlert, Textarea, TextInput } from '@ideanest/ui';
import {
  createFaq,
  patchFaq,
  FAQ_ANSWER_MAX_CHARACTERS,
  FAQ_QUESTION_MAX_CHARACTERS,
  type ProjectFaq,
} from '../../lib/projects/api';
import { characterCount } from '../../lib/projects/basics';
import {
  EMPTY_FAQ,
  faqDraftFrom,
  faqPatchFrom,
  isEmptyFaqPatch,
  isFaqField,
  newFaqFrom,
  validateFaq,
  type FaqDraft,
  type FaqErrors,
} from '../../lib/projects/faqs';
import { EditorDrawer } from './EditorDrawer';
import { fieldErrorsFrom } from './rewardFailure';
import { describeFailure, type SaveFailure } from './useAutosave';

/**
 * One question and the creator's answer to it.
 *
 * <h3>IT SAVES WHEN THE CREATOR SAYS SO</h3>
 *
 * The basics and story tabs autosave and this deliberately does not, for the
 * half of `RewardsPanel`'s argument that applies here on its own: creating an
 * entry is a `POST`, and a `POST` cannot be debounced. A form that fired one on
 * a pause in typing would publish a question called "Do" and five more as the
 * sentence was finished, each of them a row a creator then has to delete — from
 * a list that is <em>public the moment the campaign is</em>.
 *
 * That last part is why this is not merely inconvenient. A half-typed reward
 * tier sits in a draft; a half-typed FAQ entry on a live campaign is a question
 * a backer reads.
 *
 * <h3>NOTHING IS FORKED TO DO IT</h3>
 *
 * `describeFailure` turns a refusal into a sentence exactly as it does for an
 * autosave, and the field messages land through the same `fieldErrorsFrom` the
 * two reward editors use — so a refusal reads the same wherever in the editor it
 * happened. Only the debounce is absent.
 *
 * <h3>MOTION</h3>
 *
 * The drawer's own 200ms entry, transform only, collapsed entirely under
 * `prefers-reduced-motion`. Nothing here adds any: docs/motion-system.md §5
 * gives the campaign editor "none — autosave indicator only".
 */
import type { EditorDrawerCopy } from '../../lib/i18n/campaign-editor-copy';

export interface FaqEntryEditorProps {
  projectId: string;
  /**
   * The drawer's two buttons.
   *
   * The rest of this editor is still English — the FAQ tab has not been translated yet — and
   * these are threaded now because `EditorDrawer` is shared and stopped carrying its own
   * words. A partly translated drawer is not the goal; it is what a shared component being
   * translated first looks like from the tab that follows it.
   */
  drawer: EditorDrawerCopy;
  open: boolean;
  /** The entry being edited, or null to add one. */
  faq: ProjectFaq | null;
  onOpenChange: (open: boolean) => void;
  /** The server's answer, which is the authority on what the entry now is. */
  onSaved: (faq: ProjectFaq) => void;
}

export function FaqEntryEditor({
  projectId,
  drawer,
  open,
  faq,
  onOpenChange,
  onSaved,
}: FaqEntryEditorProps) {
  const [draft, setDraft] = useState<FaqDraft>(EMPTY_FAQ);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  /** Whether a save has been attempted. See `visible` below. */
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!open) return;
    /*
     * Seeded each time the drawer opens, and only then. Re-seeding while it is
     * open would discard what is being typed the moment anything else on the
     * page reloaded the list.
     */
    setDraft(faq === null ? EMPTY_FAQ : faqDraftFrom(faq));
    setFailure(null);
    setAttempted(false);
  }, [open, faq]);

  const errors = validateFaq(draft);
  const serverErrors = fieldErrorsFrom(failure, isFaqField);

  /*
   * A blank form is not a form full of mistakes. The client's own messages
   * appear once a save has been attempted; the server's appear as soon as they
   * arrive, because by then something has certainly been pressed.
   */
  const visible: FaqErrors = { ...(attempted ? errors : {}), ...serverErrors };
  const invalid = Object.keys(errors).length > 0;

  async function save(): Promise<void> {
    setAttempted(true);
    if (invalid) return;

    setSaving(true);
    setFailure(null);
    try {
      if (faq === null) {
        onSaved(await createFaq(projectId, newFaqFrom(draft)));
      } else {
        const patch = faqPatchFrom(draft, faq);
        /*
         * Nothing changed, so nothing is sent. A request writing the same values
         * back would still move `updated_at` for no reason at all.
         */
        if (!isEmptyFaqPatch(patch)) onSaved(await patchFaq(faq.id, patch));
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
      copy={drawer}
      open={open}
      onOpenChange={onOpenChange}
      title={faq === null ? 'Add a question' : 'Edit question'}
      description="Questions and answers appear on the campaign page, in the order you put them in."
      saving={saving}
      onSave={() => void save()}
    >
      <div className="flex flex-col gap-6">
        {failure !== null && (
          <InlineAlert variant="danger" title="This question was not saved">
            <p>{failure.message}</p>
            <p className="mt-2 text-white/64">
              Nothing you typed has been lost — it is still in the fields below.
            </p>
          </InlineAlert>
        )}

        <Field
          label="Question"
          required
          hint={`As a backer would ask it. ${FAQ_QUESTION_MAX_CHARACTERS} characters or fewer.`}
          error={visible.question}
        >
          {/*
            No `maxLength`, for the reason the basics tab gives: a hard cap
            truncates a pasted question without saying so, and takes away the
            counter's only actionable message.
          */}
          <TextInput
            value={draft.question}
            autoComplete="off"
            onChange={(event) => setDraft({ ...draft, question: event.target.value })}
          />
          <CharacterCount
            count={characterCount(draft.question)}
            limit={FAQ_QUESTION_MAX_CHARACTERS}
          />
        </Field>

        <Field
          label="Answer"
          required
          hint={`Plain text. Blank lines become paragraph breaks on the campaign page; nothing else is formatting. ${FAQ_ANSWER_MAX_CHARACTERS} characters or fewer.`}
          error={visible.answer}
        >
          {/*
            The hint says what the field does with what is typed into it, because
            the public tab renders an answer as text and never as markup — a
            creator who types `<b>` sees `<b>`. Saying so here is cheaper than a
            creator discovering it on a live campaign.
          */}
          <Textarea
            rows={8}
            value={draft.answer}
            onChange={(event) => setDraft({ ...draft, answer: event.target.value })}
          />
          <CharacterCount count={characterCount(draft.answer)} limit={FAQ_ANSWER_MAX_CHARACTERS} />
        </Field>
      </div>
    </EditorDrawer>
  );
}
