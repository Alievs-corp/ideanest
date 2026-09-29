import { cva, type VariantProps } from 'class-variance-authority';
import {
  Children,
  isValidElement,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/cn';

const avatar = cva(
  ['shrink-0 rounded-full bg-surface-3 object-cover', 'ring-2 ring-[var(--surface-1)]'],
  {
    variants: {
      size: {
        xs: 'size-6 text-[10px]',
        sm: 'size-7 text-[11px]',
        md: 'size-10 text-sm',
        lg: 'size-14 text-lg',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

/**
 * The pixel side of each size token, docs/ui-kit.md §7.6.
 *
 * Written onto the element as `width` and `height` so the square is reserved
 * from the markup rather than only from the stylesheet. The classes above
 * already size it, but attributes are what a browser has before any CSS has
 * arrived, and an avatar row that reflows once the sheet lands is a layout
 * shift in the one place a reader is already scanning faces.
 */
const AVATAR_PX = { xs: 24, sm: 28, md: 40, lg: 56 } as const;

export interface AvatarProps
  extends Omit<ComponentPropsWithoutRef<'img'>, 'src' | 'alt' | 'width' | 'height'>,
    VariantProps<typeof avatar> {
  src?: string;
  /** Person's name. Used for alt text and the initials fallback. */
  name: string;
}

/** "Jane Doe" -> "JD" */
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}

export function Avatar({ src, name, size, className, ...props }: AvatarProps) {
  if (!src) {
    return (
      <span
        role="img"
        aria-label={name}
        className={cn(
          avatar({ size }),
          'grid place-items-center font-medium text-white/64',
          className,
        )}
      >
        {initials(name)}
      </span>
    );
  }

  const side = AVATAR_PX[size ?? 'md'];

  return (
    <img
      src={src}
      alt={name}
      width={side}
      height={side}
      loading="lazy"
      decoding="async"
      className={cn(avatar({ size }), className)}
      {...props}
    />
  );
}

/**
 * Overlapping avatar stack. See docs/ui-kit.md §7.6.
 * Spreads apart on hover so individual faces become distinguishable.
 *
 * THE SPREAD IS A `transform`, NOT A MARGIN — issue 166. Each face used to widen its
 * negative margin on hover, which laid the row out again on every frame and pushed
 * whatever sat beside the group along with it. Now the overlap is fixed layout and the
 * spread is drawn on top: the face at position `i` moves `i × 6px` to the right, which is
 * where the old `-10px` to `-4px` margin change left it. Nothing beside the group moves.
 *
 * Each face is wrapped so the group owns the transform rather than writing it onto a
 * consumer's element, and the wrapper carries its position as `--avatar-index` because
 * the distance is cumulative and CSS has no portable way to count siblings.
 */
export interface AvatarGroupProps extends ComponentPropsWithoutRef<'div'> {
  /** Render at most this many; the remainder collapses into "+N". */
  max?: number;
  total?: number;
}

/** One face's slot in the stack: overlapped at rest, spread by its position on hover. */
const SLOT = cn(
  'flex shrink-0',
  'transition-transform duration-200 ease-in-out motion-reduce:transition-none',
  'group-hover/avatars:translate-x-[calc(var(--avatar-index)*6px)]',
);

function slotStyle(index: number): CSSProperties {
  return { '--avatar-index': index } as CSSProperties;
}

export function AvatarGroup({ max, total, className, children, ...props }: AvatarGroupProps) {
  const items: ReactNode[] = Children.toArray(children);
  const visible = max ? items.slice(0, max) : items;
  const hidden = (total ?? items.length) - visible.length;

  return (
    <div className={cn('group/avatars flex items-center', className)} {...props}>
      {visible.map((child, index) => (
        <span
          key={isValidElement(child) && child.key !== null ? child.key : index}
          className={cn(SLOT, index > 0 && '-ml-2.5')}
          style={slotStyle(index)}
        >
          {child}
        </span>
      ))}
      {hidden > 0 && (
        <span
          className={cn(
            SLOT,
            visible.length > 0 && '-ml-2.5',
            'grid size-10 place-items-center rounded-full',
            'bg-surface-3 text-xs font-medium text-white/64 ring-2 ring-[var(--surface-1)]',
          )}
          style={slotStyle(visible.length)}
        >
          +{hidden}
        </span>
      )}
    </div>
  );
}
