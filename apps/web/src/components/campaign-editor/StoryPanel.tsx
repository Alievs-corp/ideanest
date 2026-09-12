'use client';

import { useEffect, useMemo, useState } from 'react';
import { History } from 'lucide-react';
import {
  CharacterCount,
  Field,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
  Textarea,
} from '@ideanest/ui';
import { patchProject, type ProjectEdit, type ProjectPatch } from '../../lib/projects/api';
import {
  RISKS_MIN_CHARACTERS,
  STORY_MIN_CHARACTERS,
  characterCount,
  emptyStory,
  headingAnchors,
  readStoryDocument,
  storyCharacterCount,
  storyProblems,
  type StoryDocument,
} from '../../lib/projects/story';
import type {
  EditorChromeCopy,
  StoryPanelCopy,
} from '../../lib/i18n/campaign-editor-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { INTL_LOCALE } from '../../lib/i18n/formats';
import { EditorShell } from './EditorShell';
import { SaveStatus } from './SaveStatus';
import { StoryBlockEditor } from './StoryBlockEditor';
import { StoryVersionHistory } from './StoryVersionHistory';
import { useAutosave, type SaveFailure } from './useAutosave';
import { useProjectEdit } from './useProjectEdit';

/**
 * The story tab: the document, the mandatory risks section, the anchor navigation
 * the headings generate, and the version history.
 *
 * There is no save button. The document and the risks each autosave through
 * `PATCH /v1/projects/{id}` on a debounce (`useAutosave`), and the indicator in the
 * header is the only thing that reports on it.
 *
 * <h3>THE DOCUMENT IS ONLY SENT WHEN IT IS VALID</h3>
 *
 * A document with an image whose description has not been written yet is a document
 * the server refuses (`STORY_DOCUMENT_INVALID`), so sending it would put the editor
 * into a permanent failure state while the creator finishes typing — and, worse,
 * would stop every later save from going out, because autosave keeps one request in
 * flight and retries the same body. So an invalid document is held: the block says
 * what is wrong, the header says the story is not saved, and the moment it becomes
 * valid the whole document goes.
 *
 * That is the same rule the basics tab applies to a field it cannot parse. It is
 * safe because nothing is discarded — the draft is in the component and the last
 * document the server accepted is still on the server.
 *
 * <h3>WHAT IS DELIBERATELY NOT HERE</h3>
 *
 * <strong>The FAQ editor.</strong> §4.6 lists it in this tab. It needs a `faqs`
 * table with a question, an answer, and an order, and no migration in this epic
 * creates one — the epic contract §2 assigns V8 to story versions and nothing to
 * FAQs. Building it against `projects.story` would mean smuggling a second document
 * into a column whose schema #37 and the public page both read, so it is left out
 * rather than invented.
 *
 * <strong>Uploading.</strong> There is no media table and no uploader (contract §3).
 * An image block takes a published address and the dimensions read from it in the
 * browser, and the interface says so.
 *
 * MOTION: none, beyond the save indicator and the overlays' own entry
 * (docs/motion-system.md §5). Creators spend hours in here.
 */

const LOADING_ROWS = [0, 1, 2];

/** Maps the server's `errors` map onto this tab's two fields. */
function serverErrors(failure: SaveFailure | null): { story?: string; risks?: string } {
  if (failure === null) return {};

  const mapped: { story?: string; risks?: string } = {};
  for (const [key, message] of Object.entries(failure.fieldErrors)) {
    if (key === 'story') mapped.story = message;
    if (key === 'risks') mapped.risks = message;
  }
  // `STORY_DOCUMENT_INVALID` also carries `meta.path` — `blocks[7].alt`. The index is
  // pulled out so the message lands on the block it is about rather than in the
  // banner alone; a story is hundreds of blocks long and "the story is invalid" is
  // not something a creator can act on.
  return mapped;
}

/** The block index a `STORY_DOCUMENT_INVALID` path points at, when it points at one. */
function blockIndexFrom(failure: SaveFailure | null): number | null {
  if (failure?.code !== 'STORY_DOCUMENT_INVALID') return null;

  const path = failure.meta?.path;
  if (typeof path !== 'string') return null;

  const match = /^blocks\[(\d+)\]/.exec(path);
  if (match === null) return null;

  const index = Number(match[1]);
  return Number.isInteger(index) ? index : null;
}

export interface StoryPanelProps {
  projectId: string;
  /** The editor frame's words, resolved by this tab's page. */
  copy: EditorChromeCopy;
  /** This tab's own words, and those of the editor and the history drawer. */
  story: StoryPanelCopy;
}

export function StoryPanel({ projectId, copy, story }: StoryPanelProps) {
  const { project, status, error, reload, apply } = useProjectEdit(projectId);

  /**
   * The document being edited, seeded once from the project.
   *
   * Once, and never again from a later response — the same reasoning as
   * `BasicsPanel`: the answer to a save arrives while the creator is already typing
   * the next sentence, and re-seeding from it would delete those keystrokes. A
   * restore is the one exception, and it re-seeds explicitly.
   */
  const [document, setDocument] = useState<StoryDocument | null>(null);
  const [risks, setRisks] = useState('');
  const [unreadable, setUnreadable] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const autosave = useAutosave<ProjectPatch, ProjectEdit>({
    send: (patch) => patchProject(projectId, patch),
    onSaved: apply,
  });

  useEffect(() => {
    if (project === null || document !== null || unreadable) return;

    if (project.story == null) {
      setDocument(emptyStory());
      setRisks(project.risks ?? '');
      return;
    }

    const read = readStoryDocument(project.story);
    if (read === null) {
      // Written by a newer editor than this build. Editing it would send back a
      // document with blocks this build does not understand silently dropped, which
      // is destroying writing in a request that looks like an ordinary save.
      setUnreadable(true);
      return;
    }
    setDocument(read);
    setRisks(project.risks ?? '');
  }, [project, document, unreadable]);

  const problems = useMemo(
    () => (document === null ? new Map<number, string>() : storyProblems(document, story.vocabulary)),
    [document],
  );

  const failure = autosave.failure;
  const fieldErrors = serverErrors(failure);
  const rejectedBlock = blockIndexFrom(failure);

  /**
   * The server's per-block message, merged over the client's.
   *
   * The client's copy of the rules is for speed; the server's is the authority, and
   * where it has named a block that block's message is the server's own words.
   */
  const blockProblems = useMemo(() => {
    const merged = new Map(problems);
    if (rejectedBlock !== null && fieldErrors.story !== undefined) {
      merged.set(rejectedBlock, fieldErrors.story);
    }
    return merged;
  }, [problems, rejectedBlock, fieldErrors.story]);

  function changeDocument(next: StoryDocument): void {
    setDocument(next);

    if (storyProblems(next, story.vocabulary).size > 0) {
      /*
       * Held rather than sent. See the note on the component: an invalid document is
       * refused, and autosave retries the same body — so one unfinished image
       * description would stop every later save. Nothing is lost; the draft is here
       * and the server still holds the last document it accepted.
       */
      return;
    }
    autosave.save({ story: next });
  }

  function changeRisks(next: string): void {
    setRisks(next);
    // Empty means "cleared", which is a legitimate edit — the server treats a blank
    // string as null. §5.3's two-hundred-character minimum is a SUBMISSION
    // requirement checked by #37, not a reason to refuse a save.
    autosave.save({ risks: next.trim() === '' ? null : next });
  }

  if (status === 'signed-out') {
    return (
      <EditorShell projectId={projectId} copy={copy} active="story">
        <InlineAlert variant="info" title={copy.signedOutTitle}>
          {copy.signedOutDetail}
        </InlineAlert>
      </EditorShell>
    );
  }

  if (unreadable && project !== null) {
    return (
      <EditorShell
        projectId={projectId}
        copy={copy}
        active="story"
        title={project.title}
        state={project.state}
      >
        <InlineAlert variant="warning" title={story.readOnlyTitle}>
          It was written in a newer format than this editor understands. Reload the page to get the
          current editor. Nothing has been changed, and the story is still on your project page.
        </InlineAlert>
        <Pill variant="ghost" size="sm" className="mt-4" onClick={reload}>
          {story.reload}
        </Pill>
      </EditorShell>
    );
  }

  if (status === 'failed' || document === null || project === null) {
    return (
      <EditorShell projectId={projectId} copy={copy} active="story">
        {status === 'failed' ? (
          <>
            <InlineAlert variant="danger" title={copy.loadFailedTitle}>
              {error}
            </InlineAlert>
            <Pill variant="ghost" size="sm" className="mt-4" onClick={reload}>
              {copy.tryAgain}
            </Pill>
          </>
        ) : (
          <SkeletonGroup label={story.loadingLabel}>
            <div className="flex flex-col gap-6">
              {LOADING_ROWS.map((row) => (
                <div key={row} className="flex flex-col gap-2">
                  <Skeleton height="0.875rem" width="30%" />
                  <Skeleton height="6rem" />
                </div>
              ))}
            </div>
          </SkeletonGroup>
        )}
      </EditorShell>
    );
  }

  const storyCharacters = storyCharacterCount(document);
  const riskCharacters = characterCount(risks);
  const anchors = headingAnchors(document);

  return (
    <EditorShell
      projectId={projectId}
      copy={copy}
      active="story"
      title={project.title}
      state={project.state}
      status={<SaveStatus state={autosave.state} copy={copy.save} />}
    >
      <div className="flex flex-col gap-8">
        {failure !== null && (
          <InlineAlert variant="danger" title={story.notSavedTitle}>
            <p>{failure.message}</p>
            <p className="mt-2 text-white/64">
              Nothing you have written has been lost — it is still on this page and will be sent
              again.
            </p>
            <Pill variant="ghost" size="sm" className="mt-3" onClick={autosave.retry}>
              {copy.tryAgain}
            </Pill>
          </InlineAlert>
        )}

        {blockProblems.size > 0 && (
          /*
            Said once, at the top, as well as beside each block. A creator who has
            scrolled past the problem needs to know why the header says the story is
            not saved, and the header has no room to explain.
          */
          <InlineAlert variant="warning" title={story.notSavingTitle}>
            {blockProblems.size === 1
              ? story.notSavingDetail
              : `${blockProblems.size} blocks are incomplete. The messages beside them say what is missing, and saving resumes as soon as they are filled in.`}
          </InlineAlert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[13px] text-white/64">
              {fillPlaceholders(story.charactersNeeded, {
                /* The reader's own digit grouping, not English's. */
                count: storyCharacters.toLocaleString(INTL_LOCALE[story.locale]),
                min: STORY_MIN_CHARACTERS.toLocaleString(INTL_LOCALE[story.locale]),
              })}
            </p>
            {/*
              A sentence rather than a bar, and announced when it starts to matter.
              `CharacterCount` is written for a limit rather than a minimum, so the
              count is expressed as the remainder towards the minimum: "48 characters
              remaining" is exactly right on the way up, and once the minimum is
              passed the wording changes rather than the colour (docs/ui-kit.md
              §7.13).
            */}
            <CharacterCount
              count={Math.min(storyCharacters, STORY_MIN_CHARACTERS)}
              limit={STORY_MIN_CHARACTERS}
              announceWithin={STORY_MIN_CHARACTERS}
              copy={story.characterCount}
              locale={story.locale}
            />
          </div>

          <Pill
            variant="ghost"
            size="sm"
            iconLeft={<History aria-hidden="true" className="size-4" />}
            aria-haspopup="dialog"
            onClick={() => setHistoryOpen(true)}
          >
            {story.earlierVersions}
          </Pill>
        </div>

        {anchors.length > 0 && (
          /*
            The anchor navigation of §4.6, generated from the headings.
            IN THE EDITOR IT IS A PREVIEW, NOT A JUMP LIST: the fragments are the ones
            the public page will use, and there is nothing on this page with those
            ids to jump to. Links that resolved to nothing would be worse than none,
            so this is a list of what the menu will contain — which is the thing a
            creator is actually checking when they look at it.
          */
          <section
            aria-labelledby="story-anchors-heading"
            className="rounded-lg border border-white/8 bg-surface-2 p-4"
          >
            <h2
              id="story-anchors-heading"
              className="text-[13px] font-medium tracking-[0.06em] text-white/40 uppercase"
            >
              {story.anchorMenu}
            </h2>
            <ol className="mt-3 flex flex-col gap-1.5">
              {anchors.map((anchor) => (
                <li
                  key={anchor.id}
                  className={anchor.level === 3 ? 'pl-4 text-[13px]' : 'text-[15px]'}
                >
                  <span className="text-white">{anchor.text || 'Untitled section'}</span>
                  <span className="ml-2 text-[13px] text-white/40">#{anchor.id}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <StoryBlockEditor
          copy={story.blocks}
          vocabulary={story.vocabulary}
          toolbar={story.toolbar}
          document={document}
          serverProblems={blockProblems}
          onChange={changeDocument}
          onFlush={autosave.flush}
        />

        <Field
          label={story.risks}
          required
          hint={fillPlaceholders(story.risksHint, { min: String(RISKS_MIN_CHARACTERS) })}
          error={fieldErrors.risks}
        >
          {/*
            No `maxLength` and no minimum enforced here. §5.3 makes this a SUBMISSION
            requirement, and a field that refused to save a half-written answer would
            be a field that loses the first half. #37's checklist reports it as
            progress; this reports how far along it is.
          */}
          <Textarea
            rows={6}
            value={risks}
            placeholder={story.risksPlaceholder}
            onChange={(event) => changeRisks(event.target.value)}
            onBlur={autosave.flush}
          />
          <CharacterCount
            copy={story.characterCount}
            locale={story.locale}
            count={Math.min(riskCharacters, RISKS_MIN_CHARACTERS)}
            limit={RISKS_MIN_CHARACTERS}
            announceWithin={RISKS_MIN_CHARACTERS}
          />
        </Field>
      </div>

      <StoryVersionHistory
        copy={story.history}
        vocabulary={story.vocabulary}
        projectId={projectId}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        currentCharacters={storyCharacters}
        onRestored={(restored) => {
          apply(restored);
          /*
            The one place the draft is re-seeded from a response. A restore replaces
            the story on purpose, so keeping the draft would leave the creator looking
            at the document they asked to discard while the server holds the one they
            asked for.
          */
          const read = restored.story == null ? emptyStory() : readStoryDocument(restored.story);
          if (read === null) {
            setUnreadable(true);
            return;
          }
          setDocument(read);
        }}
      />
    </EditorShell>
  );
}
