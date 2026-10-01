'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from '../../i18n/navigation';
import { Search } from 'lucide-react';
import { Combobox, Pill, type ComboboxOption } from '@ideanest/ui';
import type { ApiError } from '../../lib/api/problem';
import { addSlugFilter, withQuery, type DiscoveryFilters } from '@ideanest/discovery/filters';
import { suggestionId, type Suggestion } from '../../lib/discovery/suggest';
import type { SuggestCopy } from '../../lib/i18n/feed-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useSuggestions } from '../../lib/discovery/useSuggestions';

/**
 * D-01's search box and D-02's autocomplete, on the discovery feed.
 *
 * THE TYPED VALUE AND THE URL ARE TWO DIFFERENT THINGS, on purpose. What is in
 * the box is a draft: it changes on every keystroke and means nothing to the
 * feed until it is submitted. What is in the URL is the search: it is what the
 * feed is showing, what a shared link carries, and what the back button
 * restores. Sending every keystroke to the URL would put a history entry behind
 * each letter — "back" would then walk the reader through their own typing —
 * and would refetch the feed six times for one word.
 *
 * The draft is re-seeded from the URL whenever the URL's query changes, so a
 * back press or a shared link opens with the box holding what the feed is
 * actually showing rather than the last thing this session typed.
 *
 * WHAT SELECTING A ROW DOES DEPENDS ON THE ROW, which is the whole reason the
 * endpoint sends a kind per row (`Suggestion.Kind`):
 *
 *   campaign     open that campaign. The reader found the thing they were
 *                looking for; making them read a one-result feed first is a
 *                step with nothing in it.
 *   category     apply the category filter that #45 already implements, and
 *   subcategory  clear the search text. Searching for the word "games" ranks
 *   tag          campaigns that happen to contain it; filtering by the Games
 *                category returns the campaigns that ARE games. The reader
 *                picked the row that says "Category", so they get the filter.
 *   plain text   search for what was typed.
 *
 * A FAILED SUGGESTION REQUEST IS NOT A BROKEN SEARCH BOX. The refusal is shown
 * in the reader's way — in the service's own words, never a generic apology
 * (§10.4) — and Enter still submits what was typed, because the feed is a
 * different endpoint and there is no reason it should be unreachable.
 *
 * MOTION: none. docs/motion-system.md §5.1 gives Discovery's filter rail "150ms
 * colour only", because "a panel that animates while somebody is using it is a
 * panel that is slower to use". A list read between two keystrokes is that
 * panel with less time to spare.
 */

export interface SearchBoxProps {
  filters: DiscoveryFilters;
  /** Writes the next filter set to the URL — `DiscoveryView`'s `apply`. */
  onApply: (next: DiscoveryFilters) => void;
  /** Every word this control draws — see `lib/i18n/feed-copy.ts`. */
  copy: SuggestCopy;
}

/**
 * The service's own words for a refusal.
 *
 * Never a generic message: the endpoint knows why it refused and this function
 * does not. When there is no problem body at all the request never reached the
 * service, and saying so is more useful than inventing a reason.
 */
function describeFailure(error: ApiError | null, copy: SuggestCopy): string {
  const detail = error?.problem?.detail ?? error?.problem?.title ?? null;
  return detail === null
    ? copy.failedFallback
    : fillPlaceholders(copy.failedDetail, { detail });
}

function toOption(suggestion: Suggestion, copy: SuggestCopy): ComboboxOption {
  return {
    id: suggestionId(suggestion),
    label: suggestion.label,
    /* A kind this build has no word for is better unlabelled than labelled `subcategory`. */
    kind: copy.kinds[suggestion.kind] ?? suggestion.kind,
  };
}

export function SearchBox({ filters, onApply, copy }: SearchBoxProps) {
  const router = useRouter();

  const [draft, setDraft] = useState(filters.query);
  const [open, setOpen] = useState(false);

  // The URL is the truth about what the feed is showing; the draft follows it
  // when it changes from outside — the back button, or a link opened fresh.
  useEffect(() => {
    setDraft(filters.query);
  }, [filters.query]);

  const suggestions = useSuggestions(draft);

  const options = useMemo(
    () => suggestions.items.map((suggestion) => toOption(suggestion, copy)),
    [suggestions.items, copy],
  );

  const byId = useMemo(() => {
    const map = new Map<string, Suggestion>();
    for (const suggestion of suggestions.items) map.set(suggestionId(suggestion), suggestion);
    return map;
  }, [suggestions.items]);

  function submit(text: string) {
    setOpen(false);
    onApply(withQuery(filters, text));
  }

  function select(option: ComboboxOption) {
    const suggestion = byId.get(option.id);
    // A row with nothing behind it can only mean the list changed underneath
    // the press. Searching for its label is what the reader would have got by
    // pressing Enter, and is never wrong — only less specific.
    if (suggestion === undefined) {
      submit(option.label);
      return;
    }

    setOpen(false);

    switch (suggestion.kind) {
      case 'campaign': {
        /*
         * `parentSlug` is the creator slug, and a project lives at
         * `/projects/{creator}/{project}` — the same URL `ProjectCard` builds.
         * Without it there is no address to go to, so the label is searched for
         * instead rather than a broken link being followed.
         */
        if (suggestion.parentSlug == null) {
          submit(suggestion.label);
          return;
        }
        router.push(
          `/projects/${encodeURIComponent(suggestion.parentSlug)}/${encodeURIComponent(suggestion.slug)}`,
        );
        return;
      }
      case 'category':
      case 'subcategory':
      case 'tag':
        /*
         * The text goes with the filter. `?q=games&category=games` narrows
         * twice for one choice — first to campaigns mentioning the word, then
         * to campaigns filed under it — and the second is what the reader asked
         * for by picking the row labelled "Category".
         */
        onApply(addSlugFilter(withQuery(filters, ''), suggestion.kind, suggestion.slug));
        return;
    }
  }

  const message =
    suggestions.status === 'loading'
      ? copy.looking
      : suggestions.status === 'failed'
        ? describeFailure(suggestions.error, copy)
        : suggestions.status === 'ready' && options.length === 0
          ? fillPlaceholders(copy.none, { query: draft.trim() })
          : undefined;

  /*
   * The announcement is the count, except where the count would be a lie: while
   * a request is in flight there is no count yet, and a refusal has to say so
   * rather than announce "no suggestions" — which would tell the reader their
   * word matched nothing when in fact nothing was asked.
   */
  const announcement =
    suggestions.status === 'loading'
      ? copy.lookingAnnounce
      : suggestions.status === 'failed'
        ? copy.unavailableAnnounce
        : undefined;

  return (
    <form
      role="search"
      aria-label={copy.formLabel}
      className="flex items-start gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit(draft);
      }}
    >
      <Combobox
        className="min-w-0 flex-1"
        value={draft}
        onValueChange={(next) => {
          setDraft(next);
          setOpen(true);
        }}
        options={options}
        open={open}
        onOpenChange={setOpen}
        onSelect={select}
        onSubmit={submit}
        listboxLabel={copy.listboxLabel}
        message={message}
        announcement={announcement}
        leading={<Search />}
        aria-label={copy.inputLabel}
        placeholder={copy.placeholder}
      />

      {/*
        A real submit button, not a decoration. Enter is handled by the
        combobox, but a control that only responds to a key is unreachable on
        a touch keyboard that has no visible Enter and by anybody who does not
        know the key is there.
      */}
      <Pill type="submit" variant="ghost" className="h-11 shrink-0">
        {copy.submit}
      </Pill>
    </form>
  );
}
