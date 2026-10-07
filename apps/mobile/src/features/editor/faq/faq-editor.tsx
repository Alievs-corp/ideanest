import { useState } from 'react';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import type { SaveFailure } from '@ideanest/campaign-editor/autosave';
import { characterCount } from '@ideanest/campaign-editor/basics';
import type { ProjectFaq } from '@ideanest/campaign-editor/contract';
import type { FaqEntryCopy } from '@ideanest/campaign-editor/copy';
import {
  EMPTY_FAQ,
  FAQ_ANSWER_MAX_CHARACTERS,
  FAQ_QUESTION_MAX_CHARACTERS,
  faqDraftFrom,
  faqPatchFrom,
  isEmptyFaqPatch,
  isFaqField,
  newFaqFrom,
  validateFaq,
  type FaqDraft,
  type FaqErrors,
} from '@ideanest/campaign-editor/faqs';
import { fieldErrorsFrom } from '@ideanest/campaign-editor/rewards';
import { Caption, CharacterCount, Field, InlineAlert, TextInput, Textarea } from '../../../components/ui';
import { EditorModal } from '../editor-modal';
import { useDescribeFailure } from '../use-describe-failure';
import { createFaq, patchFaq } from './api';

/**
 * The web's `FaqEntryEditor`, as a full-screen `EditorModal` (#162): one question and its answer.
 *
 * <p>Saved when the creator presses Save — a debounced `POST` would publish "Do" and then five
 * more questions as the sentence was finished, on a list that is public the moment the campaign
 * is. An edit sends only what changed, and nothing at all when nothing did. `validateFaq` (in the
 * catalogue's words) shows after the first Save; the service's refusals land on their fields
 * through `fieldErrorsFrom`. The modal cannot be dismissed while saving.
 *
 * <p>The answer is a growing multiline field: blank lines become paragraphs on the campaign page,
 * and nothing else is formatting, which its hint says.
 *
 * <p>Mount it with a fresh `key` each time it opens, so the form is seeded once.
 */
export interface FaqEditorProps {
  readonly visible: boolean;
  readonly projectId: string;
  readonly faq: ProjectFaq | null;
  readonly copy: FaqEntryCopy;
  readonly readOnly: boolean;
  readonly onClose: () => void;
  readonly onSaved: (faq: ProjectFaq) => void;
}

export function FaqEditor({ visible, projectId, faq, copy, readOnly, onClose, onSaved }: FaqEditorProps) {
  const describe = useDescribeFailure();
  const [seed] = useState<FaqDraft>(() => (faq === null ? EMPTY_FAQ : faqDraftFrom(faq)));
  const [draft, setDraft] = useState<FaqDraft>(seed);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [attempted, setAttempted] = useState(false);

  const errors = validateFaq(draft, copy.validation);
  const visibleErrors: FaqErrors = { ...(attempted ? errors : {}), ...fieldErrorsFrom(failure, isFaqField) };
  const invalid = Object.keys(errors).length > 0;
  const dirty = draft.question !== seed.question || draft.answer !== seed.answer;

  async function save(): Promise<void> {
    setAttempted(true);
    if (invalid || readOnly) return;
    setSaving(true);
    setFailure(null);
    try {
      if (faq === null) {
        onSaved(await createFaq(projectId, newFaqFrom(draft)));
      } else {
        const patch = faqPatchFrom(draft, faq);
        if (!isEmptyFaqPatch(patch)) onSaved(await patchFaq(faq.id, patch));
      }
      setSaving(false);
      onClose();
    } catch (cause) {
      setFailure(describe(cause));
      setSaving(false);
    }
  }

  return (
    <EditorModal
      visible={visible}
      title={faq === null ? copy.addTitle : copy.editTitle}
      description={copy.description}
      dirty={dirty}
      saving={saving}
      saveDisabled={readOnly}
      onSave={() => void save()}
      onClose={onClose}
      testID="faq-editor"
    >
      {failure === null ? null : (
        <InlineAlert
          variant="danger"
          title={copy.notSavedTitle}
          description={failure.message}
          testID="faq-editor-failure"
          action={<Caption>{copy.notSavedDetail}</Caption>}
        />
      )}

      <Field
        label={copy.question}
        required
        hint={fillPlaceholders(copy.questionHint, { max: String(FAQ_QUESTION_MAX_CHARACTERS) })}
        error={visibleErrors.question}
      >
        <TextInput
          value={draft.question}
          autoComplete="off"
          onChangeText={(question) => setDraft({ ...draft, question })}
          testID="faq-question"
        />
        <CharacterCount count={characterCount(draft.question)} limit={FAQ_QUESTION_MAX_CHARACTERS} />
      </Field>

      <Field
        label={copy.answer}
        required
        hint={fillPlaceholders(copy.answerHint, { max: String(FAQ_ANSWER_MAX_CHARACTERS) })}
        error={visibleErrors.answer}
      >
        <Textarea
          value={draft.answer}
          numberOfLines={8}
          onChangeText={(answer) => setDraft({ ...draft, answer })}
          testID="faq-answer"
        />
        <CharacterCount count={characterCount(draft.answer)} limit={FAQ_ANSWER_MAX_CHARACTERS} />
      </Field>
    </EditorModal>
  );
}
