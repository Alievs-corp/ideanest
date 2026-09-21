import { Monitor, Smartphone } from 'lucide-react';
import { Pill, Tag } from '@ideanest/ui';
import type { Locale } from '../../lib/i18n/locale';
import type { SessionSummary } from '../../lib/sessions/api';
import {
  browserOf,
  deviceNameOf,
  formatExactTime,
  formatRelativeTime,
  locationOf,
  platformOf,
} from '../../lib/sessions/describe';
import type { SessionRowCopy } from '../../lib/i18n/settings-copy';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';

export interface SessionRowProps {
  session: SessionSummary;
  /** Fixed by the caller so every row in a render agrees on "ago". */
  now: Date;
  /**
   * Fixed by the caller for the same reason `now` is — #324.
   *
   * A prop rather than `useRouteLocale()` here: this component is a pure row and its test
   * renders it outside a router, where `useParams` answers `null`. The panel above it is the
   * one component in the pair that is mounted on a route, so it is the one that reads the
   * segment.
   */
  locale: Locale;
  /**
   * The row's own words, handed down by the panel — #80.
   *
   * A prop for the same reason `locale` is: this component is a pure row, and its test
   * renders it outside a router, where nothing could resolve a catalogue.
   */
  copy: SessionRowCopy;
  busy: boolean;
  onSignOut: (session: SessionSummary) => void;
}

/**
 * One device in the list.
 *
 * No zebra striping and no coloured rows: in this system surface colour encodes
 * state, so spending it on rhythm would leave nothing to say "this one is
 * different" with (docs/ui-kit.md §7.15). Rows are separated by `--divider` and
 * hover to `--surface-3`, and that is all.
 *
 * The current session is marked with a WORD, not a colour and not lime. Lime
 * means "act now" (§8.1) and "this device" is where you are, not something to
 * hurry about — the same reasoning that keeps the active page in a paginator
 * white rather than lime. Colour alone would carry nothing anyway (§9.2).
 */
export function SessionRow({ session, now, locale, copy, busy, onSignOut }: SessionRowProps) {
  const name = deviceNameOf(session, copy);
  const platform = platformOf(session.userAgent);
  const address = locationOf(session);
  const Icon = platform === 'Android' || platform === 'iOS' ? Smartphone : Monitor;

  /*
   * When the client sent a label of its own it becomes the row's title, which
   * hides the browser. Put it back as supporting detail — "MacBook Pro" alone
   * does not tell you which of two browsers on that machine is signed in.
   */
  const browser = browserOf(session.userAgent);
  const agent = session.deviceLabel?.trim()
    ? browser && platform
      ? // The same joining sentence `deviceNameOf` uses, and for the same reason it is a
        // template: "on" is a preposition, and two of the four languages put the platform first.
        fillPlaceholders(copy.onPlatform, { browser, platform })
      : (browser ?? platform ?? null)
    : null;

  const detail = [agent, address].filter(Boolean).join(' · ');

  const verb = busy ? copy.signingOut : copy.signOut;

  /*
   * Two whole sentences rather than a verb concatenated with a target. "Sign out" + "of this
   * device" reads as English and as nothing else: every other language here puts the object
   * somewhere the join cannot reach, and an accessible name assembled from halves is one
   * nobody ever proofreads as a sentence.
   */
  const label = session.current
    ? busy
      ? copy.signingOutThisLabel
      : copy.signOutThisLabel
    : fillPlaceholders(busy ? copy.signingOutLabel : copy.signOutLabel, { device: name });

  return (
    <li className="flex items-start gap-4 px-5 py-4 transition-colors duration-150 ease-in-out hover:bg-surface-3">
      <span
        aria-hidden="true"
        className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md bg-surface-3 text-white/64"
      >
        <Icon className="size-[18px]" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-base font-medium tracking-[-0.02em] text-white">{name}</p>
          {session.current && <Tag>{copy.thisDevice}</Tag>}
        </div>

        <p className="mt-1 text-sm text-white/64">{detail || copy.noDetails}</p>

        {/*
          `--text-tertiary` is only AA at 16px and up, and on a security screen
          "when was this last used" is the fact the whole page turns on. It gets
          `--text-secondary` (9.2:1) rather than the usual meta treatment.
        */}
        <p className="mt-0.5 text-sm text-white/64">
          {/*
            One sentence with two instants in it, filled with nodes rather than split into
            three literals: Azerbaijani and Turkish put "signed in" after the time rather
            than before it, and two half-sentences cannot express that.
          */}
          {fillNodes(copy.lastActive, {
            seen: (
              <time dateTime={session.lastSeenAt} title={formatExactTime(session.lastSeenAt, locale)}>
                {formatRelativeTime(session.lastSeenAt, now, locale)}
              </time>
            ),
            created: (
              <time dateTime={session.createdAt} title={formatExactTime(session.createdAt, locale)}>
                {formatRelativeTime(session.createdAt, now, locale)}
              </time>
            ),
          })}
        </p>
      </div>

      {/*
        The visible label is "Sign out" on every row, so the accessible name has
        to say WHICH device — otherwise a screen-reader user hears the same
        button repeated and has no way to choose (docs/ui-kit.md §9.4).
      */}
      <Pill
        variant="ghost"
        size="sm"
        className="mt-0.5 shrink-0"
        disabled={busy}
        aria-label={label}
        onClick={() => onSignOut(session)}
      >
        {verb}
      </Pill>
    </li>
  );
}
