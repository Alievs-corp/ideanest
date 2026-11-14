import type { ReactElement } from 'react';
import type { GlyphNode, IconsaxGlyph } from '../icons/iconsax-types';

/**
 * The Iconsax mark in front of a home band's heading.
 *
 * <h2>It answers the pointer, it does not enter</h2>
 *
 * The heading row is the `group/heading`. At rest the glyph is Iconsax's line drawing; while the
 * row is hovered, or something in it has the keyboard focus, the line fades into the bulk
 * drawing (150ms, `opacity`) and the glyph makes its own small gesture (300ms, `transform`) —
 * the clock tilts, the trend line steps up, the plane leaves, the lamp swings, the tiles turn.
 * docs/motion-system.md §3.2's two hover durations, and nothing else moves.
 *
 * This is "hover is an answer, not an entry" (#341): it is not a second scroll-entry animation
 * beside `FadeUp`, it never plays on a touch screen (Tailwind's `hover:` needs a device that can
 * hover), and the gesture is behind `motion-safe:`. Under reduced motion the fill still changes —
 * that is a state, not motion.
 *
 * <h2>Lime as ink, while it answers</h2>
 *
 * Under the pointer the mark turns `--lime-ink` and its border takes the same at 40%. Lime is a
 * state, not decoration (docs/ui-kit.md §2): the hovered band is the current one, and the colour
 * leaves with the pointer, so at rest the page still spends its one lime element on urgency.
 * `--lime-ink` rather than `--lime-500` because on the light theme lime measures 1.1:1; the ink
 * darkens there and stays lime on dark — the same token `CampaignStory`'s links hover to.
 *
 * <h2>Decorative</h2>
 *
 * The heading beside it says what the band is, so the mark is hidden from assistive technology.
 * Server-rendered SVG: the page gains markup, not JavaScript.
 */

export type SectionGesture = 'tilt' | 'rise' | 'launch' | 'swing' | 'turn';

/** Each glyph's gesture, written out in full so Tailwind finds every class. */
const GESTURE: Readonly<Record<SectionGesture, string>> = {
  /** A stopwatch knocked to one side. */
  tilt: 'motion-safe:group-hover/heading:rotate-12 motion-safe:group-focus-within/heading:rotate-12',
  /** A trend line stepping up and to the right. */
  rise: 'motion-safe:group-hover/heading:-translate-y-0.5 motion-safe:group-hover/heading:translate-x-0.5 motion-safe:group-hover/heading:scale-110 motion-safe:group-focus-within/heading:-translate-y-0.5 motion-safe:group-focus-within/heading:translate-x-0.5 motion-safe:group-focus-within/heading:scale-110',
  /** A paper plane leaving. */
  launch: 'motion-safe:group-hover/heading:-translate-y-1 motion-safe:group-hover/heading:translate-x-1 motion-safe:group-focus-within/heading:-translate-y-1 motion-safe:group-focus-within/heading:translate-x-1',
  /** A lamp swinging on its cord — hung from the top. */
  swing: 'origin-top motion-safe:group-hover/heading:-rotate-12 motion-safe:group-focus-within/heading:-rotate-12',
  /** Four tiles turning a quarter. */
  turn: 'motion-safe:group-hover/heading:rotate-90 motion-safe:group-focus-within/heading:rotate-90',
};

const ELEMENTS = {
  path: 'path',
  circle: 'circle',
  rect: 'rect',
  g: 'g',
  line: 'line',
  ellipse: 'ellipse',
  polygon: 'polygon',
  polyline: 'polyline',
} as const;

function draw(nodes: readonly GlyphNode[], prefix: string): ReactElement[] {
  return nodes.map((node, index) => {
    const Element = ELEMENTS[node.el];
    const key = `${prefix}${index}`;
    return (
      <Element key={key} {...node.attrs}>
        {node.children === undefined ? undefined : draw(node.children, `${key}.`)}
      </Element>
    );
  });
}

function Drawing({ nodes, className }: { readonly nodes: readonly GlyphNode[]; readonly className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`col-start-1 row-start-1 size-6 ${className}`}>
      {draw(nodes, '')}
    </svg>
  );
}

export function SectionIcon({
  glyph,
  gesture,
}: {
  readonly glyph: IconsaxGlyph;
  readonly gesture: SectionGesture;
}) {
  return (
    <span
      aria-hidden="true"
      data-icon={glyph.name}
      className="grid size-10 shrink-0 place-items-center rounded-xl border border-fg/8 bg-surface-2 text-fg transition-colors duration-150 ease-in-out group-hover/heading:border-lime-ink/40 group-hover/heading:bg-surface-3 group-hover/heading:text-lime-ink group-focus-within/heading:border-lime-ink/40 group-focus-within/heading:bg-surface-3 group-focus-within/heading:text-lime-ink sm:size-11"
    >
      <span className={`grid transition-transform duration-300 ease-in-out ${GESTURE[gesture]}`}>
        <Drawing
          nodes={glyph.linear}
          className="transition-opacity duration-150 ease-in-out group-hover/heading:opacity-0 group-focus-within/heading:opacity-0"
        />
        <Drawing
          nodes={glyph.bulk}
          className="opacity-0 transition-opacity duration-150 ease-in-out group-hover/heading:opacity-100 group-focus-within/heading:opacity-100"
        />
      </span>
    </span>
  );
}
