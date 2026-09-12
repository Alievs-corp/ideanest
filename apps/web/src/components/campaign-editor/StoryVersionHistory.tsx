'use client';

import { useCallback, useEffect, useState } from 'react';
import { EmptyState, InlineAlert, Pill, Skeleton, SkeletonGroup } from '@ideanest/ui';
import { Drawer, Modal } from '@ideanest/ui/motion';
import { ApiError } from '../../lib/api/problem';
import {
  getStoryVersion,
  listStoryVersions,
  restoreStoryVersion,
  type ProjectEdit,
  type StoryVersionSummary,
} from '../../lib/projects/api';
import {
  readStoryDocument,
  spansToText,
  storyCharacterCount,
  type StoryDocument,
} from '../../lib/projects/story';

/**
 * Earlier drafts of the story: list, preview, restore.
 *
 * A drawer rather than a route, because the point of the history is comparison — a
 * creator reads the old version with the current one still on the page behind it.
 * A route would replace what they are comparing against.
 *
 * <h3>RESTORING ASKS FIRST, AND SAYS WHAT IT REPLACES</h3>
 *
 * It is the one destructive action in the editor: the story on screen is overwritten.
 * So it goes through a modal that names the version being restored, says how many
 * characters the current story has, and states that the current story is kept as a
 * version — which is true, and is what makes the action recoverable. A confirmation
 * that only said "are you sure?" would be a speed bump rather than information.
 *
 * <h3>THE PREVIEW IS TEXT, NOT A RENDERING</h3>
 *
 * The public project page renders a story document, and that page belongs to another
 * issue. A second renderer here would be a second reading of the same document and
 * the two would disagree about something — which is exactly the wrong thing to be
 * looking at when deciding whether to overwrite an hour's work. So the preview shows
 * the blocks in order, labelled by kind, with their text: enough to recognise the
 * draft, and honest about not being the finished page.
 *
 * MOTION: the overlay's own entry, which `Modal` and `Drawer` own and which honours
 * `prefers-reduced-motion`. Nothing here adds any.
 */
import type {
  StoryHistoryCopy,
  StoryVocabularyCopy,
} from '../../lib/i18n/campaign-editor-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralise } from '../../lib/i18n/plurals';
import { INTL_LOCALE } from '../../lib/i18n/formats';

export interface StoryVersionHistoryProps {
  /** This drawer's words. */
  copy: StoryHistoryCopy;
  /** How a block is named, for the preview. */
  vocabulary: StoryVocabularyCopy;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Characters in the story as it now stands, so the modal can name what is at risk. */
  currentCharacters: number;
  /** The server's answer to a restore, which is the authority on the whole project. */
  onRestored: (project: ProjectEdit) => void;
}

type Loading = 'loading' | 'ready' | 'failed';

/**
 * The service's own sentence where there is one, and a fallback where there is not.
 *
 * A local helper rather than an addition to `lib/api/problem`, because the two
 * existing versions of this idea — `useAutosave`'s `describeFailure` and
 * `useProjectEdit`'s `messageFor` — are both worded for their own surface, and a
 * third one worded for a version history is more honest than a shared function that
 * says "this project no longer exists" when a pruned draft was asked for.
 *
 * `detail` is preferred wherever the endpoint wrote one: it knows which of its rules
 * was broken, and `STORY_VERSION_NOT_FOUND` in particular carries the distinction
 * between "never existed" and "no longer kept" that this drawer exists to explain.
 */
function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) {
    return cause.problem?.detail ?? cause.problem?.title ?? fallback;
  }
  return 'The service could not be reached. Check your connection and try again.';
}

export function StoryVersionHistory({
  copy,
  vocabulary,
  projectId,
  open,
  onOpenChange,
  currentCharacters,
  onRestored,
}: StoryVersionHistoryProps) {
  const [versions, setVersions] = useState<readonly StoryVersionSummary[]>([]);
  const [status, setStatus] = useState<Loading>('loading');
  const [error, setError] = useState<string | null>(null);

  const [previewing, setPreviewing] = useState<number | null>(null);
  const [preview, setPreview] = useState<StoryDocument | null>(null);
  const [previewProblem, setPreviewProblem] = useState<string | null>(null);

  const [confirming, setConfirming] = useState<StoryVersionSummary | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setStatus('loading');
      try {
        setVersions(await listStoryVersions(projectId, signal));
        setError(null);
        setStatus('ready');
      } catch (cause) {
        if (signal?.aborted === true) return;
        setError(errorMessage(cause, 'The version history could not be loaded.'));
        setStatus('failed');
      }
    },
    [projectId],
  );

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    // Loaded when the drawer opens rather than with the page: a creator who never
    // opens the history should not pay for it, and one who opens it after twenty
    // minutes of writing wants what is there now rather than what was there when
    // the page loaded.
    void load(controller.signal);
    return () => controller.abort();
  }, [open, load]);

  async function showPreview(version: StoryVersionSummary): Promise<void> {
    setPreviewing(version.number);
    setPreview(null);
    setPreviewProblem(null);
    try {
      const detail = await getStoryVersion(projectId, version.number);
      const document = readStoryDocument(detail.document);
      if (document === null) {
        // A version written by a newer editor. Showing it as best we can would
        // invite a restore into a document this build cannot then save.
        setPreviewProblem(
          'This version was written in a newer format than this editor understands. Reload the page to get the current editor.',
        );
        return;
      }
      setPreview(document);
    } catch (cause) {
      setPreviewProblem(errorMessage(cause, 'That version could not be loaded.'));
    }
  }

  async function restore(version: StoryVersionSummary): Promise<void> {
    setRestoring(true);
    setRestoreError(null);
    try {
      onRestored(await restoreStoryVersion(projectId, version.number));
      setConfirming(null);
      onOpenChange(false);
    } catch (cause) {
      setRestoreError(errorMessage(cause, 'That version could not be restored. Nothing has changed.'));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={onOpenChange}
        title={copy.title}
        description={copy.description}
      >
        {status === 'loading' && (
          <SkeletonGroup label={copy.loadingLabel}>
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} height="4.5rem" />
              ))}
            </div>
          </SkeletonGroup>
        )}

        {status === 'failed' && (
          <>
            <InlineAlert variant="danger" title={copy.failedTitle}>
              {error}
            </InlineAlert>
            <Pill variant="ghost" size="sm" className="mt-3" onClick={() => void load()}>
              {copy.tryAgain}
            </Pill>
          </>
        )}

        {status === 'ready' && versions.length === 0 && (
          <EmptyState
            headingLevel={3}
            title={copy.emptyTitle}
            description={copy.emptyDescription}
          />
        )}

        {status === 'ready' && versions.length > 0 && (
          <ul className="flex flex-col gap-3">
            {versions.map((version, position) => (
              <li key={version.number} className="rounded-lg border border-white/8 bg-surface-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[15px] font-medium text-white">
                      Version {version.number}
                      {/*
                        "Current" is a word, not a colour: the difference between the
                        version that matches what is on screen and the rest must not
                        depend on telling two greys apart (docs/ui-kit.md §9.2).
                      */}
                      {position === 0 && (
                        <span className="ml-2 text-[13px] font-normal text-white/64">
                          most recent
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[13px] text-white/64">
                      <time dateTime={version.createdAt}>{formatMoment(version.createdAt)}</time>
                      {' · '}
                      {version.characters.toLocaleString('en')} characters
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Pill
                      variant="ghost"
                      size="sm"
                      aria-expanded={previewing === version.number}
                      aria-label={fillPlaceholders(copy.previewVersion, { number: String(version.number) })}
                      onClick={() =>
                        previewing === version.number
                          ? setPreviewing(null)
                          : void showPreview(version)
                      }
                    >
                      {previewing === version.number ? 'Hide' : copy.preview}
                    </Pill>
                    <Pill
                      variant="ghost"
                      size="sm"
                      aria-label={fillPlaceholders(copy.restoreVersion, { number: String(version.number) })}
                      onClick={() => {
                        setRestoreError(null);
                        setConfirming(version);
                      }}
                    >
                      {copy.restore}
                    </Pill>
                  </div>
                </div>

                {previewing === version.number && (
                  <div className="mt-3 border-t border-white/8 pt-3">
                    {previewProblem !== null ? (
                      <InlineAlert variant="warning">{previewProblem}</InlineAlert>
                    ) : preview === null ? (
                      <p className="text-[13px] text-white/64">Loading this version…</p>
                    ) : (
                      <StoryPreview copy={copy} vocabulary={vocabulary} document={preview} />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Drawer>

      <Modal
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) setConfirming(null);
        }}
        title={confirming === null ? copy.restoreTitle : fillPlaceholders(copy.confirmTitle, { number: String(confirming.number) })}
        description={copy.replaceWarning}
        // The creator has to choose. Dismissing by clicking outside a dialog about
        // overwriting an afternoon's work is too easy a way to press the wrong thing.
        closeOnBackdropClick={false}
        showClose={false}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Pill variant="ghost" disabled={restoring} onClick={() => setConfirming(null)}>
              {copy.keepMine}
            </Pill>
            {/*
              Lime, because this is the action the dialog exists for and lime means
              "act now" (docs/ui-kit.md §2.3) — near-black text on it, never the
              reverse. It is not `--danger`: the restore is recoverable, and dressing
              a recoverable action as a destructive one makes the genuinely
              destructive ones mean less.
            */}
            <Pill
              variant="accent"
              disabled={restoring}
              onClick={() => {
                if (confirming !== null) void restore(confirming);
              }}
            >
              {restoring ? copy.restoring : copy.restoreThis}
            </Pill>
          </div>
        }
      >
        {confirming !== null && (
          <div className="flex flex-col gap-3 text-[15px]">
            <p>
              Version {confirming.number} was saved{' '}
              <time dateTime={confirming.createdAt}>{formatMoment(confirming.createdAt)}</time> and
              holds {confirming.characters.toLocaleString('en')} characters.
            </p>
            <p>
              The story you have now holds {currentCharacters.toLocaleString('en')} characters. It is
              kept as a version before being replaced, so this can be undone from this same list.
            </p>
            {restoreError !== null && <InlineAlert variant="danger">{restoreError}</InlineAlert>}
          </div>
        )}
      </Modal>
    </>
  );
}

/* -------------------------------------------------------------------------
 * The preview
 * ---------------------------------------------------------------------- */

/**
 * A version's blocks as text, labelled by kind.
 *
 * Deliberately not a rendering of the story — see the note on the component above.
 * A heading is shown as a heading's text with its kind beside it rather than as an
 * `h2`, so that a preview inside a drawer does not add a second document outline to
 * the page.
 */
function StoryPreview({
  copy,
  vocabulary,
  document,
}: {
  copy: StoryHistoryCopy;
  vocabulary: StoryVocabularyCopy;
  document: StoryDocument;
}) {
  if (document.blocks.length === 0) {
    return <p className="text-[13px] text-white/64">{copy.noBlocks}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] text-white/40">
        {fillPlaceholders(
          pluralise(vocabulary.locale, copy.previewSummary, document.blocks.length),
          {
            count: String(document.blocks.length),
            /* The reader's own digit grouping, not English's. */
            characters: storyCharacterCount(document).toLocaleString(
              INTL_LOCALE[vocabulary.locale],
            ),
          },
        )}
      </p>
      <ol className="flex flex-col gap-2 text-[13px]">
        {document.blocks.map((block, index) => (
          <li key={index} className="text-white/64">
            <span className="text-white/40">{vocabulary.blockLabel[block.type]}: </span>
            {blockText(block)}
          </li>
        ))}
      </ol>
    </div>
  );
}


function blockText(block: StoryDocument['blocks'][number]): string {
  switch (block.type) {
    case 'heading':
      return block.text;
    case 'paragraph':
    case 'quote':
      return spansToText(block.spans);
    case 'list':
      return block.items.map((item) => spansToText(item)).join(' · ');
    case 'rule':
      return '—';
    case 'image':
      return block.alt;
    case 'embed':
      return block.title;
  }
}

/**
 * A moment a creator can read, in their own zone.
 *
 * Wrapped in a `<time datetime>` by the caller, so the machine-readable instant is
 * present whatever this produces. `Intl` rather than a hand-written format: the
 * alternative is a relative time ("3 minutes ago") that has to be re-rendered on a
 * timer, and a page that never settles is exactly what the motion budget forbids.
 */
function formatMoment(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
