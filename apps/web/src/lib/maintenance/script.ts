/**
 * The maintenance notice's and the maintenance page's behaviour, as an inline script — #214.
 *
 * <h2>Why an inline script and not a client component</h2>
 *
 * Three things here need the browser: times in the reader's own zone, a dismissal remembered
 * on this device, and a page that polls and takes the reader back. A client component is the
 * ordinary way to do that, and on this site it is the one that cannot be afforded. `SiteShell`
 * is on every public route, those routes sit within a tenth of a KiB of their First Load JS
 * budgets, and a client component imported by a server component is counted on every route
 * that imports it whether or not it renders — measured while this was written: a lazy
 * `next/dynamic` import cost 2.8 KiB of loader on each route, and a server-side `import()` of a
 * client module still put its chunk in the route's first load. #214 says the notice must not
 * raise any public route's First Load JS, and that is only true of JavaScript that is not a
 * chunk at all.
 *
 * So the server renders the notice and the page completely — in the reader's language, with
 * every time already written out in the platform's zone — and this script, inlined only when
 * there is something to say, improves them in place: rewrites each `<time>` in the reader's
 * zone, hides a notice the reader dismissed, reveals the dismiss control, and on the
 * maintenance page polls `GET /v1/status`. Without JavaScript the reader still sees correct
 * words and correct times, labelled in the platform's zone.
 *
 * <h2>How it stays one tested piece of TypeScript</h2>
 *
 * {@link maintenanceScript}, {@link momentOf} and {@link writeMoment} are ordinary
 * functions, tested as such, and {@link maintenanceScriptSource} writes them out with
 * `Function.prototype.toString` — the technique `next-themes` uses for the same reason. That
 * puts two rules on all three,
 * and the tests hold them to it by running the emitted source rather than the function:
 * they close over nothing from this module, and they use nothing a compiler would lower to a
 * helper call.
 *
 * <h2>Hydration</h2>
 *
 * The script edits server-rendered markup before React hydrates it, so every element it
 * touches carries `suppressHydrationWarning`: React then keeps what the page shows rather
 * than putting the platform's zone back. Nothing is added or removed — only text and the
 * `hidden` attribute change — so the tree React hydrates is the tree it rendered.
 */

/** The zone the server writes times in, before the reader's own is known. */
export const PLATFORM_TIME_ZONE = 'Asia/Baku';

/** Where a dismissal is remembered. Only the latest window is, which is the only one shown. */
export const DISMISSED_KEY = 'ideanest.maintenance.dismissed';

/** One instant, in one zone, in the words a notice uses. */
export interface Moment {
  /** `2026-10-04`, to compare calendar days. */
  readonly day: string;
  /** `4 October`, `4 oktyabr`, `4 октября`. */
  readonly date: string;
  /** `02:00`. Every language the platform ships uses a 24-hour clock. */
  readonly time: string;
}

/**
 * An instant written out in a zone, or null when either cannot be read.
 *
 * `months` holds a template per month with `{d}` where the day goes, resolved on the server
 * where every language's calendar data is complete — Chromium's Azerbaijani is not (#401), so
 * the browser is only asked for numbers, from `en-GB`, which every engine carries in full.
 *
 * Self-contained, because {@link maintenanceScriptSource} writes it into the page.
 */
export function momentOf(instant: string, zone: string, months: readonly string[]): Moment | null {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return null;

  try {
    const parts: Record<string, string> = {};
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatter.formatToParts(at).forEach(function (part) {
      parts[part.type] = part.value;
    });

    const month = months[Number(parts['month']) - 1];
    if (month === undefined) return null;
    const day = String(Number(parts['day']));

    return {
      day: parts['year'] + '-' + parts['month'] + '-' + parts['day'],
      date: month.replace('{d}', day),
      time: parts['hour'] + ':' + parts['minute'],
    };
  } catch {
    return null;
  }
}

/**
 * How a `<time>` in a notice is written: the date, the time, or — for an end — the time alone
 * when it falls on the same day as `data-maintenance-ref` (or today), the date and time when
 * it does not.
 */
export type MomentPart = 'date' | 'time' | 'moment';

/** The same rule, for the server's first rendering. */
export function writeMoment(part: MomentPart, at: Moment, reference: Moment | null): string {
  if (part === 'date') return at.date;
  if (part === 'time') return at.time;
  return reference !== null && reference.day === at.day ? at.time : at.date + ', ' + at.time;
}

export interface MaintenanceWatch {
  /** `/v1/status`, same-origin through the `/v1` rewrite. */
  readonly statusUrl: string;
  /** The maintenance page's own address, `/az/maintenance`. */
  readonly page: string;
  /** Where to go when there is nowhere to go back to. */
  readonly home: string;
  /** Before the first check. The edge's `Retry-After`, or the ordinary interval. */
  readonly firstCheckMs: number;
  /** Between checks. Thirty seconds. */
  readonly intervalMs: number;
}

export interface MaintenanceScriptOptions {
  readonly months: readonly string[];
  readonly dismissedKey: string;
  /** Present on the maintenance page only. */
  readonly watch: MaintenanceWatch | null;
}

/**
 * Everything the notice and the page do in the browser. Self-contained: see the file comment.
 *
 * Idempotent, because a page can carry both a notice and the maintenance page's own script:
 * the listeners are installed once per document, and the painting is marked per element.
 */
export function maintenanceScript(
  options: MaintenanceScriptOptions,
  moment: typeof momentOf,
  write: typeof writeMoment,
): void {
  const doc = document;
  const w = window as unknown as Record<string, unknown>;

  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    zone = '';
  }

  function dismissed(): string | null {
    try {
      return localStorage.getItem(options.dismissedKey);
    } catch {
      return null;
    }
  }

  function paint(root: ParentNode): void {
    const times = root.querySelectorAll('time[data-maintenance-part]');
    for (let index = 0; index < times.length; index += 1) {
      const element = times[index] as HTMLTimeElement;
      if (zone === '' || element.hasAttribute('data-maintenance-painted')) continue;

      const at = moment(element.dateTime, zone, options.months);
      if (at === null) continue;
      const part = element.getAttribute('data-maintenance-part');
      const ref = element.getAttribute('data-maintenance-ref');
      const reference = moment(ref === null ? new Date().toISOString() : ref, zone, options.months);

      element.textContent = write(
        part === 'date' || part === 'time' ? part : 'moment',
        at,
        reference,
      );
      // Once per element: the text written is what the observer below would otherwise see as new.
      element.setAttribute('data-maintenance-painted', '');
    }
  }

  function settle(): void {
    const notices = doc.querySelectorAll('[data-maintenance-notice]');
    const gone = dismissed();
    for (let index = 0; index < notices.length; index += 1) {
      const notice = notices[index] as HTMLElement;
      if (notice.getAttribute('data-maintenance-notice') === gone) {
        notice.hidden = true;
        continue;
      }
      const control = notice.querySelector('[data-maintenance-dismiss]') as HTMLElement | null;
      if (control !== null) control.hidden = false;
    }
    paint(doc);
  }

  settle();

  if (w['__ideanestMaintenance'] !== true) {
    w['__ideanestMaintenance'] = true;

    doc.addEventListener('click', function (event) {
      const target = event.target as Element | null;
      const control = target === null || !target.closest ? null : target.closest('[data-maintenance-dismiss]');
      if (control === null) return;
      const notice = control.closest('[data-maintenance-notice]') as HTMLElement | null;
      if (notice === null) return;

      try {
        localStorage.setItem(options.dismissedKey, notice.getAttribute('data-maintenance-notice') || '');
      } catch {
        // A private window that refuses storage still closes the notice for this page.
      }
      notice.hidden = true;
    });

    /*
     * A notice can arrive after this ran: a client-side navigation into a layout that draws
     * one renders it from the RSC payload, and React does not execute a script it inserts.
     * The observer is what settles those.
     */
    if (typeof MutationObserver === 'function') {
      new MutationObserver(settle).observe(doc.documentElement, { childList: true, subtree: true });
    }
  }

  const watch = options.watch;
  if (watch === null) return;

  function back(): void {
    if (location.pathname !== watch!.page) {
      // Rewritten in place: the address is where the reader was, so asking again is going back.
      location.reload();
      return;
    }
    const from = new URLSearchParams(location.search).get('from');
    const safe =
      from !== null && from.charAt(0) === '/' && from.charAt(1) !== '/' && from.charAt(1) !== '\\';
    location.replace(safe ? from : watch!.home);
  }

  function later(ms: number): void {
    // Up to a fifth either way, so a page full of readers does not ask in the same second.
    setTimeout(check, ms * (0.8 + Math.random() * 0.4));
  }

  function check(): void {
    fetch(watch!.statusUrl, { cache: 'no-store', credentials: 'omit' })
      .then(function (response) {
        if (response.ok) {
          return response.json().then(function (body: { state?: unknown } | null) {
            if (body !== null && body.state === 'operational') back();
            else later(watch!.intervalMs);
          });
        }
        const retry = parseInt(response.headers.get('Retry-After') || '', 10);
        later(retry > 0 ? Math.min(Math.max(retry, 30), 300) * 1000 : watch!.intervalMs);
        return undefined;
      })
      .catch(function () {
        later(watch!.intervalMs);
      });
  }

  later(watch.firstCheckMs);
}

/**
 * The script, ready for `<script dangerouslySetInnerHTML>`.
 *
 * The options are JSON with every `<` escaped, so no value — a month name, an address — can
 * close the element early.
 */
export function maintenanceScriptSource(options: MaintenanceScriptOptions): string {
  const json = JSON.stringify(options).replace(/</g, '\\u003c');
  return `(${maintenanceScript.toString()})(${json},${momentOf.toString()},${writeMoment.toString()})`;
}

export interface FollowOptions {
  /** The maintenance problem `type`, `MAINTENANCE_PROBLEM_TYPE`. */
  readonly type: string;
  /** The languages, to find the one in the address. */
  readonly locales: readonly string[];
  readonly fallbackLocale: string;
}

/**
 * Sends the reader to the maintenance page when a call to the service meets the maintenance
 * problem — #214's "a client-side API call receiving the problem navigates to /maintenance".
 *
 * <h2>Why it wraps `fetch` instead of living in `lib/api/client.ts`</h2>
 *
 * Every call to the service passes through one of four places — `client.ts`, the refresh in
 * `access-token.ts`, `auth/post.ts`, and a couple of direct reads — and the refresh is on every
 * route through the session bootstrap. The check in those modules, with the handler loaded
 * lazily, measured +0.5 KiB of First Load JS on every route in the application, sixteen of
 * which it broke. Wrapped once from an inline script, the same rule costs no route anything and
 * covers every call, including ones added later.
 *
 * It is the narrowest wrapper that does the job: same-origin `/v1/` addresses only, a `503`
 * only, and the response is handed back to the caller untouched — the check reads a clone. Only
 * the maintenance problem `type` moves anybody; a bare `503` is the caller's error to show.
 * `/v1/status` is left to whoever asked it, because asking it is how the maintenance page
 * learns the window is over, and the page is already where the reader would be sent.
 *
 * A full navigation rather than the router's, because the maintenance page completes itself
 * with an inline script and React does not run a script it renders on the client. The address
 * is `/{locale}/maintenance?from=<where the reader was>`, which the page returns to.
 *
 * Self-contained, for the reason the file comment gives.
 */
export function followMaintenanceScript(options: FollowOptions): void {
  const w = window as unknown as { fetch: typeof fetch; __ideanestFollow?: boolean };
  if (w.__ideanestFollow === true || typeof w.fetch !== 'function') return;
  w.__ideanestFollow = true;
  const original = w.fetch;

  function serviceCall(input: unknown): boolean {
    let address = '';
    if (typeof input === 'string') address = input;
    else if (input instanceof URL) address = input.href;
    else if (input !== null && typeof input === 'object' && typeof (input as { url?: unknown }).url === 'string') {
      address = (input as { url: string }).url;
    }
    try {
      const url = new URL(address, location.href);
      return url.origin === location.origin && url.pathname.indexOf('/v1/') === 0 && url.pathname !== '/v1/status';
    } catch {
      return false;
    }
  }

  function go(): void {
    const segment = location.pathname.split('/')[1] || '';
    const locale = options.locales.indexOf(segment) >= 0 ? segment : options.fallbackLocale;
    const page = '/' + locale + '/maintenance';
    if (location.pathname === page) return;
    location.assign(page + '?from=' + encodeURIComponent(location.pathname + location.search));
  }

  w.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return original.call(window, input, init).then(function (response) {
      if (response.status === 503 && serviceCall(input)) {
        response
          .clone()
          .json()
          .then(
            function (body: { type?: unknown; status?: unknown } | null) {
              if (body !== null && body.type === options.type && (body.status === undefined || body.status === 503)) {
                go();
              }
            },
            function () {
              // Not JSON, so not the contract.
            },
          );
      }
      return response;
    });
  };
}

/** {@link followMaintenanceScript}, ready for the root layout. */
export function followMaintenanceSource(options: FollowOptions): string {
  return `(${followMaintenanceScript.toString()})(${JSON.stringify(options).replace(/</g, '\u003c')})`;
}
