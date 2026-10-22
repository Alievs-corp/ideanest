'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Field, InlineAlert, Pill, TextInput } from '@ideanest/ui';
import { listUsers, type AdminUser } from '../../lib/admin/api';
import { consoleMessageFor, shortId, wasAborted } from '../../lib/admin/refusals';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { AccountPickerCopy } from '../../lib/i18n/admin/people-copy';

/**
 * Finds the account a form is about, by name or address — issue #402.
 *
 * <h2>The dead end this removes</h2>
 *
 * `/admin/staff` asks for a full account identifier and its help text names where to get
 * one: "from the account directory". `/admin/users` <em>is</em> the account directory, and
 * it rendered no identifier anywhere in a row, had no copy control and no link. So the
 * identifier the form required was not obtainable from the screen the form named, and the
 * only routes to it were the database or the API. Granting a staff role could not be
 * completed inside the console at all.
 *
 * <p>#402 offers two ways out and says which to do first: make every identifier copyable, or
 * replace the fields with a search-and-pick control. Both are here, and this is the second —
 * for the one field where it is not optional, because a role grant is the workflow that was
 * impossible rather than merely tedious.
 *
 * <h2>Why here and not on the other five fields</h2>
 *
 * <p>Because the account directory is searchable and the campaign directory is not. Search
 * over campaigns is #404's, and building half a picker over a list that only pages would be
 * a control that looks like it can find things and cannot. Those five fields keep their text
 * input and gain a copy control on the screen that supplies the identifier, which is #402's
 * own first choice.
 *
 * <h2>Searching is an audited read, so it happens when asked</h2>
 *
 * <p>`GET /v1/admin/users` hands over email addresses and writes an
 * {@code ACCOUNTS_SEARCHED} row for every call. A search-as-you-type control would put one
 * of those in the audit trail per keystroke, on the one table with no retention rule — so
 * this searches when the reader submits, and says so. That is also why the field is a plain
 * text input rather than a `Combobox`: the kit's combobox is an as-you-type control, and
 * dressing a deliberate search as one would be a promise the audit rule cannot keep.
 *
 * <h2>What it hands back</h2>
 *
 * <p>The whole account, not the identifier. The caller renders the name it picked, so the
 * confirmation of "who am I about to make an administrator" is a person rather than
 * thirty-six characters that were correct when they were pasted.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5: an administrative surface gets 150ms of colour on a control and
 * nothing that moves. This one decides who may move money.
 */
export interface AccountPickerProps {
  /** Whoever is chosen, or null. The caller owns the value; this only offers candidates. */
  readonly chosen: AdminUser | null;
  readonly onChoose: (account: AdminUser | null) => void;
  readonly copy: AccountPickerCopy;
  /** Disabled while the form around it is writing. */
  readonly disabled?: boolean;
  readonly className?: string;
}

/** Enough rows to recognise somebody among namesakes, few enough to read without scrolling. */
const RESULT_LIMIT = 8;

export function AccountPicker({
  chosen,
  onChoose,
  copy,
  disabled = false,
  className,
}: AccountPickerProps) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<readonly AdminUser[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const hintId = useId();

  /*
   * The form around the picker clears the choice after it has used it — a role granted, a
   * partner added, a filter reset. The last search's results used to come straight back when
   * it did, a list of accounts under a form that had just finished with one. Adjusted during
   * render rather than in an effect, so the stale list is never painted.
   */
  const [lastChosen, setLastChosen] = useState(chosen);
  if (lastChosen !== chosen) {
    setLastChosen(chosen);
    if (chosen === null) {
      setResults(null);
      setTerm('');
    }
  }

  // A search left running past the form is a request nobody is waiting for and an audit row
  // for a question nobody asked.
  useEffect(() => () => inFlight.current?.abort(), []);

  async function search(): Promise<void> {
    const query = term.trim();
    if (query === '') return;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setSearching(true);
    setError(null);
    try {
      const page = await listUsers({ query, signal: controller.signal });
      if (controller.signal.aborted) return;
      /*
       * The first few of the directory's own page, not a page size of this control's
       * choosing. `listUsers` sends `DIRECTORY_PAGE_SIZE` and derives the cursor from it,
       * so asking for a shorter page here would be asking the service for a cursor that
       * meant something different. Trimming the answer is this control's business:
       * twenty-five candidates is a list somebody scrolls, and a search that returns
       * twenty-five is a search that should be narrowed rather than read.
       */
      setResults(page.users.slice(0, RESULT_LIMIT));
    } catch (cause) {
      if (controller.signal.aborted || wasAborted(cause)) return;
      setError(consoleMessageFor(cause, copy.subject, copy.refusals));
      setResults(null);
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  if (chosen !== null) {
    return (
      <div className={className}>
        <p className="text-xs text-fg-48">{copy.label}</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-fg">
          {chosen.name}
          <span className="text-xs text-fg-48">{chosen.email}</span>
          <span className="font-mono text-xs text-fg-40" title={chosen.id}>
            {shortId(chosen.id)}
          </span>
        </p>
        <Pill
          variant="ghost"
          size="sm"
          className="mt-2"
          disabled={disabled}
          onClick={() => {
            onChoose(null);
            setResults(null);
            setTerm('');
          }}
        >
          {copy.change}
        </Pill>
      </div>
    );
  }

  return (
    <div className={className}>
      {/*
        The hint under the row rather than inside the field: inside, it pushed the field's
        bottom edge down and the search button, aligned to the row's end, hung beside the
        hint instead of the input it belongs to.
      */}
      <div className="flex flex-wrap items-end gap-3">
        <Field label={copy.label} className="min-w-[240px] flex-1">
          <TextInput
            value={term}
            aria-describedby={hintId}
            onChange={(event) => setTerm(event.target.value)}
            /*
             * Enter searches rather than submitting the form around it. Without this a
             * reader who types a name and presses Enter grants a role to nobody, which is
             * a confusing failure on a form whose successful outcome is a privileged act.
             */
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void search();
              }
            }}
            autoComplete="off"
          />
        </Field>
        <Pill
          variant="outline"
          className="mb-0.5"
          disabled={disabled || searching || term.trim() === ''}
          onClick={() => void search()}
        >
          {searching ? copy.searching : copy.search}
        </Pill>
      </div>
      <p id={hintId} className="mt-2 text-xs text-fg-48">
        {copy.hint}
      </p>

      {error && (
        <InlineAlert variant="danger" title={copy.failedTitle} className="mt-3">
          {error}
        </InlineAlert>
      )}

      {results !== null && results.length === 0 && (
        <p className="mt-3 text-sm text-fg-48">
          {fillPlaceholders(copy.noneFound, { term: term.trim() })}
        </p>
      )}

      {results !== null && results.length > 0 && (
        <ul className="mt-3 flex list-none flex-col gap-2" aria-label={copy.resultsLabel}>
          {results.map((account) => (
            <li key={account.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChoose(account)}
                className="w-full rounded-lg border border-fg/8 bg-surface-1 p-3 text-left transition-colors duration-150 ease-in-out hover:border-fg/16 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
              >
                <span className="block text-sm text-fg">{account.name}</span>
                <span className="mt-0.5 block text-xs text-fg-48">
                  {account.email}
                  {/*
                    The identifier is on the row it belongs to rather than only inside the
                    request. Somebody who wanted it for a different screen can read it here
                    without picking anybody, which is the other half of #402.
                  */}
                  <span className="ml-2 font-mono text-fg-40" title={account.id}>
                    {shortId(account.id)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
