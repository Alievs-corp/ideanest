import { getLocale, getTranslations } from 'next-intl/server';
import { X } from 'lucide-react';
import { localeOrDefault } from '../../lib/i18n/locale';
import {
  DISMISSED_KEY,
  maintenanceScriptSource,
  writeMoment,
  type MomentPart,
} from '../../lib/maintenance/script';
import {
  interpolate,
  monthTemplates,
  platformMoment,
  readStatusForRender,
} from '../../lib/maintenance/server';
import type { StatusWindow } from '../../lib/maintenance/status';

/**
 * The planned-maintenance notice at the top of every public page — §19.6, issue #214.
 *
 * <h2>Rendered on the server, completed by an inline script</h2>
 *
 * `lib/maintenance/script.ts` has the measurement behind that: on routes budgeted to the tenth
 * of a KiB, a client component here would cost every public page whether or not a window was
 * announced. So this draws nothing at all unless `GET /v1/status` names an upcoming window,
 * and when it does it draws the whole sentence — times in the platform's zone — plus a few
 * hundred bytes of inline script that rewrite them in the reader's zone and remember a
 * dismissal on this device. No route's First Load JS changes.
 *
 * <h2>Dismissed per window</h2>
 *
 * The status endpoint publishes a window's times and not its identifier, so the key is the
 * start and the end together. At most one window is announced at a time, so the start alone
 * would identify it — the end is in the key so that a notice the reader closed comes back if
 * the end is moved, because that is new information they have not seen.
 */
export async function MaintenanceNotice() {
  const status = await readStatusForRender(false);
  const upcoming = status?.upcoming ?? null;
  if (upcoming === null) return null;

  const locale = localeOrDefault(await getLocale());
  const t = await getTranslations('shell.maintenance');
  const months = monthTemplates(locale);
  const key = `${upcoming.startsAt}|${upcoming.endsAt ?? ''}`;

  return (
    <>
      <div
        data-maintenance-notice={key}
        suppressHydrationWarning
        role="status"
        className="border-b border-white/8 bg-surface-2"
      >
        <div className="mx-auto flex w-full max-w-[1280px] items-start justify-between gap-4 px-5 py-3 sm:px-6">
          <p className="text-sm text-white/80">{sentence(upcoming, t, months)}</p>
          {/*
            Hidden until the script is there to act on it: a close control that does nothing
            is worse than none, and without JavaScript the notice stays, which is the safe side.
          */}
          <button
            type="button"
            hidden
            suppressHydrationWarning
            data-maintenance-dismiss=""
            aria-label={t('dismiss')}
            className="-m-1 shrink-0 rounded-lg p-1 text-white/64 transition-colors duration-150 ease-in-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: maintenanceScriptSource({ months, dismissedKey: DISMISSED_KEY, watch: null }),
        }}
      />
    </>
  );
}

/** Only templates are read here, and a template is read raw — `t()` on one draws its key. */
interface Translator {
  raw(key: string): unknown;
}

function sentence(window: StatusWindow, t: Translator, months: readonly string[]) {
  const start = { instant: window.startsAt, months };
  if (window.endsAt === null) {
    return interpolate(String(t.raw('upcomingOpenEnded')), {
      date: <MaintenanceTime part="date" {...start} />,
      start: <MaintenanceTime part="time" {...start} />,
    });
  }
  return interpolate(String(t.raw('upcoming')), {
    date: <MaintenanceTime part="date" {...start} />,
    start: <MaintenanceTime part="time" {...start} />,
    // The time alone when the window ends on the day it starts, the date too when it does not.
    end: <MaintenanceTime part="moment" instant={window.endsAt} reference={window.startsAt} months={months} />,
  });
}

export interface MaintenanceTimeProps {
  readonly part: MomentPart;
  readonly instant: string;
  /** For `moment`: the instant whose day decides whether the date is written. Now when absent. */
  readonly reference?: string;
  readonly months: readonly string[];
}

/**
 * One instant, written in the platform's zone, marked for the script to rewrite in the reader's.
 * `suppressHydrationWarning` because the text React hydrates is the rewritten one.
 */
export function MaintenanceTime({ part, instant, reference, months }: MaintenanceTimeProps) {
  const at = platformMoment(instant, months);
  if (at === null) return null;
  const ref = platformMoment(reference ?? new Date().toISOString(), months);

  return (
    <time
      dateTime={instant}
      data-maintenance-part={part}
      data-maintenance-ref={reference}
      suppressHydrationWarning
    >
      {writeMoment(part, at, ref)}
    </time>
  );
}
