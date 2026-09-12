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
  Tag,
} from '@ideanest/ui';
import { Modal } from '@ideanest/ui/motion';
import { formatMoney } from '../../lib/money';
import {
  deleteItem,
  deleteReward,
  duplicateReward,
  listItems,
  listRewards,
  patchReward,
  reorderRewards,
  type Item,
  type Reward,
} from '../../lib/projects/api';
import {
  MAX_REWARD_TIERS,
  describeStock,
  hidePatch,
  isHiddenReward,
  isScheduledReward,
  movedTo,
  shippingScopeLabel,
  showBlockedReason,
  showPatch,
} from '../../lib/projects/rewards';
import type {
  EditorChromeCopy,
  RewardsPanelCopy,
} from '../../lib/i18n/campaign-editor-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralise } from '../../lib/i18n/plurals';
import { EditorShell } from './EditorShell';
import { ItemEditor } from './ItemEditor';
import { ItemsSection } from './ItemsSection';
import { RewardTierEditor } from './RewardTierEditor';
import { describeFailure, type SaveFailure } from './useAutosave';
import { useProjectEdit } from './useProjectEdit';

/**
 * The rewards tab: the campaign's items, and the tiers composed from them.
 *
 * <h3>ITEMS FIRST, THEN TIERS</h3>
 *
 * The order §4.6 puts them in, and the order the endpoints are shaped for: a
 * tier is a selection of items with quantities, so there is nothing to compose
 * until the items exist.
 *
 * <h3>THERE IS NO AUTOSAVE ON THIS TAB</h3>
 *
 * Every other tab in this editor writes on a debounce. This one commits when
 * the creator presses Save, and the reasoning is set out in full on
 * `RewardTierEditor`: a half-typed price is a different valid price, a
 * half-typed quantity limit is refused by §5.3, and creating a tier is a `POST`
 * that cannot be debounced into existence. Nothing was forked to do it —
 * `describeFailure` and the failure shape are `useAutosave`'s, and only the
 * debounce is absent.
 *
 * The actions that are NOT a form — reorder, duplicate, hide, delete — commit
 * on the click, because a click is already an explicit instruction and there is
 * nothing to debounce.
 *
 * <h3>REORDERING IS BUTTONS, NOT DRAGGING</h3>
 *
 * §4.6 says drag-to-reorder. Dragging alone is unreachable by keyboard, by
 * switch control, and on every touch device, and CLAUDE.md makes an
 * accessibility failure a build error rather than a nicety — so the order is
 * changed by a pair of controls per tier, each with a name that says which tier
 * it moves, and each move is announced through a polite live region with the
 * new position in it. A creator who cannot see the list has to be told the move
 * happened; a visual reshuffle tells them nothing.
 *
 * Focus is handed on deliberately: a tier moved to the top has no "move up"
 * left, so focus lands on its "move down" instead of being dropped at the top
 * of the document.
 *
 * Pointer dragging is a layer that could be added ON TOP of this later. It is
 * not a replacement for it, and it is not in this change.
 *
 * <h3>MOTION: NONE</h3>
 *
 * docs/motion-system.md §5 gives the campaign editor "none — autosave
 * indicator only". The drawers bring their own 200ms entry, which honours
 * `prefers-reduced-motion`; nothing on this page adds any. In particular the
 * list does not animate as it reorders: a creator pressing "move up" four times
 * would be watching an animation rather than a list.
 */

const LOADING_ROWS = [0, 1, 2];

type ListStatus = 'loading' | 'ready' | 'failed';

export interface RewardsPanelProps {
  projectId: string;
  /** The editor frame's words, resolved by this tab's page. */
  copy: EditorChromeCopy;
  /** This tab's own words, and those of the drawers it opens. */
  rewards: RewardsPanelCopy;
}

export function RewardsPanel({ projectId, copy, rewards: words }: RewardsPanelProps) {
  const { project, status, error, reload } = useProjectEdit(projectId);

  const [items, setItems] = useState<readonly Item[]>([]);
  const [rewards, setRewards] = useState<readonly Reward[]>([]);
  const [listStatus, setListStatus] = useState<ListStatus>('loading');
  const [listError, setListError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [itemEditor, setItemEditor] = useState<{ open: boolean; item: Item | null }>({
    open: false,
    item: null,
  });
  const [tierEditor, setTierEditor] = useState<{ open: boolean; reward: Reward | null }>({
    open: false,
    reward: null,
  });

  const [deletingItem, setDeletingItem] = useState<Item | null>(null);
  const [deletingReward, setDeletingReward] = useState<Reward | null>(null);

  /** The refusal from whichever action was last attempted outside a drawer. */
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  /** The identifier a request is running against, so its own controls rest. */
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
        /*
         * Both at once. The tier list is unreadable without the item list —
         * a composition names items by identifier — so waiting for one before
         * asking for the other would double the time the page is a skeleton
         * for no benefit.
         */
        const [loadedItems, loadedRewards] = await Promise.all([
          listItems(projectId, controller.signal),
          listRewards(projectId, controller.signal),
        ]);
        if (controller.signal.aborted) return;

        setItems(loadedItems);
        setRewards(loadedRewards);
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
     * Found in the DOM rather than through a ref map. `IconButton` types its
     * props as `ComponentPropsWithoutRef<'button'>`, so it takes no ref — and
     * adding one to the design-system package to serve one screen is a change
     * to every consumer of it. The data attributes below are already there for
     * exactly this lookup.
     */
    const selector = `button[data-reward-id="${focusAfterMove.id}"][data-reward-move="${focusAfterMove.direction}"]`;
    const button = listRef.current?.querySelector(selector);
    if (button instanceof HTMLButtonElement) button.focus();

    setFocusAfterMove(null);
  }, [focusAfterMove]);

  /**
   * The server's answer to a save, merged into the list.
   *
   * It does NOT reach into the open drawer. The drawer holds its own record of
   * the tier the service last confirmed, because a save can half-succeed — the
   * tier stored, the rate table refused — and pushing the saved tier back down
   * would re-seed the form and throw away the rates the creator is about to fix.
   */
  const applyReward = useCallback((saved: Reward) => {
    setRewards((current) => {
      const known = current.some((reward) => reward.id === saved.id);
      return known
        ? current.map((reward) => (reward.id === saved.id ? saved : reward))
        : [...current, saved];
    });
  }, []);

  const applyItem = useCallback((saved: Item) => {
    setItems((current) => {
      const known = current.some((item) => item.id === saved.id);
      return known
        ? current.map((item) => (item.id === saved.id ? saved : item))
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
   * A creator moving a tier three places presses the button three times, and
   * three overlapping reorders can be answered out of order — leaving the list
   * in whichever order came back last rather than the one on screen. So one
   * request is in flight at a time and the newest order supersedes any waiting
   * one, which is the same rule `useAutosave` applies to its patches.
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
          setRewards(await reorderRewards(projectId, order));
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
    const moving = rewards[index];
    if (moving === undefined || target < 0 || target >= rewards.length) return;

    const next = movedTo(rewards, index, target);
    setRewards(next);
    setAnnouncement(
      fillPlaceholders(words.movedAnnouncement, {
        title: moving.title,
        position: String(target + 1),
        total: String(rewards.length),
      }),
    );

    /*
     * Where focus should land once the list has re-rendered. A tier at either
     * end loses one of its two controls, so focus goes to the one it keeps —
     * without this the creator is dropped at the top of the document by a
     * button that disabled itself under their finger.
     */
    setFocusAfterMove({
      id: moving.id,
      direction: target === 0 ? 'down' : target === rewards.length - 1 ? 'up' : direction === -1 ? 'up' : 'down',
    });

    queuedOrder.current = next.map((reward) => reward.id);
    void sendOrder();
  }

  /* ---------------------------------------------------------------------
   * The actions that are not a form
   * ------------------------------------------------------------------ */

  async function run(id: string, action: () => Promise<void>): Promise<void> {
    setBusyId(id);
    setFailure(null);
    try {
      await action();
    } catch (cause) {
      setFailure(describeFailure(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function duplicate(reward: Reward): Promise<void> {
    await run(reward.id, async () => {
      const copy = await duplicateReward(reward.id);
      setRewards((current) => [...current, copy]);
      setAnnouncement(
        fillPlaceholders(words.duplicatedAnnouncement, {
          title: reward.title,
          position: String(rewards.length + 1),
        }),
      );
    });
  }

  async function setVisibility(reward: Reward, hidden: boolean): Promise<void> {
    await run(reward.id, async () => {
      const saved = await patchReward(reward.id, hidden ? hidePatch(reward) : showPatch());
      setRewards((current) => current.map((one) => (one.id === saved.id ? saved : one)));
      setAnnouncement(
        hidden
          ? fillPlaceholders(words.hiddenAnnouncement, { title: reward.title })
          : fillPlaceholders(words.shownAnnouncement, { title: reward.title }),
      );
    });
  }

  async function removeReward(reward: Reward): Promise<void> {
    await run(reward.id, async () => {
      await deleteReward(reward.id);
      setRewards((current) => current.filter((one) => one.id !== reward.id));
      setDeletingReward(null);
      setAnnouncement(fillPlaceholders(words.rewardDeletedAnnouncement, { title: reward.title }));
    });
  }

  async function removeItem(item: Item): Promise<void> {
    await run(item.id, async () => {
      await deleteItem(item.id);
      setItems((current) => current.filter((one) => one.id !== item.id));
      setDeletingItem(null);
      setAnnouncement(fillPlaceholders(words.itemDeletedAnnouncement, { name: item.name }));
    });
  }

  /* ---------------------------------------------------------------------
   * Rendering
   * ------------------------------------------------------------------ */

  if (status === 'signed-out') {
    return (
      <EditorShell projectId={projectId} copy={copy} active="rewards">
        <InlineAlert variant="info" title={copy.signedOutTitle}>
          {copy.signedOutDetail}
        </InlineAlert>
      </EditorShell>
    );
  }

  if (status === 'failed' || project === null) {
    return (
      <EditorShell projectId={projectId} copy={copy} active="rewards">
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
          <SkeletonGroup label={words.loadingLabel}>
            <div className="flex flex-col gap-3">
              {LOADING_ROWS.map((row) => (
                <Skeleton key={row} height="6rem" />
              ))}
            </div>
          </SkeletonGroup>
        )}
      </EditorShell>
    );
  }

  const full = rewards.length >= MAX_REWARD_TIERS;

  return (
    <EditorShell
      projectId={projectId}
      copy={copy}
      active="rewards"
      title={project.title}
      state={project.state}
    >
      <div className="flex flex-col gap-10">
        {/*
          Present from the first render, so the region is registered before
          anything is put in it — one created and filled in the same commit is
          not reliably announced. It carries the outcome of a reorder, a
          duplication, a hide, and a delete: every action on this page whose
          only other evidence is the list visibly rearranging itself.
        */}
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {failure !== null && (
          <InlineAlert variant="danger" title={words.failedTitle}>
            <p>{failure.message}</p>
            {failure.code === 'ITEM_IN_USE' && (
              <p className="mt-2 text-white/64">
                {fillPlaceholders(
                  pluralise(words.locale, words.itemInUse, tierCount(failure)),
                  { tiers: namedTiers(failure, rewards, words) },
                )}
              </p>
            )}
            {failure.code === 'REWARD_HAS_BACKERS' && (
              <p className="mt-2 text-white/64">{words.rewardHasBackers}</p>
            )}
          </InlineAlert>
        )}

        {listStatus === 'failed' && (
          <>
            <InlineAlert variant="danger" title={words.rewardsFailedTitle}>
              {listError}
            </InlineAlert>
            <Pill
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setAttempt((n) => n + 1)}
            >
              {copy.tryAgain}
            </Pill>
          </>
        )}

        <ItemsSection
          copy={words.items}
          items={items}
          loading={listStatus === 'loading'}
          busyId={busyId}
          onAdd={() => setItemEditor({ open: true, item: null })}
          onEdit={(item) => setItemEditor({ open: true, item })}
          onDelete={setDeletingItem}
        />

        <section aria-labelledby="rewards-heading" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="rewards-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
              {words.rewardsHeading}{' '}
              <span className="text-xs font-normal text-white/40">
                (
                {fillPlaceholders(words.countOf, {
                  count: String(rewards.length),
                  max: String(MAX_REWARD_TIERS),
                })}
                )
              </span>
            </h2>

            <Pill
              variant="ghost"
              size="sm"
              disabled={full}
              iconLeft={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => setTierEditor({ open: true, reward: null })}
            >
              {words.add}
            </Pill>
          </div>

          {full && (
            <InlineAlert variant="warning" title={words.atCapacityTitle}>
              §5.3 allows {MAX_REWARD_TIERS}. Delete or combine one before adding another.
            </InlineAlert>
          )}

          {listStatus === 'loading' ? (
            <SkeletonGroup label={words.loadingLabel}>
              <div className="flex flex-col gap-3">
                {LOADING_ROWS.map((row) => (
                  <Skeleton key={row} height="7rem" />
                ))}
              </div>
            </SkeletonGroup>
          ) : rewards.length === 0 ? (
            <EmptyState
              headingLevel={3}
              title={words.emptyTitle}
              description={words.description}
              action={
                <Pill
                  variant="ghost"
                  size="sm"
                  onClick={() => setTierEditor({ open: true, reward: null })}
                >
                  {words.addFirst}
                </Pill>
              }
            />
          ) : (
            /*
              An ordered list, because the order is the content: it is what
              `PATCH …/rewards/reorder` stores and what a backer reads down. A
              `div` of cards would leave a screen reader saying "5 items" with
              no way to know which one is third.
            */
            <ol ref={listRef} aria-label={words.listLabel} className="flex flex-col gap-3">
              {rewards.map((reward, index) => (
                <RewardCard
                  words={words}
                  key={reward.id}
                  reward={reward}
                  items={items}
                  position={index + 1}
                  total={rewards.length}
                  busy={busyId === reward.id}
                  onMoveUp={() => move(index, -1)}
                  onMoveDown={() => move(index, 1)}
                  onEdit={() => setTierEditor({ open: true, reward })}
                  onDuplicate={() => void duplicate(reward)}
                  onHide={() => void setVisibility(reward, true)}
                  onShow={() => void setVisibility(reward, false)}
                  onDelete={() => setDeletingReward(reward)}
                />
              ))}
            </ol>
          )}
        </section>
      </div>

      <ItemEditor
        copy={words.item}
        validation={words.vocabulary.item}
        projectId={projectId}
        open={itemEditor.open}
        item={itemEditor.item}
        onOpenChange={(open) => setItemEditor((current) => ({ ...current, open }))}
        onSaved={applyItem}
      />

      <RewardTierEditor
        copy={words.tier}
        vocabulary={words.vocabulary}
        project={project}
        open={tierEditor.open}
        reward={tierEditor.reward}
        items={items}
        onOpenChange={(open) => setTierEditor((current) => ({ ...current, open }))}
        onSaved={applyReward}
      />

      <Modal
        open={deletingItem !== null}
        onOpenChange={(next) => {
          if (!next) setDeletingItem(null);
        }}
        title={
          deletingItem === null
            ? words.deleteItemTitle
            : fillPlaceholders(words.deleteItemNamed, { name: deletingItem.name })
        }
        description={words.cannotBeUndone}
        // The creator has to choose. Dismissing a dialog about deletion by
        // clicking beside it is too easy a way to press the wrong thing.
        closeOnBackdropClick={false}
        showClose={false}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Pill variant="ghost" disabled={busyId !== null} onClick={() => setDeletingItem(null)}>
              {words.keepIt}
            </Pill>
            <Pill
              variant="danger"
              disabled={busyId !== null}
              onClick={() => {
                if (deletingItem !== null) void removeItem(deletingItem);
              }}
            >
              {words.delete}
            </Pill>
          </div>
        }
      >
        <p>
          An item that a reward contains cannot be deleted — take it out of the reward first. This
          one is not in any reward as far as this page knows, and the service checks again.
        </p>
      </Modal>

      <Modal
        open={deletingReward !== null}
        onOpenChange={(next) => {
          if (!next) setDeletingReward(null);
        }}
        title={
          deletingReward === null
            ? words.deleteRewardTitle
            : fillPlaceholders(words.deleteRewardNamed, { title: deletingReward.title })
        }
        description={words.cannotBeUndone}
        closeOnBackdropClick={false}
        showClose={false}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Pill
              variant="ghost"
              disabled={busyId !== null}
              onClick={() => setDeletingReward(null)}
            >
              {words.keepIt}
            </Pill>
            <Pill
              variant="danger"
              disabled={busyId !== null}
              onClick={() => {
                if (deletingReward !== null) void removeReward(deletingReward);
              }}
            >
              {words.delete}
            </Pill>
          </div>
        }
      >
        <p>
          Once somebody has backed a reward it can no longer be deleted, only hidden — so deleting
          is offered while nobody has.
        </p>
      </Modal>
    </EditorShell>
  );
}

/* -------------------------------------------------------------------------
 * One tier in the list
 * ---------------------------------------------------------------------- */

function RewardCard({
  words,
  reward,
  items,
  position,
  total,
  busy,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDuplicate,
  onHide,
  onShow,
  onDelete,
}: {
  words: RewardsPanelCopy;
  reward: Reward;
  items: readonly Item[];
  position: number;
  total: number;
  busy: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onHide: () => void;
  onShow: () => void;
  onDelete: () => void;
}) {
  const hidden = isHiddenReward(reward);
  const scheduled = isScheduledReward(reward);
  const backed = reward.claimedQuantity > 0;
  const blocked = showBlockedReason(reward, words.vocabulary);

  return (
    <li className="rounded-lg border border-white/8 bg-surface-2 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[17px] font-medium tracking-[-0.02em] text-white">
            {reward.title}
          </h3>
          <p className="mt-1 text-sm text-white/64">
            {/* Pre-formatted from the decimal string, never through a float.
                `tabular-nums` so a column of prices lines up by place value. */}
            <span className="tabular-nums">{formatMoney(reward.price)}</span>
            {' · '}
            {describeStock(reward, words.vocabulary)}
            {' · '}
            {shippingScopeLabel(reward.shippingType, words.vocabulary.scopes)}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/*
              Every state is a word. `--lime-500` would say "urgent" and none of
              these are; a colour on its own would say nothing at all to a
              screen reader or to a creator who cannot separate two hues
              (docs/ui-kit.md §9.2).
            */}
            {hidden && <Tag variant="warning">{words.hidden}</Tag>}
            {scheduled && <Tag>{words.opensLater}</Tag>}
            {reward.isFeatured && <Tag>{words.featured}</Tag>}
            {reward.isSecret && <Tag>{words.secret}</Tag>}
            {reward.isEarlyBird && <Tag>{words.earlyBird}</Tag>}
            {reward.isAddon && <Tag>{words.addOn}</Tag>}
            {reward.estimatedDelivery != null && reward.estimatedDelivery !== '' && (
              <Tag>Delivers {reward.estimatedDelivery}</Tag>
            )}
          </div>

          <p className="mt-2 text-[13px] text-white/40">{describeContents(reward, items, words)}</p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-1">
            {/*
              The keyboard and screen-reader route through reordering. Each name
              says which tier moves and where it is now, because "Move up" five
              times over is five identical controls.
            */}
            <IconButton
              icon={<ChevronUp />}
              label={fillPlaceholders(words.moveUpLabel, {
                title: reward.title,
                position: String(position),
                total: String(total),
              })}
              variant="ghost"
              size="sm"
              disabled={position === 1}
              data-reward-id={reward.id}
              data-reward-move="up"
              onClick={onMoveUp}
            />
            <IconButton
              icon={<ChevronDown />}
              label={fillPlaceholders(words.moveDownLabel, {
                title: reward.title,
                position: String(position),
                total: String(total),
              })}
              variant="ghost"
              size="sm"
              disabled={position === total}
              data-reward-id={reward.id}
              data-reward-move="down"
              onClick={onMoveDown}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Pill variant="ghost" size="sm" disabled={busy} aria-label={fillPlaceholders(words.editLabel, { title: reward.title })} onClick={onEdit}>
              {words.edit}
            </Pill>
            <Pill
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label={fillPlaceholders(words.duplicateLabel, { title: reward.title })}
              onClick={onDuplicate}
            >
              {words.duplicate}
            </Pill>

            {hidden ? (
              <Pill
                variant="ghost"
                size="sm"
                disabled={busy || blocked !== null}
                aria-label={fillPlaceholders(words.showLabel, { title: reward.title })}
                onClick={onShow}
              >
                {words.show}
              </Pill>
            ) : (
              <Pill
                variant="ghost"
                size="sm"
                disabled={busy}
                aria-label={fillPlaceholders(words.hideLabel, { title: reward.title })}
                onClick={onHide}
              >
                {words.hide}
              </Pill>
            )}

            {/*
              §5.3 without exception: a reward somebody has backed may only be
              hidden. The control is not offered rather than offered and
              refused, and the sentence below says why — a disabled button with
              no explanation is a dead end.
            */}
            {!backed && (
              <Pill
                variant="ghost"
                size="sm"
                disabled={busy}
                aria-label={fillPlaceholders(words.deleteLabel, { title: reward.title })}
                onClick={onDelete}
              >
                {words.delete}
              </Pill>
            )}
          </div>
        </div>
      </div>

      {backed && (
        <p className="mt-3 text-[13px] text-white/64">
          {reward.claimedQuantity} {reward.claimedQuantity === 1 ? 'backer has' : 'backers have'}{' '}
          chosen this reward, so it can be hidden but not deleted.
        </p>
      )}

      {hidden && blocked !== null && (
        <InlineAlert variant="warning" className="mt-3">
          {blocked}
        </InlineAlert>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------
 * Sentences
 * ---------------------------------------------------------------------- */

/**
 * What is in the tier, named rather than counted.
 *
 * "3 items" tells a creator scanning the list nothing they can check; the names
 * are what they are looking for. An item the campaign no longer has is called
 * that rather than skipped, because a silently shorter list is how a creator
 * fails to notice a composition that has lost a line.
 */
function describeContents(
  reward: Reward,
  items: readonly Item[],
  words: RewardsPanelCopy,
): string {
  if (reward.items.length === 0) return words.containsNothing;

  const listed = reward.items
    .map((line) => {
      const item = items.find((one) => one.id === line.itemId);
      const name = item?.name ?? words.missingItemInline;
      return line.quantity === 1
        ? name
        : fillPlaceholders(words.itemTimes, { name, quantity: String(line.quantity) });
    })
    .join(', ');

  return fillPlaceholders(words.contains, { items: listed });
}

/** The tiers an `ITEM_IN_USE` refusal named, as titles rather than identifiers. */
function namedTiers(
  failure: SaveFailure,
  rewards: readonly Reward[],
  words: RewardsPanelCopy,
): string {
  const ids = failure.meta?.rewardTierIds;
  if (!Array.isArray(ids)) return words.aRewardInCampaign;

  const titles = ids
    .filter((id): id is string => typeof id === 'string')
    .map((id) => rewards.find((reward) => reward.id === id)?.title ?? words.aReward);

  return titles.length === 0 ? words.aRewardInCampaign : titles.join(', ');
}

function tierCount(failure: SaveFailure): number {
  const ids = failure.meta?.rewardTierIds;
  return Array.isArray(ids) ? ids.length : 1;
}
