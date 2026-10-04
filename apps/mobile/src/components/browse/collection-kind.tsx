import { Glyphs } from '../../icons';
import { isCollectionKind, type CollectionKind } from '@ideanest/discovery/collections';
import { useT } from '../../lib/i18n';
import { Tag, type IconComponent } from '../ui';

/**
 * A collection's kind, as a word with an icon — the web's `KIND_ICONS` and `copy.kinds` (#154).
 *
 * docs/ui-kit.md §9.2: colour alone never carries meaning, so the three kinds are three labels
 * with three icons on the same default tag surface. An open call is not `--warning` and a staff
 * selection is not lime: lime says "act now" and a curated list is not that.
 *
 * A kind this build does not know has no tag — not the raw `festival`, not a guess.
 */
const KIND_ICONS: Readonly<Record<CollectionKind, IconComponent>> = {
  staff_selection: Glyphs.MagicStar,
  themed: Glyphs.Tag,
  open_call: Glyphs.Calendar,
};

/** The kind's label in the reader's language, or `null` for a kind this build does not know. */
export function useKindLabel(kind: string): string | null {
  const t = useT('discovery.collections');
  return isCollectionKind(kind) ? t(`kinds.${kind}`) : null;
}

/** The kind tag, or nothing for an unknown kind. */
export function KindTag({ kind }: { readonly kind: string }) {
  const label = useKindLabel(kind);
  if (label === null || !isCollectionKind(kind)) return null;
  return <Tag label={label} icon={KIND_ICONS[kind]} testID="collection-kind" />;
}
