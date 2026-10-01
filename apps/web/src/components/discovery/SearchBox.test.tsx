import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { NO_FILTERS, parseFilters, toHref, type DiscoveryFilters } from '@ideanest/discovery/filters';
import { getSuggestions, type Suggestion } from '../../lib/discovery/suggest';
import { SearchBox } from './SearchBox';
import { suggestCopyFrom } from '../../lib/i18n/feed-copy';
import { translatorFor } from '../../test-copy';
/*
 * The copy the route would have resolved, built from `messages/en.json` by the same function it
 * calls — issue #324. Retyping the sentences here would give a test that passes whatever the
 * catalogue says, which is the opposite of what it is for.
 */
const COPY = suggestCopyFrom(translatorFor('discovery.suggest'));

/**
 * The search box and its autocomplete, with the suggest endpoint stubbed.
 *
 * WHAT THESE COVER, and why each is here rather than left to a reviewer:
 *
 *   - the keyboard walk. Down, Up, Home, End, Enter, Escape and Tab, with
 *     `aria-activedescendant` following the active row while DOM focus stays in
 *     the input. None of it is visible in a screenshot and all of it is the
 *     issue.
 *   - each kind of suggestion goes where its kind says: a campaign to the
 *     campaign, a taxon or a tag to the filter, plain text to a search — and
 *     the result is in the URL, so a searched feed is linkable and survives the
 *     back button (D-12).
 *   - the count and the no-results case are announced. Silence from a control
 *     that was just typed into reads as a control that has broken.
 *   - a refusal is the service's own RFC 9457 prose, and the box still submits.
 *
 * REAL TIMERS, DELIBERATELY. `@testing-library/react`'s async wrapper and
 * vitest's fake clock do not cooperate — `await user.type(...)` never settles
 * under `vi.useFakeTimers()` — so the millisecond-level assertions about the
 * debounce live in `lib/discovery/useSuggestions.test.ts`, which drives the
 * hook through `renderHook` and never touches the DOM. What is asserted here is
 * that a burst of keystrokes produces one request, which holds on either clock.
 */

vi.mock('next/navigation', async (importOriginal) => ({
  /*
   * Spread first so the real module's other exports survive. `i18n/navigation.ts`
   * builds its wrappers at import time and reads `redirect` and `permanentRedirect`
   * while doing so, and a factory that replaced the module wholesale left those
   * undefined — which failed as a TypeError inside next-intl rather than anywhere
   * near the test that caused it.
   */
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({
    push: (href: string) => navigated.push(href),
    replace: (href: string) => navigated.push(href),
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
}));

vi.mock('../../lib/discovery/suggest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/discovery/suggest')>()),
  getSuggestions: vi.fn(),
}));

const suggestMock = vi.mocked(getSuggestions);

/** Every href the router was pushed to, in order. */
const navigated: string[] = [];

/* -------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------- */

const CAMPAIGN: Suggestion = {
  kind: 'campaign',
  label: 'Oyun gecəsi dəsti',
  slug: 'oyun-gecesi-desti',
  parentSlug: 'sound-lab',
};

const CATEGORY: Suggestion = { kind: 'category', label: 'Games', slug: 'games' };

const SUBCATEGORY: Suggestion = {
  kind: 'subcategory',
  label: 'Tabletop games',
  slug: 'tabletop',
  parentSlug: 'games',
};

const TAG: Suggestion = { kind: 'tag', label: 'handmade', slug: 'handmade' };

/** One of each kind, in the round-robin order the endpoint draws them in. */
const ALL: readonly Suggestion[] = [CAMPAIGN, CATEGORY, SUBCATEGORY, TAG];

/**
 * The filter sets the box asked to be applied, in order.
 *
 * The component is controlled by its caller on the real page too — the URL is
 * written by `DiscoveryView` — so what is asserted is the filter set it
 * produced, and `toHref` turns that into the address bar's own words.
 */
let applied: DiscoveryFilters[] = [];

function mount(filters: DiscoveryFilters = NO_FILTERS): UserEvent {
  // `delay: null` types without waiting between keys, which is what keeps a
  // burst of keystrokes inside the debounce window on a loaded machine.
  const user = userEvent.setup({ delay: null });
  render(<SearchBox copy={COPY} filters={filters} onApply={(next) => applied.push(next)} />);
  return user;
}

const box = (): HTMLInputElement => screen.getByRole('combobox', { name: 'Search campaigns' });

/** The option `aria-activedescendant` currently names, or null. */
function activeOption(): HTMLElement | null {
  const id = box().getAttribute('aria-activedescendant');
  return id === null ? null : document.getElementById(id);
}

function lastApplied(): DiscoveryFilters {
  const last = applied.at(-1);
  if (last === undefined) throw new Error('nothing was applied');
  return last;
}

function live(): HTMLElement {
  const region = document.querySelector('[aria-live="polite"]');
  if (region === null) throw new Error('there is no live region');
  return region as HTMLElement;
}

/** Types a fragment and waits for the list it produces to be on screen. */
async function search(user: UserEvent, text: string, expected = ALL.length): Promise<void> {
  await user.type(box(), text);
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(expected));
}

beforeEach(() => {
  vi.clearAllMocks();
  applied = [];
  navigated.length = 0;
  suggestMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------
 * Asking
 * ---------------------------------------------------------------------- */

describe('asking for suggestions', () => {
  it('sends one request for a burst of keystrokes, not one per key', async () => {
    const user = mount();

    await user.type(box(), 'games');
    await waitFor(() => expect(suggestMock).toHaveBeenCalled());

    // Five keystrokes, one request, and it is for the whole word rather than
    // for a prefix of it.
    expect(suggestMock).toHaveBeenCalledTimes(1);
    expect(suggestMock.mock.calls[0]?.[0]).toBe('games');
  });

  it('never asks about a fragment the endpoint cannot answer', async () => {
    const user = mount();

    await user.type(box(), 'g');
    // `SuggestQuery.MIN_LENGTH` is two. One character is a prefix of a large
    // fraction of everything, so the endpoint answers it with nothing — and it
    // is the request every visitor would otherwise make on the first keystroke
    // of every session.
    await waitFor(() => expect(box()).toHaveAttribute('aria-expanded', 'false'));
    expect(suggestMock).not.toHaveBeenCalled();

    await user.type(box(), 'a');
    await waitFor(() => expect(suggestMock).toHaveBeenCalledTimes(1));
  });

  it('asks nothing when the box is emptied', async () => {
    const user = mount();

    await user.type(box(), 'games');
    await waitFor(() => expect(suggestMock).toHaveBeenCalledTimes(1));

    await user.clear(box());
    await waitFor(() => expect(box()).toHaveAttribute('aria-expanded', 'false'));
    expect(suggestMock).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------
 * The keyboard walk
 * ---------------------------------------------------------------------- */

describe('the keyboard', () => {
  it('walks the list with Down and Up while DOM focus stays in the input', async () => {
    suggestMock.mockResolvedValue(ALL);
    const user = mount();
    await search(user, 'games');

    await user.keyboard('{ArrowDown}');
    expect(activeOption()).toHaveTextContent('Oyun gecəsi dəsti');
    expect(box()).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(activeOption()).toHaveTextContent('Games');

    await user.keyboard('{ArrowUp}');
    expect(activeOption()).toHaveTextContent('Oyun gecəsi dəsti');

    // The typed value is never rewritten by moving through the list: there is
    // no inline completion here, so Enter on nothing still searches for what
    // the reader wrote.
    expect(box()).toHaveValue('games');
    expect(box()).toHaveFocus();
  });

  it('wraps at both ends rather than stopping', async () => {
    suggestMock.mockResolvedValue(ALL);
    const user = mount();
    await search(user, 'games');

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(activeOption()).toHaveTextContent('handmade');

    await user.keyboard('{ArrowDown}');
    expect(activeOption()).toHaveTextContent('Oyun gecəsi dəsti');

    await user.keyboard('{ArrowUp}');
    expect(activeOption()).toHaveTextContent('handmade');
  });

  it('takes Home and End to the ends of the list once the list is being walked', async () => {
    suggestMock.mockResolvedValue(ALL);
    const user = mount();
    await search(user, 'games');

    await user.keyboard('{ArrowDown}{End}');
    expect(activeOption()).toHaveTextContent('handmade');

    await user.keyboard('{Home}');
    expect(activeOption()).toHaveTextContent('Oyun gecəsi dəsti');
  });

  it('leaves Home and End to the caret until an option is active', async () => {
    suggestMock.mockResolvedValue(ALL);
    const user = mount();
    await search(user, 'games');

    // Nothing is active, so these are the text-editing shortcuts they are in
    // every other field. Somebody fixing the first letter of what they typed
    // must not be thrown into a dropdown to do it.
    await user.keyboard('{Home}');
    expect(box()).not.toHaveAttribute('aria-activedescendant');
    expect(box().selectionStart).toBe(0);

    await user.keyboard('{End}');
    expect(box()).not.toHaveAttribute('aria-activedescendant');
    expect(box().selectionStart).toBe('games'.length);
  });

  it('closes on Escape without losing what was typed or where focus is', async () => {
    suggestMock.mockResolvedValue(ALL);
    const user = mount();
    await search(user, 'games');

    await user.keyboard('{ArrowDown}{Escape}');

    expect(box()).toHaveAttribute('aria-expanded', 'false');
    expect(box()).not.toHaveAttribute('aria-activedescendant');
    expect(box()).toHaveValue('games');
    expect(box()).toHaveFocus();
    // Escape closed a list; it did not undo typing and it did not search.
    expect(applied).toHaveLength(0);
  });

  it('leaves on Tab without selecting the active option', async () => {
    suggestMock.mockResolvedValue(ALL);
    const user = mount();
    await search(user, 'games');

    await user.keyboard('{ArrowDown}{Tab}');

    expect(applied).toHaveLength(0);
    expect(navigated).toHaveLength(0);
    expect(box()).toHaveAttribute('aria-expanded', 'false');
    // Tab means "I am done here" — the next control, not a commit on the way
    // past.
    expect(screen.getByRole('button', { name: 'Search' })).toHaveFocus();
  });
});

/* -------------------------------------------------------------------------
 * Choosing a row
 * ---------------------------------------------------------------------- */

describe('selecting a suggestion', () => {
  it('opens the campaign itself rather than searching for its title', async () => {
    suggestMock.mockResolvedValue(ALL);
    const user = mount();
    await search(user, 'games');

    await user.click(screen.getByRole('option', { name: /Oyun gecəsi dəsti/ }));

    // The same address `ProjectCard` builds: /projects/{creator}/{project}.
    expect(navigated).toEqual(['/en/projects/sound-lab/oyun-gecesi-desti']);
    expect(applied).toHaveLength(0);
  });

  it('applies the category filter rather than searching for the word', async () => {
    suggestMock.mockResolvedValue(ALL);
    const user = mount();
    await search(user, 'games');

    await user.click(screen.getByRole('option', { name: /Games\s*Category/ }));

    expect(lastApplied().categories).toEqual(['games']);
    // The text goes with the filter. Searching for "games" ranks campaigns that
    // mention the word; filtering by Games returns the campaigns that are one.
    expect(lastApplied().query).toBe('');
    expect(toHref(lastApplied())).toBe('/discover?category=games');
  });

  it('applies a subcategory without also applying its parent', async () => {
    suggestMock.mockResolvedValue(ALL);
    const user = mount();
    await search(user, 'games');

    await user.click(screen.getByRole('option', { name: /Tabletop games/ }));

    expect(lastApplied().subcategories).toEqual(['tabletop']);
    // The two filters are independent and AND'd server-side; adding the parent
    // as well would narrow the feed twice for one choice.
    expect(lastApplied().categories).toEqual([]);
    expect(toHref(lastApplied())).toBe('/discover?subcategory=tabletop');
  });

  it('applies a tag filter', async () => {
    suggestMock.mockResolvedValue(ALL);
    const user = mount();
    await search(user, 'games');

    await user.click(screen.getByRole('option', { name: /handmade/ }));

    expect(lastApplied().tags).toEqual(['handmade']);
    expect(toHref(lastApplied())).toBe('/discover?tag=handmade');
  });

  it('searches for what was typed when no option is active', async () => {
    suggestMock.mockResolvedValue(ALL);
    const user = mount();
    await search(user, 'games');

    await user.keyboard('{Enter}');

    expect(lastApplied().query).toBe('games');
    // `q` in the URL, under the service's own parameter name, so the searched
    // feed is linkable and comes back from the back button (D-12).
    expect(toHref(lastApplied())).toBe('/discover?q=games');
    expect(navigated).toHaveLength(0);
  });

  it('selects the active option with the keyboard alone', async () => {
    suggestMock.mockResolvedValue(ALL);
    const user = mount();
    await search(user, 'games');

    // Down twice: the campaign, then the category.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(lastApplied().categories).toEqual(['games']);
    expect(navigated).toHaveLength(0);
  });

  it('keeps the filters already applied when a search is submitted', async () => {
    const user = mount(parseFilters(new URLSearchParams('category=games&status=live')));

    await user.type(box(), 'ceramics{Enter}');

    // `?q=` composes with every filter server-side, so somebody who narrowed to
    // Games and then typed a word is narrowing what they were already reading.
    // Dropping their choices would be the search box undoing the panel beside
    // it.
    expect(lastApplied().query).toBe('ceramics');
    expect(lastApplied().categories).toEqual(['games']);
    expect(lastApplied().statuses).toEqual(['live']);
  });

  it('submits from the button as well as from the key', async () => {
    const user = mount();

    await user.type(box(), 'ceramics');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    // A control that only responds to Enter is unreachable for anybody who does
    // not know the key is there.
    expect(lastApplied().query).toBe('ceramics');
  });
});

/* -------------------------------------------------------------------------
 * What it says out loud
 * ---------------------------------------------------------------------- */

describe('announcements', () => {
  it('announces how many suggestions arrived', async () => {
    suggestMock.mockResolvedValue(ALL);
    const user = mount();

    await user.type(box(), 'games');

    await waitFor(() => expect(live()).toHaveTextContent('4 suggestions available.'));
  });

  it('announces that there are none, rather than saying nothing', async () => {
    suggestMock.mockResolvedValue([]);
    const user = mount();

    await user.type(box(), 'qwertyuiop');

    await waitFor(() => expect(live()).toHaveTextContent('No suggestions.'));
    // And says so on screen as well, with the way out of it.
    expect(screen.getByText(/No suggestions for “qwertyuiop”/)).toBeInTheDocument();
  });

  it('says a request is in flight rather than announcing a count it does not have', async () => {
    suggestMock.mockReturnValue(new Promise<readonly Suggestion[]>(() => {}));
    const user = mount();

    await user.type(box(), 'games');

    await waitFor(() => expect(live()).toHaveTextContent('Looking for suggestions.'));
  });
});

/* -------------------------------------------------------------------------
 * When the endpoint refuses
 * ---------------------------------------------------------------------- */

describe('a refusal', () => {
  const PROBLEM = new ApiError(400, {
    code: 'DISCOVERY_VALUE_UNKNOWN',
    title: 'That is not a value limit takes',
    detail: '“lots” is not a number.',
  });

  it("shows the service's own words, never a generic apology", async () => {
    suggestMock.mockRejectedValue(PROBLEM);
    const user = mount();

    await user.type(box(), 'ceramics');

    await waitFor(() => expect(screen.getByText(/“lots” is not a number\./)).toBeInTheDocument());
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it('announces the refusal rather than announcing no results', async () => {
    suggestMock.mockRejectedValue(PROBLEM);
    const user = mount();

    await user.type(box(), 'ceramics');

    // "No suggestions" would tell the reader their word matched nothing, when
    // in fact nothing was ever asked.
    await waitFor(() => expect(live()).toHaveTextContent('Suggestions are unavailable.'));
  });

  it('leaves the box able to submit what was typed', async () => {
    suggestMock.mockRejectedValue(PROBLEM);
    const user = mount();

    await user.type(box(), 'ceramics');
    await waitFor(() => expect(screen.getByText(/“lots” is not a number\./)).toBeInTheDocument());

    await user.keyboard('{Enter}');

    // A suggestion list that cannot be built is not a search that cannot be
    // run: the feed is a different endpoint.
    expect(lastApplied().query).toBe('ceramics');
  });

  it('offers no options to choose from when the list could not be built', async () => {
    suggestMock.mockRejectedValue(PROBLEM);
    const user = mount();

    await user.type(box(), 'ceramics');
    await waitFor(() => expect(screen.getByText(/“lots” is not a number\./)).toBeInTheDocument());

    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------
 * The typed value and the URL
 * ---------------------------------------------------------------------- */

describe('the typed value and the URL', () => {
  it('opens holding whatever the URL is searching for', () => {
    mount(parseFilters(new URLSearchParams('q=ceramics')));

    expect(box()).toHaveValue('ceramics');
  });

  it('follows the URL when it changes underneath — the back button', () => {
    const { rerender } = render(
      <SearchBox copy={COPY} filters={parseFilters(new URLSearchParams('q=ceramics'))} onApply={() => {}} />,
    );
    expect(box()).toHaveValue('ceramics');

    rerender(
      <SearchBox copy={COPY} filters={parseFilters(new URLSearchParams('q=pottery'))} onApply={() => {}} />,
    );

    expect(box()).toHaveValue('pottery');
  });

  it('does not write a keystroke to the URL', async () => {
    const user = mount();

    await user.type(box(), 'cera');
    await waitFor(() => expect(suggestMock).toHaveBeenCalled());

    // Every letter in the URL would be a history entry, and "back" would then
    // walk the reader through their own typing.
    expect(applied).toHaveLength(0);
  });
});
