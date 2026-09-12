'use client';

import { Plus } from 'lucide-react';
import { EmptyState, Pill, Skeleton, SkeletonGroup, Tag } from '@ideanest/ui';
import type { Item } from '../../lib/projects/api';

/**
 * The campaign's items: the atomic things it produces.
 *
 * FIRST ON THE PAGE, because that is the order §4.6 builds a campaign in — a
 * tier is a selection of items with quantities, so there is nothing to compose
 * until these exist. A creator who meets the reward form first meets an empty
 * item list inside it and has to leave to fix that.
 *
 * The list is presentational: every action is the panel's, because deleting an
 * item can be refused for a reason that is about the REWARDS (`ITEM_IN_USE`),
 * and only the panel holds those.
 *
 * MOTION: none. Creators spend hours here (docs/motion-system.md §5).
 */
import type { ItemsSectionCopy } from '../../lib/i18n/campaign-editor-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

export interface ItemsSectionProps {
  /** This list's words. */
  copy: ItemsSectionCopy;
  items: readonly Item[];
  loading: boolean;
  onAdd: () => void;
  onEdit: (item: Item) => void;
  onDelete: (item: Item) => void;
  /** The item a request is currently running against, so its controls rest. */
  busyId: string | null;
}

export function ItemsSection({
  copy,
  items,
  loading,
  onAdd,
  onEdit,
  onDelete,
  busyId,
}: ItemsSectionProps) {
  return (
    <section aria-labelledby="items-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="items-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.itemsHeading}{' '}
          {/* The count is tertiary at 12px: present, never competing with the
              title (docs/ui-kit.md §7.12). */}
          <span className="text-xs font-normal text-white/40">({items.length})</span>
        </h2>

        <Pill
          variant="ghost"
          size="sm"
          iconLeft={<Plus aria-hidden="true" className="size-4" />}
          onClick={onAdd}
        >
          {copy.add}
        </Pill>
      </div>

      {loading ? (
        <SkeletonGroup label={copy.loadingLabel}>
          <div className="flex flex-col gap-2">
            {[0, 1].map((row) => (
              <Skeleton key={row} height="4.5rem" />
            ))}
          </div>
        </SkeletonGroup>
      ) : items.length === 0 ? (
        <EmptyState
          headingLevel={3}
          title={copy.emptyTitle}
          description={copy.description}
          action={
            <Pill variant="ghost" size="sm" onClick={onAdd}>
              {copy.addFirst}
            </Pill>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-white/8 bg-surface-2 p-4"
            >
              <div className="min-w-0">
                <h3 className="text-[15px] font-medium text-white">{item.name}</h3>
                {item.description != null && item.description !== '' && (
                  <p className="mt-0.5 text-[13px] text-white/64">{item.description}</p>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {/*
                    Words, not colours. Whether an item is a download or a
                    parcel decides whether a backer is asked for an address,
                    and it must not depend on telling two greys apart
                    (docs/ui-kit.md §9.2).
                  */}
                  <Tag>{item.isDigital ? copy.digital : copy.physical}</Tag>
                  {item.weightGrams != null && <Tag>{item.weightGrams} g</Tag>}
                  {item.sku != null && item.sku !== '' && <Tag>{item.sku}</Tag>}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Pill
                  variant="ghost"
                  size="sm"
                  disabled={busyId === item.id}
                  aria-label={fillPlaceholders(copy.editNamed, { name: item.name })}
                  onClick={() => onEdit(item)}
                >
                  {copy.edit}
                </Pill>
                <Pill
                  variant="ghost"
                  size="sm"
                  disabled={busyId === item.id}
                  aria-label={fillPlaceholders(copy.deleteNamed, { name: item.name })}
                  onClick={() => onDelete(item)}
                >
                  {copy.delete}
                </Pill>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
