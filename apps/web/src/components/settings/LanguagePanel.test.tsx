import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import messages from '@ideanest/messages/en.json';
import { authorizedFetch } from '../../lib/api/client';
import { LOCALE_COOKIE } from '../../lib/i18n/locale';
import { LanguagePanel, type LanguagePanelCopy } from './LanguagePanel';

/**
 * §4.2's P-10, language half — issue #280.
 *
 * WHAT THESE COVER:
 *
 *   - **the four languages are named in themselves.** The one reader this screen is hardest
 *     for is somebody stranded in a language they cannot read, and a translated language list
 *     is a dead end for exactly that person. The test asserts the endonyms rather than a
 *     count, because a list of four wrong names is also a list of four.
 *   - **a save writes both records.** `PATCH /v1/me/locale` is what the service composes mail
 *     from; the cookie is what a server render reads before the first byte. Either one alone
 *     is a preference that half works, and only the pair is testable evidence that it does
 *     not.
 *   - **a failed save says so with an icon and never with lime.** docs/ui-kit.md §9.2 — colour
 *     alone carries nothing — and §8.1: lime means "act now", so a lime error reads as a call
 *     to action. The test asserts the absence as well as the presence, because the failure it
 *     is guarding against is a token swapped in a later refactor.
 *   - **the field's wiring comes from the primitive.** A hint the assistive layer never
 *     reaches is decoration (§7.13), so the hint is asserted through `aria-describedby` rather
 *     than through the text being on screen.
 *   - **the currency is stated and not offered**, which is the honest half of the issue.
 *
 * THE COPY COMES FROM THE REAL CATALOGUE rather than from fixtures invented here. The panel
 * takes its strings as props, so a test that made them up would still pass after somebody
 * deleted `settings.language` from `messages/en.json` — and the page that does the lookup
 * would be the thing that broke.
 */

const language = messages.settings.language;

const COPY: LanguagePanelCopy = {
  fieldLabel: language.fieldLabel,
  fieldHint: language.fieldHint,
  save: language.save,
  saving: messages.common.saving,
  saved: language.saved,
  failed: language.failed,
};

const refresh = vi.fn();

vi.mock('next/navigation', async (importOriginal) => ({
  /*
   * Spread first so the real module's other exports survive. `i18n/navigation.ts`
   * builds its wrappers at import time and reads `redirect` and `permanentRedirect`
   * while doing so, and a factory that replaced the module wholesale left those
   * undefined — which failed as a TypeError inside next-intl rather than anywhere
   * near the test that caused it.
   */
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh }),
}));

vi.mock('../../lib/api/client', () => ({
  authorizedFetch: vi.fn(),
}));

const fetchMock = vi.mocked(authorizedFetch);

/** A 204, which is what `LocalePreferenceController` answers and carries no body. */
function noContent(): Response {
  return new Response(null, { status: 204 });
}

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(noContent());
  document.cookie = `${LOCALE_COOKIE}=; Path=/; Max-Age=0`;
});

afterEach(cleanup);

function renderPanel(serverLocale: 'az' | 'en' | 'ru' | 'tr' = 'en') {
  return render(<LanguagePanel copy={COPY} serverLocale={serverLocale} />);
}

function control(): HTMLSelectElement {
  return screen.getByLabelText(language.fieldLabel);
}

describe('the control', () => {
  it('names every language in itself, never in the language on screen', () => {
    renderPanel();

    const options = within(control()).getAllByRole('option');

    expect(options.map((option) => option.textContent)).toEqual([
      'Azərbaycan dili',
      'English',
      'Русский',
      'Türkçe',
    ]);
  });

  it('tags each option with its own language, so it is pronounced as one', () => {
    renderPanel();

    const options = within(control()).getAllByRole('option');

    expect(options.map((option) => option.getAttribute('lang'))).toEqual(['az', 'en', 'ru', 'tr']);
  });

  it('opens on the language the server drew the page in', () => {
    renderPanel('ru');

    expect(control()).toHaveValue('ru');
  });

  it('is a native select, which is what carries type-ahead and the platform picker', () => {
    renderPanel();

    expect(control().tagName).toBe('SELECT');
  });
});

describe('the field wiring', () => {
  it('takes its accessible name from the label', () => {
    renderPanel();

    expect(control()).toHaveAccessibleName(language.fieldLabel);
  });

  it('points aria-describedby at the hint rather than leaving it on screen only', () => {
    renderPanel();

    const described = control().getAttribute('aria-describedby');
    expect(described).not.toBeNull();

    const hint = document.getElementById(described ?? '');
    expect(hint).not.toBeNull();
    expect(hint).toHaveTextContent(language.fieldHint);
  });

  it('is not marked invalid before anything has gone wrong', () => {
    renderPanel();

    expect(control()).not.toHaveAttribute('aria-invalid');
  });
});

describe('saving a language', () => {
  async function choose(
    user: ReturnType<typeof userEvent.setup>,
    locale: string,
  ): Promise<void> {
    await user.selectOptions(control(), locale);
    await user.click(screen.getByRole('button', { name: language.save }));
  }

  it('sends the chosen tag to PATCH /v1/me/locale', async () => {
    const user = userEvent.setup();
    renderPanel();

    await choose(user, 'az');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/v1/me/locale', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: 'az' }),
    });
  });

  it('remembers the choice in the cookie a server render reads', async () => {
    const user = userEvent.setup();
    renderPanel();

    await choose(user, 'ru');

    await waitFor(() => expect(document.cookie).toContain(`${LOCALE_COOKIE}=ru`));
  });

  it('re-renders the route, so the page is redrawn in the language just chosen', async () => {
    const user = userEvent.setup();
    renderPanel();

    await choose(user, 'tr');

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('confirms in a live region, with an icon and never with lime', async () => {
    const user = userEvent.setup();
    renderPanel();

    await choose(user, 'az');

    const region = await screen.findByRole('status');
    expect(region).toHaveTextContent(language.saved);
    // Colour + icon, never colour alone (§9.2).
    expect(region.querySelector('svg')).not.toBeNull();
    // Lime says "act now". A saved preference is the opposite of an outstanding task (§8.1).
    expect(region.innerHTML).not.toContain('lime');
    expect(region.innerHTML).toContain('success');
  });

  it('says nothing about the last save once a different language is picked', async () => {
    const user = userEvent.setup();
    renderPanel();

    await choose(user, 'az');
    expect(await screen.findByText(language.saved)).toBeInTheDocument();

    await user.selectOptions(control(), 'ru');

    expect(screen.queryByText(language.saved)).not.toBeInTheDocument();
  });
});

describe('when the save fails', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
  });

  it('shows the sentence that says what to do, as an assertive alert with an icon', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.selectOptions(control(), 'ru');
    await user.click(screen.getByRole('button', { name: language.save }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(language.failed);
    expect(alert.querySelector('svg')).not.toBeNull();
  });

  it('marks the failure with --danger and never with lime', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.selectOptions(control(), 'ru');
    await user.click(screen.getByRole('button', { name: language.save }));

    const alert = await screen.findByRole('alert');
    expect(alert.innerHTML).toContain('danger');
    expect(alert.innerHTML).not.toContain('lime');
  });

  it('does not remember a language the account never accepted', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.selectOptions(control(), 'ru');
    await user.click(screen.getByRole('button', { name: language.save }));

    await screen.findByRole('alert');
    expect(document.cookie).not.toContain(`${LOCALE_COOKIE}=ru`);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not claim success as well', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.selectOptions(control(), 'ru');
    await user.click(screen.getByRole('button', { name: language.save }));

    await screen.findByRole('alert');
    expect(screen.queryByText(language.saved)).not.toBeInTheDocument();
  });
});

describe('the currency', () => {
  /*
   * IT USED TO BE STATED HERE, AND THE TWO TESTS THAT ASSERTED SO ARE GONE WITH IT — #327.
   *
   * They were right at the time: #280 rendered the currency as a sentence because §21.2's
   * display currency needs a rate source and the service had none, so "a selector here would
   * offer to convert manat into manat". #327 built the source, and the control moved to
   * `CurrencyPanel` — which has its own tests, including the one that keeps #280's argument
   * alive: a platform with nothing to offer draws a sentence rather than a `<select>` with a
   * single option.
   *
   * What is asserted here now is only that this panel has stopped claiming to own the
   * subject. A form that grew a second field would be one Save over two unrelated writes.
   */
  it('is no longer this panel\u2019s subject', () => {
    renderPanel();

    const comboboxes = screen.getAllByRole('combobox');
    expect(comboboxes).toHaveLength(1);
    expect(comboboxes[0]).toHaveAccessibleName(language.fieldLabel);
  });
});
