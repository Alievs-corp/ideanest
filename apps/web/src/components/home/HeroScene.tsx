import type { CSSProperties } from 'react';

/**
 * The home page hero's scene — issue #337: people walking in from every side to an idea, which
 * grows with each of them.
 *
 * <h2>What it shows</h2>
 *
 * A round floor in perspective. Small pictogram people in the three category
 * accents walk in from eight directions, each leaving a trail that fades back to where they
 * started. At the centre each becomes a spark that rises into a glass orb; the orb grows a step
 * and pulses, and after the eighth it releases one wide wave and begins again.
 * The caption under it says the same thing in words, and it is the only part a screen reader
 * gets: the scene is `aria-hidden` decoration.
 *
 * <h2>How it stays cheap</h2>
 *
 * - **No script.** A Server Component and CSS 3D transforms. The keyframes are in
 *   `app/globals.css`, beside the WhatsApp launcher's, for the reason given there.
 * - **Compositor only.** `transform` and `opacity`, and every keyframe a literal: the lane's
 *   angle, colour and delay are static inline styles on the elements, never variables inside an
 *   animation, which would recalculate style on the main thread every frame. Limbs are boxes,
 *   not SVG children, whose transforms repaint rather than composite.
 * - **As few animations as the picture needs.** Measured under a 4× CPU slowdown, the cost was
 *   proportional to the number of running animations, so the first build's hundred became about
 *   sixty: legs walk and arms do not, the floor stands still rather than swaying under eight
 *   figures counter-rotating against it, and one ring pulses on every arrival instead of eight
 *   taking turns.
 * - **Nothing once it is off screen.** `content-visibility: auto` stops the browser rendering
 *   the scene when it is scrolled away.
 * - **Opacity on leaves only.** An opacity below one flattens a `preserve-3d` subtree, so every
 *   fade sits on an element with no 3D children.
 *
 * <h2>Reduced motion</h2>
 *
 * Every animation is behind `motion-safe:`, and the static styles are a composition of their
 * own: people standing at different distances around the orb, faint trails behind them.
 *
 * <h2>Size</h2>
 *
 * The scene is drawn at 600 × 540 and scaled as a whole, so the 3D geometry is the same at every
 * width. It is not drawn on a phone at all: there the hero's text fills the first screen, and the
 * campaigns below it are what a visitor came for.
 */

const CYCLE = 6.4;

type Accent = 'sun' | 'mint' | 'sky';

interface Lane {
  readonly angle: number;
  readonly accent: Accent;
  /** Where the person stands when nothing moves, in pixels from the centre. */
  readonly rest: number;
}

const LANES: readonly Lane[] = [
  { angle: 20, accent: 'sun', rest: 150 },
  { angle: 65, accent: 'mint', rest: 200 },
  { angle: 115, accent: 'sky', rest: 120 },
  { angle: 160, accent: 'sun', rest: 180 },
  { angle: 205, accent: 'mint', rest: 140 },
  { angle: 250, accent: 'sky', rest: 210 },
  { angle: 295, accent: 'sun', rest: 130 },
  { angle: 340, accent: 'mint', rest: 170 },
];

const COLOUR: Readonly<Record<Accent, string>> = {
  sun: 'var(--accent-sun)',
  mint: 'var(--accent-mint)',
  sky: 'var(--accent-sky)',
};

const FLOOR: CSSProperties = {
  backgroundImage: [
    'radial-gradient(circle, var(--border-strong) 0 6%, transparent 6.5%)',
    'repeating-radial-gradient(circle, transparent 0 46px, var(--border) 46px 47px)',
    'radial-gradient(circle, var(--surface-3) 0%, var(--surface-2) 45%, transparent 70%)',
  ].join(', '),
  maskImage: 'radial-gradient(circle, var(--black) 55%, transparent 71%)',
};

const HALO: CSSProperties = {
  backgroundImage:
    'radial-gradient(circle, color-mix(in srgb, var(--white-surface) 35%, transparent), color-mix(in srgb, var(--white-surface) 6%, transparent) 45%, transparent 70%)',
};

const CORE: CSSProperties = {
  backgroundImage:
    'radial-gradient(circle at 36% 30%, color-mix(in srgb, var(--white-surface) 95%, transparent), color-mix(in srgb, var(--white-surface) 55%, transparent) 35%, color-mix(in srgb, var(--white-surface) 12%, transparent) 70%)',
  boxShadow:
    '0 0 50px 10px color-mix(in srgb, var(--white-surface) 18%, transparent), inset 0 -10px 24px color-mix(in srgb, var(--white-surface) 15%, transparent)',
};

const SHADOW: CSSProperties = {
  backgroundImage: 'radial-gradient(color-mix(in srgb, var(--black) 70%, transparent), transparent 70%)',
};

/** The lane's place in the cycle: lane i is i × 0.8 s ahead, so one person arrives every 0.8 s. */
function delayOf(index: number): string {
  return `${-(index * CYCLE) / LANES.length}s`;
}

/** Faces the way the person walks: towards the centre, left or right on screen. */
function facesLeft(angle: number): boolean {
  return Math.cos((angle * Math.PI) / 180) > 0;
}

const FLOOR_PLANE =
  'absolute left-1/2 top-[62%] -ml-[260px] -mt-[260px] size-[520px] rounded-full [transform-style:preserve-3d] [transform:rotateX(62deg)]';

const LIMB = 'absolute origin-top rounded-full bg-current';

export function HeroScene({ caption }: { readonly caption: string }) {
  return (
    <figure className="m-0 hidden w-full flex-col items-center sm:flex">
      <div
        aria-hidden="true"
        className="relative h-[302px] w-full overflow-hidden [contain-intrinsic-size:auto_302px] [content-visibility:auto] sm:h-[432px] sm:[contain-intrinsic-size:auto_432px] xl:h-[540px] xl:[contain-intrinsic-size:auto_540px]"
        data-testid="hero-scene"
      >
        <div className="absolute top-0 left-1/2 h-[540px] w-[600px] origin-top -translate-x-1/2 scale-[0.56] sm:scale-[0.8] xl:scale-100">
          <div className="absolute inset-0 [perspective-origin:50%_62%] [perspective:900px]">
            <div className={FLOOR_PLANE} style={FLOOR} />
            <div className={FLOOR_PLANE}>
              {LANES.map((lane, index) => (
                <Walker key={lane.angle} lane={lane} delay={delayOf(index)} />
              ))}
            </div>
          </div>

          <div className="absolute top-[29%] left-1/2 -ml-px h-[33%] w-0.5 bg-linear-to-b from-white/50 to-transparent opacity-35" />

          {LANES.map((lane, index) => (
            <span
              key={lane.angle}
              className="absolute top-[62%] left-1/2 -mt-[5px] -ml-[5px] size-2.5 rounded-full bg-current opacity-0 shadow-[0_0_12px_3px_currentColor] motion-safe:animate-[hero-rise_6.4s_ease-in_infinite]"
              style={{ color: COLOUR[lane.accent], animationDelay: delayOf(index) }}
            />
          ))}

          <div className="absolute top-[29%] left-1/2 size-0">
            <span
              className="absolute -m-[130px] size-[260px] rounded-full opacity-70 motion-safe:animate-[hero-brighten_6.4s_linear_infinite]"
              style={HALO}
            />
            <span className="absolute -m-12 size-24 rounded-full border-[3px] border-white opacity-0 motion-safe:animate-[hero-bloom_6.4s_ease-out_infinite]" />
            <span className="absolute -m-12 size-24 rounded-full border-2 border-white/70 opacity-0 motion-safe:animate-[hero-pulse_0.8s_ease-out_infinite] [animation-delay:-0.2s]" />
            <span
              className="absolute -m-12 size-24 rounded-full border border-white/35 motion-safe:animate-[hero-grow_6.4s_ease-out_infinite]"
              style={CORE}
            />
          </div>
        </div>
      </div>

      <figcaption className="mt-2 max-w-[40ch] text-center text-[15px] text-white/64">{caption}</figcaption>
    </figure>
  );
}

/**
 * One person and their trail. The lane is rotated to the person's direction, the walker moves
 * along it, and the figure turns back to face the camera: `rotate(-angle)`, then
 * `rotateX(-62deg)` to stand up off the tilted floor.
 */
function Walker({ lane, delay }: { readonly lane: Lane; readonly delay: string }) {
  const colour = COLOUR[lane.accent];
  return (
    <div
      className="absolute top-1/2 left-1/2 [transform-style:preserve-3d]"
      style={{ transform: `rotate(${lane.angle}deg)`, color: colour }}
    >
      <span
        className="absolute -top-0.5 left-[44px] h-1 w-[206px] origin-right rounded-full opacity-30 motion-safe:animate-[hero-path_6.4s_linear_infinite]"
        style={{ backgroundImage: `linear-gradient(90deg, ${colour}, transparent)`, animationDelay: delay }}
      />
      <div
        className="absolute [transform-style:preserve-3d] motion-safe:animate-[hero-walk_6.4s_linear_infinite]"
        style={{ transform: `translateX(${lane.rest}px)`, animationDelay: delay }}
      >
        <span
          className="absolute -top-1.5 -left-[13px] h-3 w-[26px] rounded-full motion-safe:animate-[hero-fade_6.4s_linear_infinite]"
          style={{ ...SHADOW, animationDelay: delay }}
        />
        <div
          className="absolute bottom-0 -left-[15px] h-[58px] w-[30px] origin-bottom [transform-style:preserve-3d]"
          style={{ transform: `rotate(${-lane.angle}deg)` }}
        >
          <div className="size-full origin-bottom [transform:rotateX(-62deg)]">
            <div
              className="size-full motion-safe:animate-[hero-fade_6.4s_linear_infinite]"
              style={{ animationDelay: delay }}
            >
              <div className={`relative size-full ${facesLeft(lane.angle) ? '-scale-x-100' : ''}`}>
                <span className={`${LIMB} top-[15px] left-[13px] h-4 w-1 rotate-[20deg] opacity-70`} />
                <span className={`${LIMB} top-[32px] left-[13px] h-6 w-[4.5px] opacity-70 motion-safe:animate-[hero-swing_0.6s_ease-in-out_infinite_alternate]`} />
                <span className="absolute top-[13px] left-[11.5px] h-[22px] w-[7px] rounded-full bg-current" />
                <span className="absolute top-0 left-[9px] size-3 rounded-full bg-current" />
                <span className={`${LIMB} top-[32px] left-[13px] h-6 w-[4.5px] motion-safe:animate-[hero-swing_0.6s_ease-in-out_infinite_alternate-reverse]`} />
                <span className={`${LIMB} top-[15px] left-[13px] h-4 w-1 -rotate-[20deg]`} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
