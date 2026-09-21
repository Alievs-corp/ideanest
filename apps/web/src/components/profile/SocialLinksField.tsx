'use client';

import { Field, InlineAlert, Pill, Select, TextInput } from '@ideanest/ui';
import {
  MAX_SOCIAL_LINKS,
  SOCIAL_PLATFORMS,
  socialPlatformLabel,
  type ProfileSocialLink,
  type SocialPlatform,
} from '../../lib/profiles/api';
import type { ProfileLinksCopy } from '../../lib/i18n/profile-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

/**
 * §4.2's P-03 — the accounts somebody keeps elsewhere.
 *
 * <h2>Two rules, and the control enforces both by shape rather than by validation</h2>
 *
 * `ProfileEditing` refuses more than five links and refuses a platform that appears twice.
 * Both refusals arrive as a `400` naming `socialLinks`, and both are avoidable here without a
 * single validation branch:
 *
 *   - **the cap** — "Add a link" is disabled at five and a sentence beside it says how many
 *     are used out of how many. Not a colour: docs/ui-kit.md §9.2 forbids colour as the
 *     carrier of anything, and a greyed button with no sentence is the same defect wearing a
 *     different hat.
 *   - **one per platform** — a row's `<select>` offers the platforms **no other row is
 *     using**, so choosing a duplicate is not a mistake somebody can make. A new row opens on
 *     the first platform nobody has taken, which is also why no row is ever left with an
 *     unset platform for the service to refuse.
 *
 * The server still decides. Nothing above is a second copy of its rules — it is the set of
 * states this form can reach — and when a refusal arrives anyway (two tabs open on one
 * account, a platform this build has never heard of) it is rendered on this field like any
 * other, through `error`.
 *
 * <h2>The native `<select>`, which docs/ui-kit.md §7.13 calls a decision rather than a
 * shortcut</h2>
 *
 * Nine options, one choice, no search. A hand-built listbox would owe type-ahead, Home/End,
 * PageUp/PageDown, the announcement contract and the platform wheel picker on iOS and
 * Android, and §7.13's point is that it always gets one of them wrong.
 *
 * <h2>The address is not checked here</h2>
 *
 * `https://`, no whitespace, and a length between 12 and 512 are `ProfileEditing`'s rules and
 * they stay there. `ProfileEditorPanel` carries the full argument for why this form does not
 * hold a second copy of them; the short version is that a refusal already lands on the
 * control it is about, so a client-side copy buys nothing and drifts.
 *
 * <h2>Motion: none</h2>
 *
 * A row appears and disappears outright. docs/motion-system.md §5 gives account settings
 * "none — 150ms colour on controls", and a row that eased into a form is a row somebody is
 * waiting on before they can type into it.
 */

export interface SocialLinksFieldProps {
  readonly links: readonly ProfileSocialLink[];
  readonly disabled?: boolean;
  /** The service's own refusal, when it named `socialLinks`. */
  readonly error?: string;
  readonly onChange: (links: readonly ProfileSocialLink[]) => void;
  /** Every word this field draws — #82. The nine platform names are not among them. */
  readonly copy: ProfileLinksCopy;
}

/** The platforms a row may offer: everything no *other* row has taken. */
function availableTo(
  links: readonly ProfileSocialLink[],
  index: number,
): readonly SocialPlatform[] {
  return SOCIAL_PLATFORMS.filter(
    (platform) => !links.some((link, other) => other !== index && link.platform === platform),
  );
}

/** The platform a new row opens on, or `undefined` when all nine are taken. */
function firstUnused(links: readonly ProfileSocialLink[]): SocialPlatform | undefined {
  return SOCIAL_PLATFORMS.find((platform) => !links.some((link) => link.platform === platform));
}

export function SocialLinksField({
  links,
  disabled = false,
  error,
  onChange,
  copy,
}: SocialLinksFieldProps) {
  const spare = firstUnused(links);
  const atCap = links.length >= MAX_SOCIAL_LINKS;
  const canAdd = !atCap && spare !== undefined;

  function replace(index: number, next: ProfileSocialLink): void {
    onChange(links.map((link, position) => (position === index ? next : link)));
  }

  return (
    <Field
      grouped
      label={copy.label}
      hint={fillPlaceholders(copy.hint, { max: String(MAX_SOCIAL_LINKS) })}
      error={error}
    >
      <div className="flex flex-col gap-3">
        {links.length === 0 && (
          <p className="text-sm text-white/40">{copy.none}</p>
        )}

        {/*
          Keyed by position rather than by platform. The platform is unique at any instant and
          would make a stabler key in a list that only ever gained and lost rows — but it is
          also the thing a `<select>` on the row changes, and a key that changes remounts the
          row and takes the focus out of the control somebody is still using. Every input here
          is controlled, so a position key holds the right value after a removal.
        */}
        {links.map((link, index) => {
          const label = socialPlatformLabel(link.platform);
          const options = availableTo(links, index);

          return (
            <div key={index} className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <Select
                value={link.platform}
                disabled={disabled}
                aria-label={fillPlaceholders(copy.platformFor, { number: String(index + 1) })}
                className="sm:w-44"
                onChange={(event) => replace(index, { ...link, platform: event.target.value })}
              >
                {/*
                  The row's own platform is always in its list, even in the impossible case
                  where the service sent two rows with one platform: an option list that
                  omitted the selected value would silently reselect the first option and
                  rewrite a link nobody touched.
                */}
                {(options.includes(link.platform as SocialPlatform)
                  ? options
                  : [link.platform as SocialPlatform, ...options]
                ).map((platform) => (
                  <option key={platform} value={platform}>
                    {socialPlatformLabel(platform)}
                  </option>
                ))}
              </Select>

              <TextInput
                type="url"
                inputMode="url"
                value={link.url}
                disabled={disabled}
                aria-label={fillPlaceholders(copy.addressFor, { platform: label })}
                placeholder={copy.addressPlaceholder}
                className="sm:flex-1"
                onChange={(event) => replace(index, { ...link, url: event.target.value })}
              />

              <Pill
                type="button"
                variant="ghost"
                disabled={disabled}
                /*
                  "Remove" alone would be nine identical buttons to anybody reading the form
                  out of context. The visible word is inside the accessible name rather than
                  replaced by it, so speech control still reaches the button by what it says.
                */
                aria-label={fillPlaceholders(copy.removeLink, { platform: label })}
                onClick={() => onChange(links.filter((_, position) => position !== index))}
              >
                {copy.remove}
              </Pill>
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-3">
          <Pill
            type="button"
            variant="ghost"
            disabled={disabled || !canAdd}
            onClick={() => {
              if (spare === undefined) return;
              onChange([...links, { platform: spare, url: '' }]);
            }}
          >
            {copy.add}
          </Pill>

          {/*
            The count is a sentence and it is always present, so the cap is a thing somebody
            reads before they meet it rather than a button that stops working. §7.13 makes the
            same argument about `CharacterCount`: the wording carries it, never the colour.
          */}
          <p className="text-sm text-white/40">
            {atCap
              ? fillPlaceholders(copy.atCap, { max: String(MAX_SOCIAL_LINKS) })
              : fillPlaceholders(copy.used, {
                  used: String(links.length),
                  max: String(MAX_SOCIAL_LINKS),
                })}
          </p>
        </div>

        {/*
          Nine platforms and five slots, so this is unreachable today. It is written anyway
          because "at most five" and "nine platforms" are two numbers in two files, and the
          day somebody raises the cap this is the difference between a clear sentence and a
          button that is disabled for no visible reason.
        */}
        {!atCap && spare === undefined && (
          <InlineAlert variant="info" title={copy.allListedTitle}>{copy.allListedBody}</InlineAlert>
        )}
      </div>
    </Field>
  );
}
