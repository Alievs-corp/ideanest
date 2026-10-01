import { socialPlatformLabel, type PublicProfile } from '../../lib/profiles/api';
import { dateTimeFormat } from '../../lib/i18n/formats';
import type { Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { ProfileAboutCopy } from '../../lib/i18n/profile-copy';

/**
 * §4.2's P-06 — the About tab.
 *
 * <h2>What it holds, and it says so when it holds one of them</h2>
 *
 * The biography, where somebody is, their site, the accounts they keep elsewhere, and the
 * month the account was created. Most accounts have written no biography, so the empty branch
 * is the common case rather than the edge — and it is a sentence rather than a blank panel,
 * because a tab that opens onto nothing reads as a tab that failed to load. `bio` arrives as
 * `null` rather than absent when there is none, so the empty state is an answer this
 * component has received rather than one it is waiting for.
 *
 * <h2>The location is here rather than in the header, and the header's own comment is why</h2>
 *
 * `ProfileHeader` states that it "carries the identity and nothing else" — a picture, a name,
 * a handle — and pushes the biography down here on the grounds that a header repeating it
 * would make this tab a duplicate of the top of the page. A city is the same kind of fact as
 * the biography and the joined month, and it belongs in the same list as them.
 *
 * **It is text and not a link, which is a fact about the platform rather than a design.**
 * `location.slug` is V16's shared vocabulary and §4.2 records that it is the vocabulary
 * `/discover?city=` reads — but `?city=` is one of the four options the discovery service
 * declares and refuses, answering `DISCOVERY_OPTION_UNSUPPORTED` and naming #47.
 * `@ideanest/discovery/vocabulary` lists it among the gaps for exactly this reason: a control
 * that cannot work is a promise the interface breaks the first time somebody uses it. When
 * #47 lands, this becomes a link and nothing else about it changes.
 *
 * <h2>EVERY OUTBOUND LINK ON THIS PANEL CARRIES `rel="nofollow ugc noopener noreferrer"`</h2>
 *
 * The website and every social address are strings a stranger typed into a form, published on
 * a page search engines index. `PublicProfileResponse`'s Javadoc states the contract and gives
 * a different reason for each of the three tokens, and none of them is optional here:
 *
 *   - **`nofollow ugc`** — a profile link is the cheapest backlink a spammer can get anywhere
 *     on this platform. Without it the profile editor is an SEO product being given away.
 *   - **`noopener`** — a link opened in a new tab hands the destination a `window.opener`
 *     reference to this page, which is enough to navigate it elsewhere. A convincing sign-in
 *     page is one line of JavaScript away.
 *   - **`noreferrer`** — which profile somebody was reading is nobody's business but theirs,
 *     and a `Referer` header tells every site they click through to exactly that.
 *
 * The service refuses anything that is not `https://`, which closes `javascript:` and `data:`
 * outright. It closes nothing else, which is the whole reason these four tokens exist.
 *
 * <h2>The address is shown, never hidden behind a word</h2>
 *
 * A link whose visible text conceals where it goes is the shape of every phishing link ever
 * written, and this is a page where the destination was chosen by somebody the reader has no
 * reason to trust yet. So the platform's name is the label and the address is printed beside
 * it, and the website's row is the address itself.
 *
 * <h2>The biography is text, never markup</h2>
 *
 * It is rendered as a string into a `<p>` with `whitespace-pre-line`, so the paragraph breaks
 * somebody typed survive and nothing they typed becomes an element. §4.2's P-03 is the answer
 * to what that costs — somebody who wants a link on their profile is given five fields for
 * them, each one checked and each one rendered with the `rel` above, rather than a biography
 * that parses.
 */

/**
 * "March 2025", or nothing at all.
 *
 * Nothing for an instant that will not parse **and nothing for an absent one** — #323. The
 * projection always sends `joinedAt`, and until the profile body was narrowed rather than cast
 * this function was handed whatever arrived: `new Date(null)` is 1 January 1970, which would
 * have printed "January 1970" under a stranger's name as confidently as a real date.
 */
function joinedMonth(iso: string | null, locale: Locale): string | null {
  if (iso === null) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return dateTimeFormat(locale, { month: 'long', year: 'numeric' }, 'joined-month').format(at);
}

/**
 * The four tokens every user-supplied outbound link on this page carries.
 *
 * One constant rather than four string literals, so that a link added later cannot be given
 * three of them. The order is the contract's own.
 */
const USER_LINK_REL = 'nofollow ugc noopener noreferrer';

const LINK_CLASS =
  'rounded-sm text-white underline underline-offset-4 hover:text-white/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]';

export interface ProfileAboutProps {
  readonly profile: PublicProfile;
  /**
   * The language the page is being rendered in — #324.
   *
   * A prop rather than `getLocale()` inside the component: this is a synchronous server
   * component and its test renders it outside a request, where next-intl's request store does
   * not exist. The route resolves the locale once and hands it down, which is how every other
   * piece of localised data reaches this subtree.
   */
  readonly locale: Locale;
  /** The section's words, resolved by the route — see `lib/i18n/profile-copy.ts`. */
  readonly copy: ProfileAboutCopy;
}

export function ProfileAbout({ profile, locale, copy }: ProfileAboutProps) {
  const joined = joinedMonth(profile.joinedAt, locale);
  const bio = profile.bio === null ? '' : profile.bio.trim();
  /*
   * The service sends an empty array rather than a null, and this still tolerates a missing
   * key: the page is server-rendered from an untyped `fetch` (`lib/profiles/server.ts` says
   * why), so a response from a service older than #276 would otherwise take the whole profile
   * down over an absent list. An empty list renders as nothing, which is the truth either way.
   */
  const socialLinks = profile.socialLinks ?? [];
  const hasFacts = profile.location !== null || profile.websiteUrl !== null || joined !== null;

  return (
    <section className="rounded-2xl border border-white/8 bg-surface-2 p-6 sm:p-8">
      <h2 className="text-lg font-medium tracking-[-0.02em] text-white">
        {fillPlaceholders(copy.heading, { name: profile.name })}
      </h2>

      {bio === '' ? (
        <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-white/64">
          {fillPlaceholders(copy.empty, { name: profile.name })}
        </p>
      ) : (
        <p className="mt-3 max-w-[62ch] whitespace-pre-line text-[15px] leading-relaxed text-white/64">
          {bio}
        </p>
      )}

      {hasFacts && (
        <dl className="mt-6 flex flex-col gap-3 border-t border-white/6 pt-6 text-sm">
          {profile.location !== null && (
            <div className="flex flex-wrap gap-x-3">
              <dt className="text-white/40">{copy.basedIn}</dt>
              <dd className="text-white/64">{profile.location.name}</dd>
            </div>
          )}

          {profile.websiteUrl !== null && (
            <div className="flex min-w-0 flex-wrap gap-x-3">
              <dt className="text-white/40">{copy.website}</dt>
              <dd className="min-w-0 break-all">
                <a
                  href={profile.websiteUrl}
                  rel={USER_LINK_REL}
                  target="_blank"
                  className={LINK_CLASS}
                >
                  {profile.websiteUrl}
                </a>
              </dd>
            </div>
          )}

          {joined !== null && (
            <div className="flex flex-wrap gap-x-3">
              <dt className="text-white/40">{copy.since}</dt>
              <dd className="text-white/64">{joined}</dd>
            </div>
          )}
        </dl>
      )}

      {socialLinks.length > 0 && (
        <div className="mt-6 border-t border-white/6 pt-6">
          <h3 className="text-sm font-medium text-white/64">{copy.elsewhere}</h3>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {socialLinks.map((link) => (
              /*
                Keyed by platform, which the service guarantees is unique per account —
                `ProfileEditing` refuses a list with one twice. There is no identifier on the
                projection to key by instead, and `SocialLinkBody` explains that its absence
                is deliberate rather than an omission.
              */
              <li key={link.platform} className="flex min-w-0 flex-wrap gap-x-3">
                <a
                  href={link.url}
                  rel={USER_LINK_REL}
                  target="_blank"
                  className={`min-w-0 break-all ${LINK_CLASS}`}
                >
                  {socialPlatformLabel(link.platform)}
                  {/* A real space, not only the margin below it: without one the accessible
                      name of the link runs the platform and the address together. */}{' '}
                  {/*
                    Inside the anchor, so the destination is part of what a screen reader
                    announces for the link rather than text beside it that a reader moving
                    link to link never hears.
                  */}
                  <span className="ml-2 font-normal text-white/40 no-underline">{link.url}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
