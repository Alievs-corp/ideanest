import type { ReactElement } from 'react';
import { colors, radius, spacing } from '@ideanest/design-tokens';
import { SITE_NAME, truncateAtWord } from './metadata';

/**
 * The social preview card, drawn rather than photographed.
 *
 * This is what `opengraph-image.tsx` renders through Next's `ImageResponse`, which
 * is Satori: a subset of CSS laid out with Yoga and rasterised to a PNG. It is not
 * a browser, so nothing here may reach for Tailwind, a custom property, or a
 * cascade — Satori resolves neither. **The colours therefore come from the
 * JavaScript form of the token file** (`@ideanest/design-tokens`), which exists for
 * exactly this case: "React Native and canvas/chart code, both of which need
 * literal values". A hex literal in this file would be a member of the palette
 * nobody agreed to (docs/ui-kit.md §10.1, CLAUDE.md §2).
 *
 * <h2>The cover photograph is deliberately not drawn onto it</h2>
 *
 * When a campaign has a cover image, `projectPageMetadata` names that image as the
 * preview and this card is never used — the creator's own photograph beats our
 * typography every time. This card is what a campaign with no cover gets, and it
 * does not try to embed one anyway: Satori decodes PNG, JPEG, and SVG, while
 * docs/architecture.md §13.1 serves AVIF first and WebP second, so an embedded
 * cover would be a broken image on most campaigns and a rasterisation failure —
 * mid-stream, after the response headers have gone out — on the rest.
 *
 * <h2>One weight, and why the kit's display weight is missing</h2>
 *
 * `ImageResponse` ships one bundled face at one weight. docs/ui-kit.md §5.3 asks
 * for 600 on a display figure, and asking Satori for a weight it does not have
 * gets a synthesised approximation that looks worse than the honest regular. The
 * hierarchy here is therefore carried by size, colour, and space — all three from
 * the kit — and the day General Sans and Inter are in the repository as files
 * (they are not; §5.1 is a recommendation), this file gains a `fonts` option and
 * the weights the kit actually specifies.
 */

/** 1200×630 — the 1.91:1 both Open Graph and a large X card crop to. */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

export const OG_IMAGE_CONTENT_TYPE = 'image/png';

/**
 * `og:image:alt` for the site card.
 *
 * A social image is a picture of text, so without this a screen reader announces
 * an unnamed image (CLAUDE.md §2 — an icon-only control needs an accessible name,
 * and this is the same rule).
 */
export const OG_SITE_ALT = `${SITE_NAME} — reward-based crowdfunding, where a campaign succeeds at 80% of its goal`;

/**
 * `og:image:alt` for a campaign card, and it names no campaign.
 *
 * A metadata image file may only export a STATIC `alt`; Next has no per-request
 * form of it. That is a constraint rather than a choice, and it happens to be the
 * safe one: an `alt` computed from a campaign would be the last place a
 * non-public title could still escape, since the guards that stop the picture
 * being drawn would not have stopped the sentence describing it.
 */
export const OG_PROJECT_ALT = `A crowdfunding campaign on ${SITE_NAME}`;

/** Roughly three lines at the title size. Beyond that the card overflows. */
export const PROJECT_CARD_TITLE_MAX_LENGTH = 90;

/** Two lines under it. */
const PROJECT_CARD_BLURB_MAX_LENGTH = 120;

const TITLE_FONT_SIZE = 64;
const BLURB_FONT_SIZE = 30;
const LABEL_FONT_SIZE = 24;

/** docs/ui-kit.md §5.3 — tracking tightens as size grows. */
function tracking(fontSize: number, em: number): number {
  return fontSize * em;
}

/** The lime pill of docs/ui-kit.md §7.2: a lime SURFACE with near-black text. */
function brandMark(): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        backgroundColor: colors.lime500,
        color: colors.textOnLime,
        borderRadius: radius.full,
        // Satori's shorthand support is narrower than a browser's; the four sides
        // are named rather than packed into one string.
        paddingTop: spacing[3],
        paddingBottom: spacing[3],
        paddingLeft: spacing[6],
        paddingRight: spacing[6],
        fontSize: LABEL_FONT_SIZE,
        letterSpacing: tracking(LABEL_FONT_SIZE, -0.01),
      }}
    >
      {SITE_NAME}
    </div>
  );
}

function frame(children: readonly ReactElement[]): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        backgroundColor: colors.surface1,
        padding: spacing[16],
      }}
    >
      {children}
    </div>
  );
}

/**
 * The card for the site itself, and the card a campaign falls back to.
 *
 * IT NAMES NO CAMPAIGN, which is what makes it a safe fallback: it is what the
 * campaign image route renders when it could not confirm the campaign is public,
 * and a fallback that guessed at a title would defeat the check that chose it.
 */
export function siteSocialCard(): ReactElement {
  return frame([
    <div key="mark" style={{ display: 'flex' }}>
      {brandMark()}
    </div>,
    <div key="copy" style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          color: colors.textPrimary,
          fontSize: TITLE_FONT_SIZE,
          lineHeight: 1.05,
          letterSpacing: tracking(TITLE_FONT_SIZE, -0.035),
        }}
      >
        Back the ideas that need you
      </div>
      <div
        style={{
          marginTop: spacing[5],
          color: colors.textSecondary,
          fontSize: BLURB_FONT_SIZE,
          lineHeight: 1.5,
          letterSpacing: tracking(BLURB_FONT_SIZE, -0.01),
        }}
      >
        Reward-based crowdfunding. Nobody is charged unless a project reaches its goal.
      </div>
    </div>,
  ]);
}

/**
 * The card for one campaign: its title, its own summary, and nothing invented.
 *
 * NO FIGURES. Not the amount raised, not the days left, not the backer count. A
 * social card is cached by every unfurler that renders it and by every timeline it
 * appears in, so a number here is a number that will be wrong — and "3 days left"
 * on a campaign that closed a month ago is worse than no number at all.
 */
export function projectSocialCard(project: {
  readonly title: string;
  readonly blurb: string | null;
}): ReactElement {
  const title = truncateAtWord(project.title, PROJECT_CARD_TITLE_MAX_LENGTH);
  const blurb = truncateAtWord(project.blurb ?? '', PROJECT_CARD_BLURB_MAX_LENGTH);

  return frame([
    <div key="mark" style={{ display: 'flex' }}>
      {brandMark()}
    </div>,
    <div key="copy" style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          color: colors.textPrimary,
          fontSize: TITLE_FONT_SIZE,
          lineHeight: 1.05,
          letterSpacing: tracking(TITLE_FONT_SIZE, -0.035),
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: spacing[5],
          color: colors.textSecondary,
          fontSize: BLURB_FONT_SIZE,
          lineHeight: 1.5,
          letterSpacing: tracking(BLURB_FONT_SIZE, -0.01),
        }}
      >
        {blurb === '' ? 'A crowdfunding campaign that succeeds at 80% of its goal.' : blurb}
      </div>
    </div>,
  ]);
}
