import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { pluralise } from '@ideanest/messages/plurals';
import { formatMoney } from '@ideanest/money';
import type { SaveFailure } from '@ideanest/campaign-editor/autosave';
import type { Item, ProjectEdit, Reward } from '@ideanest/campaign-editor/contract';
import { rewardsPanelCopyFrom, type RewardsPanelCopy } from '@ideanest/campaign-editor/copy';
import {
  MAX_REWARD_TIERS,
  describeItemInUse,
  describeRewardContents,
  describeStock,
  hidePatch,
  isHiddenReward,
  isScheduledReward,
  shippingScopeLabel,
  showBlockedReason,
  showPatch,
} from '@ideanest/campaign-editor/rewards';
import {
  Body,
  Caption,
  CardTitle,
  EmptyState,
  Heading,
  InlineAlert,
  Meta,
  Pill,
  Skeleton,
  SkeletonGroup,
  Tag,
  announce,
} from '../../../components/ui';
import { queryKeys } from '../../../api/queries';
import { Glyphs } from '../../../icons';
import { useT } from '../../../lib/i18n';
import { colors, radius, spacing } from '../../../theme';
import { DeleteDialog } from '../delete-dialog';
import { useEditor } from '../editor-context';
import { useEditorChromeCopy, useEditorTranslators } from '../translator';
import { useDescribeFailure } from '../use-describe-failure';
import { ReorderButtons, useReorder, type Reorder } from '../use-reorder';
import { inOrder, upsert } from '../list-cache';
import {
  deleteItem,
  deleteReward,
  duplicateReward,
  patchReward,
  reorderRewards,
  useEditorItems,
  useEditorRewards,
} from './api';
import { ItemEditor } from './item-editor';
import { RewardEditor } from './reward-editor';

/**
 * The Rewards tab — the web's `RewardsPanel` and `ItemsSection` (#162): the campaign's items, and
 * the reward tiers composed from them, in the order backers see them.
 *
 * <h2>No autosave here</h2>
 *
 * Each item and tier is saved explicitly, in its `EditorModal` (`ItemEditor`, `RewardEditor`);
 * there is no `SaveStatus` for this tab. The actions that are not a form — reorder, duplicate,
 * hide, show, delete — commit on the press, because a press is already an instruction.
 *
 * <h2>Reorder</h2>
 *
 * Move up / move down on every card, and the same moves (plus delete, where deleting is allowed)
 * as accessibility actions on the card's summary, through `useReorder`: optimistic, one request in
 * the air with the latest full order queued behind it, `PATCH …/rewards/reorder`, "{title} moved to
 * position N of M" announced, focus back on the pressed button. A refusal shows the server's order
 * again, says why, and reads the list again.
 *
 * <h2>Hiding, and deleting only without backers</h2>
 *
 * Hide is `PATCH {availableUntil: now}` (and `availableFrom: null` when it was still to open);
 * Show is `PATCH {availableUntil: null}`, disabled — with the reason — for an early bird that has
 * no limit, which the service would refuse. Delete is offered only while `claimedQuantity` is 0;
 * after that the card says why it can be hidden but not deleted. `ITEM_IN_USE` names the tiers
 * still using an item; `REWARD_HAS_BACKERS` says to hide it instead.
 *
 * <h2>States</h2>
 *
 * The project loading (three 96pt blocks); the lists loading (items two 72pt, tiers three 112pt);
 * the lists failed, with "Try again"; offline with nothing cached; empty items and empty rewards;
 * the limit of 100; a card whose request is in the air (its controls rest). Offline the lists are
 * shown as last loaded (`projectEditLists`, persisted) and nothing can be changed. The frame draws
 * signed out, a failed project and the offline notice.
 *
 * <p>Motion: none. The list does not animate as it reorders.
 */
export function RewardsPanel() {
  const editor = useEditor();
  const { t, locale } = useEditorTranslators();
  const chrome = useEditorChromeCopy();
  const words = useMemo(
    () => rewardsPanelCopyFrom(t, locale, chrome.characterCount),
    [t, locale, chrome.characterCount],
  );

  if (editor.project === null) {
    return editor.load === 'loading' ? <ProjectLoading label={words.loadingLabel} /> : null;
  }
  return <Rewards project={editor.project} words={words} />;
}

const PROJECT_ROWS = [0, 1, 2];
const ITEM_ROWS = [0, 1];
const TIER_ROWS = [0, 1, 2];

function ProjectLoading({ label }: { readonly label: string }) {
  return (
    <View style={styles.page}>
      <SkeletonGroup label={label} testID="rewards-loading">
        <View style={styles.list}>
          {PROJECT_ROWS.map((row) => (
            <Skeleton key={row} height={96} radius="lg" />
          ))}
        </View>
      </SkeletonGroup>
    </View>
  );
}

interface EditorState<T> {
  readonly open: boolean;
  /** Bumped on every open, so the modal is mounted fresh and seeded once. */
  readonly session: number;
  readonly target: T | null;
}

function Rewards({ project, words }: { readonly project: ProjectEdit; readonly words: RewardsPanelCopy }) {
  const editor = useEditor();
  const chrome = useEditorChromeCopy();
  const t = useT('mobile.editor.rewards');
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const describe = useDescribeFailure();
  const { projectId, readOnly, online } = editor;

  const itemsQuery = useEditorItems(projectId);
  const rewardsQuery = useEditorRewards(projectId);
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const rewards = useMemo(() => rewardsQuery.data ?? [], [rewardsQuery.data]);
  const ready = itemsQuery.data !== undefined && rewardsQuery.data !== undefined;
  const failedQuery = [itemsQuery, rewardsQuery].find((query) => query.isError && query.data === undefined);

  const [itemEditor, setItemEditor] = useState<EditorState<Item>>({ open: false, session: 0, target: null });
  const [rewardEditor, setRewardEditor] = useState<EditorState<Reward>>({ open: false, session: 0, target: null });
  const [deletingItem, setDeletingItem] = useState<Item | null>(null);
  const [deletingReward, setDeletingReward] = useState<Reward | null>(null);
  /** The refusal of the last action outside a modal. */
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  /** The id a request is running against, so that card's controls rest. */
  const [busyId, setBusyId] = useState<string | null>(null);

  const setItems = useCallback(
    (next: (current: readonly Item[] | undefined) => readonly Item[]) =>
      queryClient.setQueryData<readonly Item[]>(queryKeys.editorItems(projectId), next),
    [queryClient, projectId],
  );
  const setRewards = useCallback(
    (next: (current: readonly Reward[] | undefined) => readonly Reward[]) =>
      queryClient.setQueryData<readonly Reward[]>(queryKeys.editorRewards(projectId), next),
    [queryClient, projectId],
  );

  const refetchRewards = rewardsQuery.refetch;
  const reorder = useReorder<Reward>({
    items: rewards,
    idOf: rewardId,
    send: (ids) => reorderRewards(projectId, ids),
    onRefused: (cause) => {
      setFailure(describe(cause));
      void refetchRewards();
    },
    onSaved: (ids) => setRewards((current) => inOrder(current, ids)),
    announcement: (reward, position, total) =>
      fillPlaceholders(words.movedAnnouncement, {
        title: reward.title,
        position: String(position),
        total: String(total),
      }),
    labels: { moveUp: words.moveUpLabel, moveDown: words.moveDownLabel, delete: words.delete },
    onDelete: (reward) => {
      if (!readOnly && reward.claimedQuantity === 0) setDeletingReward(reward);
    },
  });

  async function run(id: string, action: () => Promise<void>): Promise<void> {
    setBusyId(id);
    setFailure(null);
    try {
      await action();
    } catch (cause) {
      // A refused delete closes its dialog, so the reason (ITEM_IN_USE names the tiers) is read.
      setDeletingItem(null);
      setDeletingReward(null);
      setFailure(describe(cause));
    } finally {
      setBusyId(null);
    }
  }

  const duplicate = (reward: Reward) =>
    void run(reward.id, async () => {
      const copy = await duplicateReward(reward.id);
      setRewards((current) => [...(current ?? []), copy]);
      announce(
        fillPlaceholders(words.duplicatedAnnouncement, {
          title: reward.title,
          position: String(rewards.length + 1),
        }),
      );
    });

  const setVisibility = (reward: Reward, hidden: boolean) =>
    void run(reward.id, async () => {
      const saved = await patchReward(reward.id, hidden ? hidePatch(reward) : showPatch());
      setRewards((current) => upsert(current, saved));
      announce(fillPlaceholders(hidden ? words.hiddenAnnouncement : words.shownAnnouncement, { title: reward.title }));
    });

  const removeReward = (reward: Reward) =>
    void run(reward.id, async () => {
      await deleteReward(reward.id);
      setRewards((current) => (current ?? []).filter((one) => one.id !== reward.id));
      setDeletingReward(null);
      announce(fillPlaceholders(words.rewardDeletedAnnouncement, { title: reward.title }));
    });

  const removeItem = (item: Item) =>
    void run(item.id, async () => {
      await deleteItem(item.id);
      setItems((current) => (current ?? []).filter((one) => one.id !== item.id));
      setDeletingItem(null);
      announce(fillPlaceholders(words.itemDeletedAnnouncement, { name: item.name }));
    });

  const openItem = (target: Item | null) =>
    setItemEditor((current) => ({ open: true, session: current.session + 1, target }));
  const openReward = (target: Reward | null) =>
    setRewardEditor((current) => ({ open: true, session: current.session + 1, target }));

  const full = rewards.length >= MAX_REWARD_TIERS;
  const retry = () => {
    void itemsQuery.refetch();
    void refetchRewards();
  };

  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + spacing[8] }]}
        testID="rewards-panel"
      >
        <View style={styles.sections}>
          {failure === null ? null : (
            <InlineAlert
              variant="danger"
              title={words.failedTitle}
              description={failure.message}
              testID="rewards-failure"
              action={
                failure.code === 'ITEM_IN_USE' ? (
                  <Caption>{describeItemInUse(failure, rewards, words)}</Caption>
                ) : failure.code === 'REWARD_HAS_BACKERS' ? (
                  <Caption>{words.rewardHasBackers}</Caption>
                ) : undefined
              }
            />
          )}

          {failedQuery === undefined ? null : (
            <InlineAlert
              variant="danger"
              title={words.rewardsFailedTitle}
              description={describe(failedQuery.error).message}
              testID="rewards-list-failed"
              action={
                <Pill
                  label={chrome.tryAgain}
                  variant="ghost"
                  size="sm"
                  busy={itemsQuery.isFetching || rewardsQuery.isFetching}
                  disabled={!online}
                  onPress={retry}
                  testID="rewards-retry"
                />
              }
            />
          )}

          {!ready && failedQuery === undefined && !online ? (
            <InlineAlert variant="warning" description={t('nothingCached')} testID="rewards-nothing-cached" />
          ) : null}

          <View style={styles.section} testID="items-section">
            <SectionHead
              heading={words.items.itemsHeading}
              count={ready ? String(items.length) : null}
              add={words.items.add}
              disabled={readOnly || !ready}
              onAdd={() => openItem(null)}
              testID="items-add"
            />
            {!ready ? (
              failedQuery === undefined && online ? (
                <SkeletonGroup label={words.items.loadingLabel} testID="items-loading">
                  <View style={styles.list}>
                    {ITEM_ROWS.map((row) => (
                      <Skeleton key={row} height={72} radius="lg" />
                    ))}
                  </View>
                </SkeletonGroup>
              ) : null
            ) : items.length === 0 ? (
              <EmptyState
                title={words.items.emptyTitle}
                description={words.items.description}
                testID="items-empty"
                action={
                  <Pill
                    label={words.items.addFirst}
                    variant="ghost"
                    size="sm"
                    disabled={readOnly}
                    onPress={() => openItem(null)}
                    testID="items-add-first"
                  />
                }
              />
            ) : (
              <View style={styles.list}>
                {items.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    words={words}
                    busy={busyId === item.id}
                    readOnly={readOnly}
                    onEdit={() => openItem(item)}
                    onDelete={() => setDeletingItem(item)}
                  />
                ))}
              </View>
            )}
          </View>

          <View style={styles.section} testID="tiers-section">
            <SectionHead
              heading={words.rewardsHeading}
              count={
                ready
                  ? fillPlaceholders(words.countOf, { count: String(rewards.length), max: String(MAX_REWARD_TIERS) })
                  : null
              }
              add={words.add}
              disabled={readOnly || !ready || full}
              onAdd={() => openReward(null)}
              testID="tiers-add"
            />
            {full ? (
              <InlineAlert
                variant="warning"
                politeness="polite"
                title={words.atCapacityTitle}
                description={t('atCapacityBody', { max: String(MAX_REWARD_TIERS) })}
                testID="tiers-full"
              />
            ) : null}
            {!ready ? (
              failedQuery === undefined && online ? (
                <SkeletonGroup label={words.loadingLabel} testID="tiers-loading">
                  <View style={styles.list}>
                    {TIER_ROWS.map((row) => (
                      <Skeleton key={row} height={112} radius="lg" />
                    ))}
                  </View>
                </SkeletonGroup>
              ) : null
            ) : rewards.length === 0 ? (
              <EmptyState
                title={words.emptyTitle}
                description={words.description}
                testID="tiers-empty"
                action={
                  <Pill
                    label={words.addFirst}
                    variant="ghost"
                    size="sm"
                    disabled={readOnly}
                    onPress={() => openReward(null)}
                    testID="tiers-add-first"
                  />
                }
              />
            ) : (
              <View style={styles.list} accessibilityLabel={words.listLabel} accessibilityRole="list">
                {reorder.items.map((reward, index) => (
                  <RewardCard
                    key={reward.id}
                    reward={reward}
                    items={items}
                    words={words}
                    position={index + 1}
                    total={reorder.items.length}
                    reorder={reorder}
                    busy={busyId === reward.id}
                    readOnly={readOnly}
                    deliversOn={(date) => t('deliversOn', { date })}
                    onEdit={() => openReward(reward)}
                    onDuplicate={() => duplicate(reward)}
                    onHide={() => setVisibility(reward, true)}
                    onShow={() => setVisibility(reward, false)}
                    onDelete={() => setDeletingReward(reward)}
                  />
                ))}
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      <ItemEditor
        key={`item-${itemEditor.session}`}
        visible={itemEditor.open}
        projectId={projectId}
        item={itemEditor.target}
        copy={words}
        readOnly={readOnly}
        onClose={() => setItemEditor((current) => ({ ...current, open: false }))}
        onSaved={(saved) => setItems((current) => upsert(current, saved))}
      />

      <RewardEditor
        key={`reward-${rewardEditor.session}`}
        visible={rewardEditor.open}
        project={project}
        reward={rewardEditor.target}
        items={items}
        copy={words}
        readOnly={readOnly}
        onClose={() => setRewardEditor((current) => ({ ...current, open: false }))}
        onSaved={(saved) => setRewards((current) => upsert(current, saved))}
      />

      <DeleteDialog
        open={deletingItem !== null}
        title={
          deletingItem === null ? words.deleteItemTitle : fillPlaceholders(words.deleteItemNamed, { name: deletingItem.name })
        }
        description={`${words.cannotBeUndone}\n\n${t('deleteItemBody')}`}
        deleteLabel={words.delete}
        keepLabel={words.keepIt}
        deleting={deletingItem !== null && busyId === deletingItem.id}
        onDelete={() => {
          if (deletingItem !== null) removeItem(deletingItem);
        }}
        onKeep={() => setDeletingItem(null)}
        testID="item-delete"
      />

      <DeleteDialog
        open={deletingReward !== null}
        title={
          deletingReward === null
            ? words.deleteRewardTitle
            : fillPlaceholders(words.deleteRewardNamed, { title: deletingReward.title })
        }
        description={`${words.cannotBeUndone}\n\n${t('deleteRewardBody')}`}
        deleteLabel={words.delete}
        keepLabel={words.keepIt}
        deleting={deletingReward !== null && busyId === deletingReward.id}
        onDelete={() => {
          if (deletingReward !== null) removeReward(deletingReward);
        }}
        onKeep={() => setDeletingReward(null)}
        testID="reward-delete"
      />
    </>
  );
}

function rewardId(reward: Reward): string {
  return reward.id;
}

function SectionHead({
  heading,
  count,
  add,
  disabled,
  onAdd,
  testID,
}: {
  readonly heading: string;
  readonly count: string | null;
  readonly add: string;
  readonly disabled: boolean;
  readonly onAdd: () => void;
  readonly testID: string;
}) {
  return (
    <View style={styles.head}>
      <View style={styles.heading} accessible accessibilityRole="header">
        <Heading>{heading}</Heading>
        {count === null ? null : <Meta>{`(${count})`}</Meta>}
      </View>
      <Pill label={add} iconLeft={Glyphs.Add} variant="ghost" size="sm" disabled={disabled} onPress={onAdd} testID={testID} />
    </View>
  );
}

function ItemCard({
  item,
  words,
  busy,
  readOnly,
  onEdit,
  onDelete,
}: {
  readonly item: Item;
  readonly words: RewardsPanelCopy;
  readonly busy: boolean;
  readonly readOnly: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  const t = useT('mobile.editor.rewards');
  return (
    <View style={styles.card} testID={`item-${item.id}`}>
      <View style={styles.summary} accessible>
        <CardTitle>{item.name}</CardTitle>
        {item.description == null || item.description === '' ? null : <Body>{item.description}</Body>}
        {/* Words, not colours: a download or a parcel decides whether an address is asked for. */}
        <View style={styles.tags}>
          <Tag label={item.isDigital ? words.items.digital : words.items.physical} />
          {item.weightGrams == null ? null : <Tag label={t('weight', { grams: String(item.weightGrams) })} />}
          {item.sku == null || item.sku === '' ? null : <Tag label={item.sku} />}
        </View>
      </View>
      <View style={styles.actions}>
        <Pill
          label={words.items.edit}
          accessibilityLabel={fillPlaceholders(words.items.editNamed, { name: item.name })}
          variant="ghost"
          size="sm"
          disabled={busy || readOnly}
          onPress={onEdit}
          testID={`item-${item.id}-edit`}
        />
        <Pill
          label={words.items.delete}
          accessibilityLabel={fillPlaceholders(words.items.deleteNamed, { name: item.name })}
          variant="ghost"
          size="sm"
          disabled={busy || readOnly}
          onPress={onDelete}
          testID={`item-${item.id}-delete`}
        />
      </View>
    </View>
  );
}

function RewardCard({
  reward,
  items,
  words,
  position,
  total,
  reorder,
  busy,
  readOnly,
  deliversOn,
  onEdit,
  onDuplicate,
  onHide,
  onShow,
  onDelete,
}: {
  readonly reward: Reward;
  readonly items: readonly Item[];
  readonly words: RewardsPanelCopy;
  readonly position: number;
  readonly total: number;
  readonly reorder: Reorder<Reward>;
  readonly busy: boolean;
  readonly readOnly: boolean;
  readonly deliversOn: (date: string) => string;
  readonly onEdit: () => void;
  readonly onDuplicate: () => void;
  readonly onHide: () => void;
  readonly onShow: () => void;
  readonly onDelete: () => void;
}) {
  const hidden = isHiddenReward(reward);
  const scheduled = isScheduledReward(reward);
  const backed = reward.claimedQuantity > 0;
  const blocked = showBlockedReason(reward, words.vocabulary);
  const named = { title: reward.title, position: String(position), total: String(total) };
  const upLabel = fillPlaceholders(words.moveUpLabel, named);
  const downLabel = fillPlaceholders(words.moveDownLabel, named);
  const deleteLabel = fillPlaceholders(words.deleteLabel, { title: reward.title });

  // The hook's actions, named for this card; no delete once somebody has chosen it, none offline.
  const own = reorder.accessibilityFor(reward);
  const actions = readOnly
    ? []
    : own.accessibilityActions
        .filter((action) => action.name !== 'delete' || !backed)
        .map((action) => ({
          ...action,
          label: action.name === 'moveUp' ? upLabel : action.name === 'moveDown' ? downLabel : deleteLabel,
        }));
  const onAction = (event: AccessibilityActionEvent) => {
    if (readOnly || busy) return;
    if (event.nativeEvent.actionName === 'delete') onDelete();
    else own.onAccessibilityAction(event);
  };

  return (
    <View style={styles.card} testID={`reward-${reward.id}`}>
      <View style={styles.summary} accessible accessibilityActions={actions} onAccessibilityAction={onAction} testID={`reward-${reward.id}-summary`}>
        <CardTitle>{reward.title}</CardTitle>
        <Body>
          {[formatMoney(reward.price), describeStock(reward, words.vocabulary), shippingScopeLabel(reward.shippingType, words.vocabulary.scopes)].join(' · ')}
        </Body>
        <View style={styles.tags}>
          {hidden ? <Tag label={words.hidden} variant="warning" /> : null}
          {scheduled ? <Tag label={words.opensLater} /> : null}
          {reward.isFeatured ? <Tag label={words.featured} /> : null}
          {reward.isSecret ? <Tag label={words.secret} /> : null}
          {reward.isEarlyBird ? <Tag label={words.earlyBird} /> : null}
          {reward.isAddon ? <Tag label={words.addOn} /> : null}
          {reward.estimatedDelivery == null || reward.estimatedDelivery === '' ? null : (
            <Tag label={deliversOn(reward.estimatedDelivery)} />
          )}
        </View>
        <Caption>{describeRewardContents(reward, items, words)}</Caption>
      </View>

      <View style={styles.actions}>
        <ReorderButtons
          reorder={reorder}
          id={reward.id}
          upLabel={upLabel}
          downLabel={downLabel}
          disabled={readOnly}
          testID={`reward-${reward.id}-move`}
        />
        <Pill
          label={words.edit}
          accessibilityLabel={fillPlaceholders(words.editLabel, { title: reward.title })}
          variant="ghost"
          size="sm"
          disabled={busy || readOnly}
          onPress={onEdit}
          testID={`reward-${reward.id}-edit`}
        />
        <Pill
          label={words.duplicate}
          accessibilityLabel={fillPlaceholders(words.duplicateLabel, { title: reward.title })}
          variant="ghost"
          size="sm"
          disabled={busy || readOnly}
          onPress={onDuplicate}
          testID={`reward-${reward.id}-duplicate`}
        />
        {hidden ? (
          <Pill
            label={words.show}
            accessibilityLabel={fillPlaceholders(words.showLabel, { title: reward.title })}
            variant="ghost"
            size="sm"
            disabled={busy || readOnly || blocked !== null}
            onPress={onShow}
            testID={`reward-${reward.id}-show`}
          />
        ) : (
          <Pill
            label={words.hide}
            accessibilityLabel={fillPlaceholders(words.hideLabel, { title: reward.title })}
            variant="ghost"
            size="sm"
            disabled={busy || readOnly}
            onPress={onHide}
            testID={`reward-${reward.id}-hide`}
          />
        )}
        {/* §5.3: once chosen, a reward can only be hidden — the control is not offered at all. */}
        {backed ? null : (
          <Pill
            label={words.delete}
            accessibilityLabel={deleteLabel}
            variant="ghost"
            size="sm"
            disabled={busy || readOnly}
            onPress={onDelete}
            testID={`reward-${reward.id}-delete`}
          />
        )}
      </View>

      {backed ? (
        <Caption testID={`reward-${reward.id}-backed`}>
          {pluralise(words.locale, words.chosenBy, reward.claimedQuantity)}
        </Caption>
      ) : null}

      {hidden && blocked !== null ? (
        <InlineAlert variant="warning" politeness="off" description={blocked} testID={`reward-${reward.id}-blocked`} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.surface1 },
  page: { paddingHorizontal: spacing[5], paddingTop: spacing[4] },
  sections: { gap: spacing[8] },
  section: { gap: spacing[4] },
  list: { gap: spacing[3] },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3] },
  heading: { flexDirection: 'row', alignItems: 'baseline', gap: spacing[2], flexShrink: 1 },
  card: {
    gap: spacing[3],
    padding: spacing[5],
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
  },
  summary: { gap: spacing[2] },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[2] },
});
