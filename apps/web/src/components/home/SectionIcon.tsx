import type { ReactElement } from 'react';
import type { GlyphNode, IconsaxGlyph } from '../icons/iconsax-types';

/**
 * The Iconsax mark in front of a home band's heading.
 *
 * <h2>It answers the pointer, it does not enter</h2>
 *
 * The heading row is the `group/heading`. At rest the glyph is Iconsax's line drawing; while the
 * row is hovered, or something in it has the keyboard focus, the line fades into the filled
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
 * Under the pointer the mark turns `--lime-ink`. It stands bare, with no tile behind it. On the
 * dark theme it fills with the solid `bold` drawing, so it is the logo's lime undimmed — `bulk`'s
 * 40% second layer reads as olive on black; on the light theme it keeps `bulk`. Lime is a
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
    <svg viewBox="0 0 24 24" fill="none" className={`col-start-1 row-start-1 size-full ${className}`}>
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
      className="grid size-7 shrink-0 place-items-center text-fg transition-colors duration-150 ease-in-out group-hover/heading:text-lime-ink group-focus-within/heading:text-lime-ink sm:size-8"
    >
      <span className={`grid size-full transition-transform duration-300 ease-in-out ${GESTURE[gesture]}`}>
        <Drawing
          nodes={glyph.linear}
          className="transition-opacity duration-150 ease-in-out group-hover/heading:opacity-0 group-focus-within/heading:opacity-0"
        />
        {/* Dark: the solid drawing, one lime from edge to edge — the logo's colour, undimmed. */}
        <Drawing
          nodes={glyph.bold}
          className="opacity-0 transition-opacity duration-150 ease-in-out group-hover/heading:opacity-100 group-focus-within/heading:opacity-100 [[data-theme=light]_&]:hidden"
        />
        {/* Light: the two-tone drawing, its second layer the darkened ink at 40%. */}
        <Drawing
          nodes={glyph.bulk}
          className="hidden opacity-0 transition-opacity duration-150 ease-in-out group-hover/heading:opacity-100 group-focus-within/heading:opacity-100 [[data-theme=light]_&]:block"
        />
      </span>
    </span>
  );
}
