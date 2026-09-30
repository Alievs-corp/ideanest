import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISMISSED_KEY,
  followMaintenanceSource,
  maintenanceScriptSource,
  momentOf,
  writeMoment,
  type MaintenanceScriptOptions,
} from './script';
import { monthTemplates } from './server';

/**
 * The maintenance notice's and page's inline script — #214.
 *
 * <h2>The emitted source is what runs, so the emitted source is what is tested</h2>
 *
 * `script.ts` turns three functions into text with `toString`. A function that closed over a
 * module variable, or that a compiler lowered to a helper call, would pass a test that called
 * it and throw a `ReferenceError` in a reader's browser. So every behaviour below is exercised
 * by evaluating the string the page carries, with the browser globals it reaches for handed
 * in explicitly — which is also how a fake `location` and `fetch` get in, since jsdom's cannot
 * be replaced.
 */

const EN = monthTemplates('en');
const RU = monthTemplates('ru');
const AZ = monthTemplates('az');

interface Globals {
  readonly location?: Partial<Location>;
  readonly fetch?: typeof fetch;
  readonly setTimeout?: (run: () => void, ms: number) => unknown;
}

/** Runs a page's script with these globals in place of the browser's. */
function run(source: string, globals: Globals = {}): void {
  const names = ['location', 'fetch', 'setTimeout'] as const;
  const values = names.map((name) => globals[name] ?? (globalThis as Record<string, unknown>)[name]);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(...names, source)(...values);
}

function zoned(zone: string): void {
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...real.call(this), timeZone: zone };
  });
}

function options(watch: MaintenanceScriptOptions['watch'] = null): MaintenanceScriptOptions {
  return { months: EN, dismissedKey: DISMISSED_KEY, watch };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  delete (window as unknown as Record<string, unknown>)['__ideanestMaintenance'];
  delete (window as unknown as Record<string, unknown>)['__ideanestFollow'];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('an instant, written out', () => {
  it('writes the day and month in the language’s own form, and a 24-hour time', () => {
    expect(momentOf('2026-10-04T22:00:00Z', 'Asia/Baku', EN)).toEqual({
      day: '2026-10-05',
      date: '5 October',
      time: '02:00',
    });
    // Genitive after a number, as Russian has it.
    expect(momentOf('2026-10-04T22:00:00Z', 'Asia/Baku', RU)?.date).toBe('5 октября');
    expect(momentOf('2026-10-04T22:00:00Z', 'Asia/Baku', AZ)?.date).toBe('5 oktyabr');
  });

  it('writes the same instant in the reader’s zone, which is the point of it', () => {
    expect(momentOf('2026-10-04T22:00:00Z', 'America/New_York', EN)).toEqual({
      day: '2026-10-04',
      date: '4 October',
      time: '18:00',
    });
  });

  it('gives nothing for an instant or a zone it cannot read, so the server’s words stay', () => {
    expect(momentOf('not a time', 'Asia/Baku', EN)).toBeNull();
    expect(momentOf('2026-10-04T22:00:00Z', 'Mars/Olympus_Mons', EN)).toBeNull();
  });

  it('writes an end as the time alone on the same day, and with the date on another', () => {
    const start = momentOf('2026-10-04T22:00:00Z', 'Asia/Baku', EN)!;
    const sameDay = momentOf('2026-10-04T22:30:00Z', 'Asia/Baku', EN)!;
    const nextDay = momentOf('2026-10-05T22:30:00Z', 'Asia/Baku', EN)!;

    expect(writeMoment('moment', sameDay, start)).toBe('02:30');
    expect(writeMoment('moment', nextDay, start)).toBe('6 October, 02:30');
  });
});

describe('the notice, completed in the browser', () => {
  const KEY = '2026-10-04T22:00:00Z|2026-10-04T22:30:00Z';

  function notice(): void {
    document.body.innerHTML = `
      <div data-maintenance-notice="${KEY}">
        <p>Planned maintenance on
          <time datetime="2026-10-04T22:00:00Z" data-maintenance-part="date">5 October</time>,
          <time datetime="2026-10-04T22:00:00Z" data-maintenance-part="time">02:00</time>–<time
            datetime="2026-10-04T22:30:00Z" data-maintenance-part="moment"
            data-maintenance-ref="2026-10-04T22:00:00Z">02:30</time></p>
        <button type="button" hidden data-maintenance-dismiss aria-label="Dismiss"></button>
      </div>`;
  }

  it('rewrites every time in the reader’s zone', () => {
    zoned('America/New_York');
    notice();

    run(maintenanceScriptSource(options()));

    const times = [...document.querySelectorAll('time')].map((element) => element.textContent);
    expect(times).toEqual(['4 October', '18:00', '18:30']);
  });

  it('offers the dismiss control only once the script is there to act on it', () => {
    notice();
    expect(document.querySelector('button')!.hidden).toBe(true);

    run(maintenanceScriptSource(options()));

    expect(document.querySelector('button')!.hidden).toBe(false);
  });

  it('closes on dismissal, and stays closed for this window on the next page', () => {
    notice();
    run(maintenanceScriptSource(options()));

    document.querySelector('button')!.click();
    expect((document.querySelector('[data-maintenance-notice]') as HTMLElement).hidden).toBe(true);
    expect(localStorage.getItem(DISMISSED_KEY)).toBe(KEY);

    // The next page load: a fresh document, the same device.
    delete (window as unknown as Record<string, unknown>)['__ideanestMaintenance'];
    notice();
    run(maintenanceScriptSource(options()));
    expect((document.querySelector('[data-maintenance-notice]') as HTMLElement).hidden).toBe(true);
  });

  it('comes back for a different window, or for the same one with a new end', () => {
    localStorage.setItem(DISMISSED_KEY, '2026-10-04T22:00:00Z|2026-10-04T22:15:00Z');
    notice();

    run(maintenanceScriptSource(options()));

    expect((document.querySelector('[data-maintenance-notice]') as HTMLElement).hidden).toBe(false);
  });

  it('settles a notice that arrives after it ran, as a client-side navigation brings one', async () => {
    localStorage.setItem(DISMISSED_KEY, KEY);
    run(maintenanceScriptSource(options()));

    notice();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((document.querySelector('[data-maintenance-notice]') as HTMLElement).hidden).toBe(true);
  });

  it('cannot be closed early by a value in its options', () => {
    const source = maintenanceScriptSource({ ...options(), dismissedKey: '</script><script>alert(1)' });

    expect(source).not.toContain('</script>');
  });
});

describe('the maintenance page, waiting for the platform', () => {
  const WATCH = {
    statusUrl: '/v1/status',
    page: '/az/maintenance',
    home: '/az',
    firstCheckMs: 30_000,
    intervalMs: 30_000,
  };

  function harness(pathname: string, search = '') {
    const timers: { run: () => void; ms: number }[] = [];
    const location = { pathname, search, reload: vi.fn(), replace: vi.fn() };
    const fetchMock = vi.fn<typeof fetch>();
    const tick = async () => {
      const next = timers.shift();
      next?.run();
      // A response body is read through a stream, which settles over macrotasks, not microtasks.
      for (let index = 0; index < 20; index += 1) await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    };
    run(maintenanceScriptSource(options(WATCH)), {
      location: location as unknown as Location,
      fetch: fetchMock,
      setTimeout: (callback, ms) => timers.push({ run: callback, ms }),
    });
    return { timers, location, fetchMock, tick };
  }

  const status = (body: unknown, init: ResponseInit = { status: 200 }) =>
    new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...init.headers } });

  it('asks the status endpoint about every thirty seconds, never from a cache', async () => {
    const page = harness('/az/discover');
    page.fetchMock.mockResolvedValue(status({ state: 'maintenance', maintenance: { startsAt: 'x' } }));

    expect(page.timers[0]!.ms).toBeGreaterThanOrEqual(24_000);
    expect(page.timers[0]!.ms).toBeLessThanOrEqual(36_000);
    await page.tick();

    expect(page.fetchMock).toHaveBeenCalledWith('/v1/status', { cache: 'no-store', credentials: 'omit' });
    expect(page.location.reload).not.toHaveBeenCalled();
    expect(page.timers).toHaveLength(1);
  });

  it('reloads the page the reader asked for when it was rewritten in place', async () => {
    const page = harness('/az/discover');
    page.fetchMock.mockResolvedValue(status({ state: 'operational', maintenance: null, upcoming: null }));

    await page.tick();

    expect(page.location.reload).toHaveBeenCalled();
  });

  it('returns to where the reader came from when it was sent here', async () => {
    const page = harness('/az/maintenance', '?from=%2Faz%2Fpledges%3Fpage%3D2');
    page.fetchMock.mockResolvedValue(status({ state: 'operational' }));

    await page.tick();

    expect(page.location.replace).toHaveBeenCalledWith('/az/pledges?page=2');
  });

  it('never follows a "from" off the site', async () => {
    for (const from of ['//evil.example/x', 'https://evil.example', '/\\evil.example']) {
      const page = harness('/az/maintenance', `?from=${encodeURIComponent(from)}`);
      page.fetchMock.mockResolvedValue(status({ state: 'operational' }));

      await page.tick();

      expect(page.location.replace).toHaveBeenCalledWith('/az');
    }
  });

  it('waits as long as the edge says, within reason, when the service is away', async () => {
    const page = harness('/az/discover');
    page.fetchMock.mockResolvedValue(
      status({ type: 'https://ideanest.az/problems/maintenance', status: 503, source: 'edge' }, {
        status: 503,
        headers: { 'Retry-After': '120' },
      }),
    );

    await page.tick();

    expect(page.timers[0]!.ms).toBeGreaterThanOrEqual(96_000);
    expect(page.timers[0]!.ms).toBeLessThanOrEqual(144_000);
  });

  it('keeps asking after a failure rather than giving up', async () => {
    const page = harness('/az/discover');
    page.fetchMock.mockRejectedValue(new TypeError('offline'));

    await page.tick();

    expect(page.timers).toHaveLength(1);
  });
});

describe('a call that meets the maintenance problem', () => {
  const TYPE = 'https://ideanest.az/problems/maintenance';

  function install(pathname: string, respond: Response) {
    const location = {
      pathname,
      search: '?tab=2',
      href: `https://ideyanest.com${pathname}?tab=2`,
      origin: 'https://ideyanest.com',
      assign: vi.fn(),
    };
    const original = vi.fn<typeof fetch>().mockResolvedValue(respond);
    const saved = window.fetch;
    window.fetch = original;
    run(followMaintenanceSource({ type: TYPE, locales: ['az', 'en', 'ru', 'tr'], fallbackLocale: 'en' }), {
      location: location as unknown as Location,
    });
    const wrapped = window.fetch;
    window.fetch = saved;
    return { location, original, wrapped };
  }

  const problem = (body: unknown, status = 503) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/problem+json' } });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('sends the reader to the maintenance page, remembering where they were', async () => {
    const page = install('/ru/pledges', problem({ type: TYPE, status: 503, source: 'api' }));

    const response = await page.wrapped('/v1/pledges');
    await settle();

    expect(page.location.assign).toHaveBeenCalledWith('/ru/maintenance?from=%2Fru%2Fpledges%3Ftab%3D2');
    // The caller is handed the response untouched, body and all.
    expect(await response.json()).toMatchObject({ type: TYPE });
  });

  it('leaves a bare 503 to the screen that made the call', async () => {
    const page = install('/az/pledges', problem({ type: 'https://ideanest.az/problems/overloaded', status: 503 }));

    await page.wrapped('/v1/pledges');
    await settle();

    expect(page.location.assign).not.toHaveBeenCalled();
  });

  it('only watches the service, and not the status endpoint the maintenance page asks', async () => {
    for (const address of ['/_next/data/x.json', 'https://elsewhere.example/v1/x', '/v1/status']) {
      const page = install('/az/discover', problem({ type: TYPE, status: 503 }));

      await page.wrapped(address);
      await settle();

      expect(page.location.assign).not.toHaveBeenCalled();
    }
  });

  it('does not send the reader to the page they are already on', async () => {
    const page = install('/az/maintenance', problem({ type: TYPE, status: 503 }));

    await page.wrapped('/v1/me');
    await settle();

    expect(page.location.assign).not.toHaveBeenCalled();
  });
});
