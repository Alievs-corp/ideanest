'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import {
  EmptyState,
  IconButton,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
} from '@ideanest/ui';
import { Modal } from '@ideanest/ui/motion';
import {
  deleteFaq,
  listFaqs,
  reorderFaqs,
  MAX_PROJECT_FAQS,
  type ProjectFaq,
} from '../../lib/projects/api';
import { movedTo } from '../../lib/projects/rewards';
import type { EditorChromeCopy } from '../../lib/i18n/campaign-editor-copy';
import { EditorShell } from './EditorShell';
import { FaqEntryEditor } from './FaqEntryEditor';
import { describeFailure, type SaveFailure } from './useAutosave';
import { useProjectEdit } from './useProjectEdit';

/**
 * The FAQ tab of the campaign editor — §4.4's "creator-managed question and
 * answer list", the half of #283 that puts content on the public tab.
 *
 * <h3>WITHOUT THIS THE PUBLIC TAB IS PERMANENTLY EMPTY</h3>
 *
 * The reader half of #283 is a tab that renders whatever the service holds.
 * Nothing on the platform could put anything there, so shipping the tab alone
 * would have replaced one permanent empty state ("no endpoint") with another
 * ("no way to write"). The tab and the panel are one change.
 *
 * <h3>REORDERING IS BUTTONS, NOT DRAGGING</h3>
 *
 * The same rule and the same reason as `RewardsPanel`, and the same rule
 * docs/ui-kit.md §7.13 states about the drop zone's button: dragging alone is
 * unreachable by keyboard, by switch control, and on every touch device, and
 * CLAUDE.md makes an accessibility failure a build error rather than a nicety.
 * So the order is changed by a pair of controls per entry, each with a name that
 * says which entry it moves and where it is, and each move is announced through
 * a polite live region with the new position in it — a creator who cannot see
 * the list has to be told the move happened, because a visual reshuffle tells
 * them nothing.
 *
 * Focus is handed on deliberately: an entry moved to the top has no "move up"
 * left, so focus lands on its "move down" rather than being dropped at the top
 * of the document by a button that disabled itself under the creator's finger.
 *
 * Pointer dragging is a layer that could be added ON TOP of this later. It is
 * not a replacement for it.
 *
 * <h3>THE ORDER IS SENT WHOLE</h3>
 *
 * `PATCH /v1/projects/{id}/faqs/reorder` takes every identifier exactly once or
 * refuses with `FAQ_ORDER_INCOMPLETE` and a `meta` naming what was missing and
 * what was unexpected. That refusal is rendered rather than swallowed, and it is
 * rendered as sentences about questions rather than as identifiers: a creator
 * cannot act on a UUID, and the refusal only ever happens when this page's list
 * has fallen behind the service's — an entry added or deleted in another tab.
 *
 * <h3>MOTION: NONE</h3>
 *
 * docs/motion-system.md §5 gives the campaign editor "none — autosave indicator
 * only". The drawer brings its own 200ms entry, which honours
 * `prefers-reduced-motion`; nothing here adds any. In particular the list does
 * not animate as it reorders — a creator pressing "move up" four times would be
 * watching an animation rather than a list.
 */

const LOADING_ROWS = [0, 1, 2];

type ListStatus = 'loading' | 'ready' | 'failed';

export interface FaqPanelProps {
  projectId: string;
  /** The editor frame's words, resolved by this tab's page. */
  copy: EditorChromeCopy;
}

export function FaqPanel({ projectId, copy }: FaqPanelProps) {
  const { project, status, error, reload } = useProjectEdit(projectId);

  const [faqs, setFaqs] = useState<readonly ProjectFaq[]>([]);
  const [listStatus, setListStatus] = useState<ListStatus>('loading');
  const [listError, setListError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [editor, setEditor] = useState<{ open: boolean; faq: ProjectFaq | null }>({
    open: false,
    faq: null,
  });
  const [deleting, setDeleting] = useState<ProjectFaq | null>(null);

  /** The refusal from whichever action was last attempted outside the drawer. */
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  /** The entry a request is currently running against, so its controls rest. */
  const [busyId, setBusyId] = useState<string | null>(null);

  const [announcement, setAnnouncement] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const [focusAfterMove, setFocusAfterMove] = useState<{
    id: string;
    direction: 'up' | 'down';
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      setListStatus('loading');
      try {
        setFaqs(await listFaqs(projectId, controller.signal));
        if (controller.signal.aborted) return;
        setListError(null);
        setListStatus('ready');
      } catch (cause) {
        if (controller.signal.aborted) return;
        setListError(describeFailure(cause).message);
        setListStatus('failed');
      }
    })();

    return () => controller.abort();
  }, [projectId, attempt]);

  useEffect(() => {
    if (focusAfterMove === null) return;

    /*
     * Found in the DOM rather than through a ref map, for the reason
     * `RewardsPanel` gives: `IconButton` types its props as
     * `ComponentPropsWithoutRef<'button'>` and takes no ref, and adding one to
     * the design-system package to serve one screen is a change to every
     * consumer of it. The data attributes below are there for this lookup.
     */
    const selector = `button[data-faq-id="${focusAfterMove.id}"][data-faq-move="${focusAfterMove.direction}"]`;
    const button = listRef.current?.querySelector(selector);
    if (button instanceof HTMLButtonElement) button.focus();

    setFocusAfterMove(null);
  }, [focusAfterMove]);

  /** The server's answer to a save, merged into the list. */
  const applyFaq = useCallback((saved: ProjectFaq) => {
    setFaqs((current) => {
      const known = current.some((faq) => faq.id === saved.id);
      return known
        ? current.map((faq) => (faq.id === saved.id ? saved : faq))
        : [...current, saved];
    });
  }, []);

  /* ---------------------------------------------------------------------
   * Order
   * ------------------------------------------------------------------ */

  /**
   * The order the server has not yet been told about, and whether a request is
   * already carrying one.
   *
   * A creator moving an entry three places presses the button three times, and
   * three overlapping reorders can be answered out of order — leaving the list
   * in whichever order came back last rather than the one on screen. So one
   * request is in flight at a time and the newest order supersedes any waiting
   * one, which is the rule `useAutosave` applies to its patches and
   * `RewardsPanel` applies to this exact problem.
   */
  const queuedOrder = useRef<readonly string[] | null>(null);
  const reordering = useRef(false);

  const sendOrder = useCallback(async (): Promise<void> => {
    if (reordering.current) return;
    reordering.current = true;

    try {
      while (queuedOrder.current !== null) {
        const order = queuedOrder.current;
        queuedOrder.current = null;
        try {
          setFaqs(await reorderFaqs(projectId, order));
          setFailure(null);
        } catch (cause) {
          setFailure(describeFailure(cause));
          /*
           * The optimistic order on screen is now a lie. Re-reading is the only
           * honest recovery: the service refuses a partial order outright, so a
           * failure means the stored order is whatever it was before, and
           * keeping the moved list would show a creator an order that does not
           * exist.
           */
          setAttempt((n) => n + 1);
          queuedOrder.current = null;
          break;
        }
      }
    } finally {
      reordering.current = false;
    }
  }, [projectId]);

  function move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    const moving = faqs[index];
    if (moving === undefined || target < 0 || target >= faqs.length) return;

    const next = movedTo(faqs, index, target);
    setFaqs(next);
    setAnnouncement(`${moving.question} moved to position ${target + 1} of ${faqs.length}.`);

    /*
     * Where focus should land once the list has re-rendered. An entry at either
     * end loses one of its two controls, so focus goes to the one it keeps.
     */
    setFocusAfterMove({
      id: moving.id,
      direction:
        target === 0
          ? 'down'
          : target === faqs.length - 1
            ? 'up'
            : direction === -1
              ? 'up'
              : 'down',
    });

    /*
     * EVERY IDENTIFIER, EXACTLY ONCE. The list on screen is the whole list, so
     * the whole list is what goes out; a partial order would leave the entries
     * it omits where they were, interleaved with the ones that moved.
     */
    queuedOrder.current = next.map((faq) => faq.id);
    void sendOrder();
  }

  /* ---------------------------------------------------------------------
   * Delete
   * ------------------------------------------------------------------ */

  async function remove(faq: ProjectFaq): Promise<void> {
    setBusyId(faq.id);
    setFailure(null);
    try {
      await deleteFaq(faq.id);
      setFaqs((current) => current.filter((entry) => entry.id !== faq.id));
      setAnnouncement(`${faq.question} was deleted.`);
      setDeleting(null);
    } catch (cause) {
      setFailure(describeFailure(cause));
    } finally {
      setBusyId(null);
    }
  }

  /* ---------------------------------------------------------------------
   * The shell's own states
   * ------------------------------------------------------------------ */

  if (status === 'signed-out') {
    return (
      <EditorShell projectId={projectId} copy={copy} active="faq">
        <InlineAlert variant="info" title="You are signed out">
          This browser no longer has a session. Sign in again to keep editing this campaign.
        </InlineAlert>
      </EditorShell>
    );
  }

  if (status === 'failed' || project === null) {
    return (
      <EditorShell projectId={projectId} copy={copy} active="faq">
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
          <SkeletonGroup label="Loading this campaign’s questions">
            <div className="flex flex-col gap-3">
              {LOADING_ROWS.map((row) => (
                <Skeleton key={row} height="5rem" />
              ))}
            </div>
          </SkeletonGroup>
        )}
      </EditorShell>
    );
  }

  const full = faqs.length >= MAX_PROJECT_FAQS;

  return (
    <EditorShell projectId={projectId} copy={copy} active="faq" title={project.title} state={project.state}>
      <div className="flex flex-col gap-6">
        {/*
          Present from the first render, so the region is registered before
          anything is put in it — one created and filled in the same commit is
          not reliably announced. It carries the outcome of a reorder and of a
          delete: the two actions here whose only other evidence is the list
          visibly rearranging itself.
        */}
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-medium tracking-[-0.02em] text-white">
              Questions{' '}
              {/* Tertiary at 12px: present, never competing with the title
                  (docs/ui-kit.md §7.12). */}
              <span className="text-xs font-normal text-white/40">({faqs.length})</span>
            </h2>
            <p className="mt-1 max-w-[60ch] text-[13px] text-white/64">
              These appear on the campaign’s FAQ tab, in this order. Answering the question a
              backer would otherwise ask in the comments is the point of the list.
            </p>
          </div>

          <Pill
            variant="ghost"
            size="sm"
            disabled={full}
            iconLeft={<Plus aria-hidden="true" className="size-4" />}
            onClick={() => setEditor({ open: true, faq: null })}
          >
            Add a question
          </Pill>
        </div>

        {full && (
          /*
            A sentence rather than a disabled control on its own. §4.4 caps the
            list at fifty and says the answer above that is a cursor rather than
            a bigger cap; either way a creator who cannot press "Add" is owed the
            reason.
          */
          <InlineAlert variant="info" title="This campaign is at the limit">
            A campaign may publish {MAX_PROJECT_FAQS} questions. Delete one to add another.
          </InlineAlert>
        )}

        {failure !== null && (
          <InlineAlert variant="danger" title="That did not work">
            <p>{failure.message}</p>
            {failure.code === 'FAQ_ORDER_INCOMPLETE' && (
              /*
                The service refuses an order that is not every entry exactly once
                and names what was wrong in `meta`. It only happens when this
                page's list has fallen behind — an entry added or deleted
                somewhere else — so the recovery is the reload the reorder
                already triggered, and what the creator needs is to be told which
                questions the two lists disagreed about.
              */
              <p className="mt-2 text-white/64">{describeOrderRefusal(failure, faqs)}</p>
            )}
          </InlineAlert>
        )}

        {listStatus === 'failed' && (
          <>
            <InlineAlert variant="danger" title="The questions could not be loaded">
              {listError}
            </InlineAlert>
            <Pill
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Try again
            </Pill>
          </>
        )}

        {listStatus === 'loading' ? (
          <SkeletonGroup label="Loading this campaign’s questions">
            <div className="flex flex-col gap-2">
              {LOADING_ROWS.map((row) => (
                <Skeleton key={row} height="5rem" />
              ))}
            </div>
          </SkeletonGroup>
        ) : faqs.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No questions yet"
            description="The campaign page shows this list on its own tab. Until there is something in it, the tab tells a backer the campaign has not answered anything yet — which is true, and is worth changing before you launch."
            action={
              <Pill variant="ghost" size="sm" onClick={() => setEditor({ open: true, faq: null })}>
                Add the first question
              </Pill>
            }
          />
        ) : (
          /*
            An ordered list, because the order is the content: it is what
            `PATCH …/faqs/reorder` stores and what a backer reads down. A `div`
            of cards would leave a screen reader saying "6 items" with no way to
            know which one is third.
          */
          <ol
            ref={listRef}
            aria-label="Questions, in the order backers see them"
            className="flex flex-col gap-2"
          >
            {faqs.map((faq, index) => (
              <li key={faq.id}>
                <FaqRow
                  faq={faq}
                  position={index + 1}
                  total={faqs.length}
                  busy={busyId === faq.id}
                  onMoveUp={() => move(index, -1)}
                  onMoveDown={() => move(index, 1)}
                  onEdit={() => setEditor({ open: true, faq })}
                  onDelete={() => setDeleting(faq)}
                />
              </li>
            ))}
          </ol>
        )}
      </div>

      <FaqEntryEditor
        projectId={projectId}
        drawer={copy.drawer}
        open={editor.open}
        faq={editor.faq}
        onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
        onSaved={applyFaq}
      />

      <Modal
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title={deleting === null ? 'Delete question' : `Delete “${deleting.question}”?`}
        description="This cannot be undone."
        // The creator has to choose. Dismissing a dialog about deletion by
        // clicking beside it is too easy a way to press the wrong thing.
        closeOnBackdropClick={false}
        showClose={false}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Pill variant="ghost" disabled={busyId !== null} onClick={() => setDeleting(null)}>
              Keep it
            </Pill>
            <Pill
              variant="danger"
              disabled={busyId !== null}
              onClick={() => {
                if (deleting !== null) void remove(deleting);
              }}
            >
              Delete
            </Pill>
          </div>
        }
      >
        <p>
          Nothing is owed against a question, so it goes for good — unlike a reward tier, which
          can only be hidden once somebody has chosen it.
        </p>
      </Modal>
    </EditorShell>
  );
}

/* -------------------------------------------------------------------------
 * One entry in the list
 * ---------------------------------------------------------------------- */

interface FaqRowProps {
  faq: ProjectFaq;
  position: number;
  total: number;
  busy: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function FaqRow({
  faq,
  position,
  total,
  busy,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
}: FaqRowProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-white/8 bg-surface-2 p-4">
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-medium text-white">{faq.question}</h3>
        {/*
          Two lines of the answer, as text. The public tab renders the whole
          thing with its paragraph breaks; here the creator needs to recognise
          which entry this is, and a 4000-character answer in a list row would
          make the list unreadable. `line-clamp` truncates visually and leaves
          the whole string in the accessible name of nothing — it is a
          paragraph, so a screen reader still reads what is there.
        */}
        <p className="mt-1 line-clamp-2 max-w-[60ch] text-[13px] whitespace-pre-line text-white/64">
          {faq.answer}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center gap-1">
          {/*
            The keyboard and screen-reader route through reordering. Each name
            says which entry moves and where it is now, because "Move up" six
            times over is six identical controls (docs/ui-kit.md §9.1).
          */}
          <IconButton
            icon={<ChevronUp />}
            label={`Move ${faq.question} up, currently ${position} of ${total}`}
            variant="ghost"
            size="sm"
            disabled={position === 1}
            data-faq-id={faq.id}
            data-faq-move="up"
            onClick={onMoveUp}
          />
          <IconButton
            icon={<ChevronDown />}
            label={`Move ${faq.question} down, currently ${position} of ${total}`}
            variant="ghost"
            size="sm"
            disabled={position === total}
            data-faq-id={faq.id}
            data-faq-move="down"
            onClick={onMoveDown}
          />
        </div>

        <Pill
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-label={`Edit ${faq.question}`}
          onClick={onEdit}
        >
          Edit
        </Pill>
        <Pill
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-label={`Delete ${faq.question}`}
          onClick={onDelete}
        >
          Delete
        </Pill>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * The reorder refusal, in words
 * ---------------------------------------------------------------------- */

/**
 * `FAQ_ORDER_INCOMPLETE`, as a sentence about questions rather than identifiers.
 *
 * `meta.missing` names entries the service holds that the order left out;
 * `meta.unexpected` names identifiers the order carried that the service does
 * not have. A creator can act on neither as a UUID, so each is turned back into
 * the question it belongs to wherever this page still knows it, and counted
 * where it does not — an identifier this page has never seen is by definition
 * one it cannot name.
 */
export function describeOrderRefusal(
  failure: SaveFailure,
  faqs: readonly ProjectFaq[],
): string {
  const missing = namesOf(failure.meta?.['missing'], faqs);
  const unexpected = namesOf(failure.meta?.['unexpected'], faqs);

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`this page had not seen ${list(missing)}`);
  if (unexpected.length > 0) parts.push(`${list(unexpected)} no longer exists`);

  const detail = parts.length === 0 ? 'the two lists disagreed' : parts.join(', and ');
  return `The order was refused because ${detail}. The list has been read again, so it now matches the campaign — put it back in the order you wanted.`;
}

function namesOf(value: unknown, faqs: readonly ProjectFaq[]): readonly string[] {
  if (!Array.isArray(value)) return [];

  const named: string[] = [];
  let unnamed = 0;
  for (const id of value as readonly unknown[]) {
    const known = typeof id === 'string' ? faqs.find((faq) => faq.id === id) : undefined;
    if (known === undefined) unnamed += 1;
    else named.push(`“${known.question}”`);
  }

  if (unnamed > 0) named.push(`${unnamed} other question${unnamed === 1 ? '' : 's'}`);
  return named;
}

/** "a", "a and b", "a, b and c". */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}
