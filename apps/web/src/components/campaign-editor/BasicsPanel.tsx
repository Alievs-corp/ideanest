'use client';

import { useEffect, useId, useState } from 'react';
import {
  CharacterCount,
  Field,
  InlineAlert,
  Pill,
  Select,
  Skeleton,
  SkeletonGroup,
  Switch,
  Textarea,
  TextInput,
} from '@ideanest/ui';
import { SUPPORTED_CURRENCIES } from '../../lib/money';
import {
  isLocked,
  listCategories,
  patchProject,
  type Category,
  type CoverImage,
  type ProjectEdit,
  type ProjectPatch,
} from '../../lib/projects/api';
import {
  BLURB_MAX_CHARACTERS,
  DURATION_MAX_DAYS,
  DURATION_MIN_DAYS,
  DURATION_RECOMMENDED_DAYS,
  TITLE_MAX_CHARACTERS,
  characterCount,
  draftFromProject,
  isBasicsField,
  patchForField,
  validateBasics,
  type BasicsDraft,
  type BasicsErrors,
  type BasicsField,
} from '../../lib/projects/basics';
import { CoverImageField } from './CoverImageField';
import type { EditorChromeCopy } from '../../lib/i18n/campaign-editor-copy';
import { EditorShell } from './EditorShell';
import { SaveStatus } from './SaveStatus';
import { useAutosave, type SaveFailure } from './useAutosave';
import { useProjectEdit } from './useProjectEdit';

/**
 * The basics tab: title, summary, category, goal, duration, scheduled launch,
 * late pledges, and the cover image.
 *
 * There is no save button. Every control writes its own field through
 * `PATCH /v1/projects/{id}` on a debounce (`useAutosave`), and the indicator in
 * the header is the only thing that reports on it — which is why that indicator
 * never says "Saved" while anything is still queued.
 *
 * MOTION: none, beyond the save indicator (docs/motion-system.md §5). Creators
 * spend hours in here and a field that animates while somebody is typing into it
 * reads as hesitation.
 *
 * TWO THINGS ARE DELIBERATELY ABSENT.
 *
 * Location. `projects` has no `location_id` and there is no geocoding service;
 * docs/architecture.md §7.2 and the epic contract both hold it back for the
 * discovery epic (#42). A location field with nowhere to save to would be a
 * form that forgets what it was told, so there is not one.
 *
 * Video. §4.6 lists it beside the cover image, and it needs the same media
 * pipeline the cover is waiting for — with the additional problem that a video
 * has no equivalent of reading intrinsic dimensions from an `<img>`.
 */

const LOADING_ROWS = [0, 1, 2, 3];

/** Maps a validation failure's `errors` map onto the fields this form has. */
function serverErrors(failure: SaveFailure | null): BasicsErrors {
  if (failure === null) return {};

  const mapped: BasicsErrors = {};
  for (const [key, message] of Object.entries(failure.fieldErrors)) {
    // `goal.amount` is about the goal field. Anything unrecognised is dropped
    // rather than rendered next to a control it is not about; the whole message
    // is still shown in the failure banner.
    const [field = ''] = key.split('.');
    if (isBasicsField(field)) mapped[field] = message;
  }
  return mapped;
}

export interface BasicsPanelProps {
  projectId: string;
  /** The editor frame's words, resolved by this tab's page. */
  copy: EditorChromeCopy;
}

export function BasicsPanel({ projectId, copy }: BasicsPanelProps) {
  const { project, status, error, reload, apply } = useProjectEdit(projectId);

  /**
   * The form's state, seeded once from the project.
   *
   * Once, and never again from a later response: the answer to a save arrives
   * while the creator is already typing the next sentence, and re-seeding from
   * it would delete those keystrokes. The server's copy is kept in `project` for
   * the things it is the authority on — state, `lockedFields` — and the fields
   * belong to the draft.
   */
  const [draft, setDraft] = useState<BasicsDraft | null>(null);

  const [categories, setCategories] = useState<readonly Category[] | null>(null);
  const [categoriesUnavailable, setCategoriesUnavailable] = useState(false);

  const latePledgeHintId = useId();

  const autosave = useAutosave<ProjectPatch, ProjectEdit>({
    send: (patch) => patchProject(projectId, patch),
    onSaved: apply,
  });

  useEffect(() => {
    if (project !== null && draft === null) setDraft(draftFromProject(project));
  }, [project, draft]);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        setCategories(await listCategories(controller.signal));
      } catch {
        /*
         * The rest of the form still works without the taxonomy, and saying
         * that the list is unavailable is better than blocking the editor on a
         * read it does not need in order to save a title. The names come back
         * already resolved against the browser's `Accept-Language`, so there is
         * nothing to choose between here.
         */
        if (!controller.signal.aborted) setCategoriesUnavailable(true);
      }
    })();

    return () => controller.abort();
  }, []);

  /**
   * Applies one field and queues exactly that field.
   *
   * The patch is built from the field name, not from the whole draft, so an
   * untouched control can never overwrite what another tab wrote. When the value
   * is not valid nothing is sent at all — the field shows why, and the last
   * value the server accepted stays the value the server holds.
   */
  function change(field: BasicsField, next: BasicsDraft): void {
    setDraft(next);

    const patch = patchForField(field, next);
    if (patch !== null) autosave.save(patch);
  }

  const failure = autosave.failure;

  if (status === 'signed-out') {
    return (
      <EditorShell projectId={projectId} copy={copy} active="basics">
        <InlineAlert variant="info" title="You are signed out">
          This browser no longer has a session. Sign in again to keep editing this campaign.
        </InlineAlert>
      </EditorShell>
    );
  }

  if (status === 'failed' || draft === null || project === null) {
    return (
      <EditorShell projectId={projectId} copy={copy} active="basics">
        {status === 'failed' ? (
          <>
            <InlineAlert variant="danger" title="This project could not be loaded">
              {error}
            </InlineAlert>
            <Pill variant="ghost" size="sm" className="mt-4" onClick={reload}>
              Try again
            </Pill>
          </>
        ) : (
          <SkeletonGroup label="Loading this campaign">
            <div className="flex flex-col gap-6">
              {LOADING_ROWS.map((row) => (
                <div key={row} className="flex flex-col gap-2">
                  <Skeleton height="0.875rem" width="30%" />
                  <Skeleton height="2.75rem" />
                </div>
              ))}
            </div>
          </SkeletonGroup>
        )}
      </EditorShell>
    );
  }

  const errors: BasicsErrors = { ...validateBasics(draft), ...serverErrors(failure) };
  const selected = categories?.find((category) => category.id === draft.categoryId) ?? null;
  const subcategories = selected?.subcategories ?? [];

  const goalLocked = isLocked(project, 'goal');
  const durationLocked = isLocked(project, 'durationDays');

  return (
    <EditorShell
      projectId={projectId}
      copy={copy}
      active="basics"
      title={project.title}
      state={project.state}
      status={<SaveStatus state={autosave.state} copy={copy.save} />}
    >
      {/*
        There is no submit. The element is a `form` so that Enter inside a field
        does not do something surprising, and so the whole group is announced as
        one region rather than as a run of unrelated controls.
      */}
      <form className="flex flex-col gap-7" onSubmit={(event) => event.preventDefault()}>
        {failure !== null && (
          <InlineAlert variant="danger" title="This change was not saved">
            <p>{failure.message}</p>
            <p className="mt-2 text-white/64">
              Nothing you typed has been lost — it is still in the fields below and will be sent
              again.
            </p>
            <Pill variant="ghost" size="sm" className="mt-3" onClick={autosave.retry}>
              Try again
            </Pill>
          </InlineAlert>
        )}

        <Field
          label="Title"
          required
          hint={`The name on the discovery grid. ${TITLE_MAX_CHARACTERS} characters or fewer.`}
          error={errors.title}
        >
          {/*
            No `maxLength`. A hard cap truncates a pasted title without saying
            so, and it takes the counter's only useful message away: "3
            characters too many" is actionable, silently losing three letters is
            not.
          */}
          <TextInput
            value={draft.title}
            autoComplete="off"
            onChange={(event) => change('title', { ...draft, title: event.target.value })}
            onBlur={autosave.flush}
          />
          <CharacterCount count={characterCount(draft.title)} limit={TITLE_MAX_CHARACTERS} />
        </Field>

        <Field
          label="Summary"
          hint={`One or two sentences, shown under the title in search and on the grid. ${BLURB_MAX_CHARACTERS} characters or fewer.`}
          error={errors.blurb}
        >
          <Textarea
            rows={3}
            value={draft.blurb}
            onChange={(event) => change('blurb', { ...draft, blurb: event.target.value })}
            onBlur={autosave.flush}
          />
          <CharacterCount count={characterCount(draft.blurb)} limit={BLURB_MAX_CHARACTERS} />
        </Field>

        {categoriesUnavailable && (
          <InlineAlert variant="warning" title="The category list is unavailable">
            Categories could not be loaded, so this campaign&rsquo;s category cannot be changed
            here yet. Everything else on this page still saves.
          </InlineAlert>
        )}

        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            label="Category"
            hint="Where backers will find this project."
            error={errors.categoryId}
          >
            <Select
              value={draft.categoryId}
              placeholder="Choose a category"
              disabled={categories === null}
              onChange={(event) =>
                change('categoryId', {
                  ...draft,
                  categoryId: event.target.value,
                  // A subcategory of a category nobody chose is orphaned data.
                  subcategoryId: '',
                })
              }
            >
              {(categories ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Subcategory"
            hint={
              selected === null
                ? 'Choose a category first.'
                : subcategories.length === 0
                  ? 'This category has no subcategories.'
                  : 'Optional, and more specific.'
            }
            error={errors.subcategoryId}
          >
            <Select
              value={draft.subcategoryId}
              placeholder="No subcategory"
              disabled={subcategories.length === 0}
              onChange={(event) =>
                change('subcategoryId', { ...draft, subcategoryId: event.target.value })
              }
            >
              {subcategories.map((subcategory) => (
                <option key={subcategory.id} value={subcategory.id}>
                  {subcategory.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-6 sm:grid-cols-[2fr_1fr]">
          <Field
            label="Funding goal"
            required
            hint={
              goalLocked
                ? 'The goal cannot change once the campaign has launched.'
                : 'All or nothing: nothing is collected unless this figure is reached.'
            }
            error={errors.goal}
          >
            {/*
              `inputMode="decimal"` rather than `type="number"`. A number input
              accepts `1e5`, hides what it cannot parse, and on several browsers
              silently loses the value on a scroll wheel — none of which is
              acceptable for the figure the whole campaign is measured against.
              The value stays text here and becomes a `Decimal` on the way out.
            */}
            <TextInput
              inputMode="decimal"
              autoComplete="off"
              value={draft.goalAmount}
              disabled={goalLocked}
              onChange={(event) => change('goal', { ...draft, goalAmount: event.target.value })}
              onBlur={autosave.flush}
            />
          </Field>

          <Field label="Currency" hint="Fixed once the campaign launches.">
            <Select
              value={draft.currency}
              disabled={goalLocked}
              onChange={(event) => change('goal', { ...draft, currency: event.target.value })}
            >
              {SUPPORTED_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            label="Duration in days"
            required
            hint={
              durationLocked
                ? 'The deadline cannot change once the campaign has launched.'
                : `${DURATION_MIN_DAYS} to ${DURATION_MAX_DAYS} days. ${DURATION_RECOMMENDED_DAYS} is recommended.`
            }
            error={errors.durationDays}
          >
            <TextInput
              inputMode="numeric"
              autoComplete="off"
              value={draft.durationDays}
              disabled={durationLocked}
              onChange={(event) =>
                change('durationDays', { ...draft, durationDays: event.target.value })
              }
              onBlur={autosave.flush}
            />
          </Field>

          <Field
            label="Scheduled launch"
            hint="Optional. Leave it empty to launch by hand once the review is complete."
            error={errors.scheduledLaunchAt}
          >
            <TextInput
              type="datetime-local"
              value={draft.scheduledLaunchAt}
              onChange={(event) =>
                change('scheduledLaunchAt', { ...draft, scheduledLaunchAt: event.target.value })
              }
              onBlur={autosave.flush}
            />
          </Field>
        </div>

        <div className="rounded-lg border border-white/8 bg-surface-2 p-5">
          {/*
            A switch, not a checkbox: this takes effect on the campaign rather
            than being collected for later, and `role="switch"` is what makes a
            screen reader say "on" instead of "checked" (docs/ui-kit.md §7.13).
          */}
          <Switch
            checked={draft.latePledgeEnabled}
            label="Accept late pledges"
            aria-describedby={latePledgeHintId}
            onCheckedChange={(checked) =>
              change('latePledgeEnabled', { ...draft, latePledgeEnabled: checked })
            }
          />
          <p id={latePledgeHintId} className="mt-2 text-[13px] text-white/64">
            Keeps the project open to pledges after the deadline, once it has been funded. It can be
            turned off again at any time.
          </p>
        </div>

        <CoverImageField
          url={draft.coverImageUrl}
          cover={draft.coverImage}
          error={errors.coverImage}
          onUrlChange={(url) => setDraft({ ...draft, coverImageUrl: url })}
          onAccept={(cover: CoverImage) =>
            change('coverImage', { ...draft, coverImage: cover, coverImageUrl: cover.url })
          }
          onRemove={() => change('coverImage', { ...draft, coverImage: null, coverImageUrl: '' })}
        />
      </form>
    </EditorShell>
  );
}
