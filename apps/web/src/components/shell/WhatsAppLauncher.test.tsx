import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import az from '../../../messages/az.json';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import tr from '../../../messages/tr.json';
import { SUPPORTED_LOCALES, type Locale } from '../../lib/i18n/locale';
import { whatsappCopyFrom, type WhatsAppCopy } from '../../lib/i18n/shell-copy';
import { WHATSAPP_CONTACT_NUMBER } from '../../lib/contact/whatsapp';
import { WhatsAppLauncher } from './WhatsAppLauncher';
import { expectNoViolations } from '../../test-axe';

/**
 * The floating WhatsApp control — the contact route that is on every page of the site.
 *
 * WHAT THESE COVER, and none of it is visible in a screenshot:
 *
 *   - **the dialog is not in the DOM until it is opened.** Three fields and two controls
 *     permanently mounted would be five tab stops on every route for everybody who never
 *     presses the button.
 *   - the trigger is icon-only and therefore has to carry a name, in every language.
 *   - focus moves into the panel on open and returns to the trigger on close, by all three
 *     routes out: Cancel, Escape and the backdrop.
 *   - **an incomplete form does not hand anything over.** Each empty field is named beside
 *     itself, and `window.open` is not called — a deep link built from a blank name is a
 *     message the recipient cannot answer.
 *   - the link carries the number and the typed text, encoded.
 *   - the panel afterwards **never claims the message was sent**, and keeps the link, because
 *     a browser that blocked the first open is otherwise silence.
 *   - the movement stops where `docs/motion-system.md` §5 gives the surface "None".
 */

const CATALOGUES: Record<Locale, typeof en> = { az, en, ru, tr };

/**
 * The copy the server would have resolved, built from the real catalogue by the function
 * `SiteShell` calls. Retyping the words here would pass whatever `messages/*.json` says.
 */
function copyFor(at: Locale): WhatsAppCopy {
  return whatsappCopyFrom((key) => {
    let node: unknown = CATALOGUES[at].shell;
    for (const segment of key.split('.')) {
      if (typeof node !== 'object' || node === null) throw new Error(`no message at shell.${key}`);
      node = (node as Record<string, unknown>)[segment];
    }
    if (typeof node !== 'string') throw new Error(`no message at shell.${key} in ${at}`);
    return node;
  });
}

const EN = copyFor('en');

/** Swapped per render, and read by the mocked router below. */
let pathname = '/discover';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => pathname,
  useParams: () => ({ locale: 'en' }),
}));

/**
 * jsdom implements `window.open` as a "not implemented" warning, so it is replaced rather than
 * spied on. The return value matters: `null` is what a blocked popup answers, and the panel's
 * fallback link is the thing that makes that case survivable.
 */
const opened = vi.fn<(...args: unknown[]) => Window | null>();

beforeEach(() => {
  pathname = '/discover';
  opened.mockReset();
  opened.mockReturnValue(null);
  vi.stubGlobal('open', opened);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const trigger = () => screen.getByRole('button', { name: EN.open });
/**
 * The dialog's scrim.
 *
 * Found by its fill rather than by `aria-hidden`, because the halo behind the floating control
 * is `aria-hidden` too and comes first in the document — a selector that asked only for that
 * clicked a decorative ring and asserted nothing.
 */
function backdrop(): Element {
  const found = Array.from(document.querySelectorAll('[aria-hidden="true"]')).find((element) =>
    (element.getAttribute('class') ?? '').includes('bg-black/60'),
  );
  if (found === undefined) throw new Error('no backdrop in the document');
  return found;
}


/**
 * By role and exact name rather than by `getByLabelText`.
 *
 * The trigger's own accessible name contains the word the message box is labelled with —
 * "Message us on WhatsApp" against "Message" — so a substring query matches a button as well
 * as the field, and matched two elements until this asked for a textbox by name.
 */
const field = (name: string) => screen.getByRole('textbox', { name });

async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(field(EN.fields.firstName), 'Aysel');
  await user.type(field(EN.fields.lastName), 'Mammadova');
  await user.type(field(EN.fields.message), 'Salam!');
}

describe('before it is opened', () => {
  it('is one control and no dialog', () => {
    render(<WhatsAppLauncher copy={EN} />);

    expect(trigger()).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it.each(SUPPORTED_LOCALES)('names the icon-only control in %s', (at) => {
    const copy = copyFor(at);
    render(<WhatsAppLauncher copy={copy} />);

    expect(screen.getByRole('button', { name: copy.open })).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<WhatsAppLauncher copy={EN} />);

    await expectNoViolations(container);
  });
});

describe('the dialog', () => {
  it('opens as a modal dialog with a name, and takes focus', async () => {
    const user = userEvent.setup();
    render(<WhatsAppLauncher copy={EN} />);

    await user.click(trigger());

    const dialog = screen.getByRole('dialog', { name: EN.title });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('says who presses send, before the fields rather than after them', async () => {
    const user = userEvent.setup();
    render(<WhatsAppLauncher copy={EN} />);
    await user.click(trigger());

    expect(screen.getByText(EN.intro)).toBeInTheDocument();
  });

  it('asks for a first name, a last name and a message', async () => {
    const user = userEvent.setup();
    render(<WhatsAppLauncher copy={EN} />);
    await user.click(trigger());

    for (const label of [EN.fields.firstName, EN.fields.lastName, EN.fields.message]) {
      expect(field(label)).toBeRequired();
    }
  });

  it('has no accessibility violations while open', async () => {
    const user = userEvent.setup();
    const { container } = render(<WhatsAppLauncher copy={EN} />);
    await user.click(trigger());

    await expectNoViolations(container);
  });

  it.each([
    ['the cancel control', async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('button', { name: EN.cancel }));
    }],
    ['Escape', async (user: ReturnType<typeof userEvent.setup>) => {
      await user.keyboard('{Escape}');
    }],
    ['the backdrop', async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(backdrop());
    }],
  ])('closes on %s and gives focus back to the control that opened it', async (_name, dismiss) => {
    const user = userEvent.setup();
    render(<WhatsAppLauncher copy={EN} />);
    await user.click(trigger());

    await dismiss(user);

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it('keeps what was typed when it is dismissed, so a mistaken Escape is not a lost paragraph', async () => {
    const user = userEvent.setup();
    render(<WhatsAppLauncher copy={EN} />);
    await user.click(trigger());
    await fillIn(user);

    await user.keyboard('{Escape}');
    await user.click(trigger());

    expect(field(EN.fields.message)).toHaveValue('Salam!');
  });
});

describe('an incomplete enquiry', () => {
  it('names every empty field and hands nothing over', async () => {
    const user = userEvent.setup();
    render(<WhatsAppLauncher copy={EN} />);
    await user.click(trigger());

    await user.click(screen.getByRole('button', { name: EN.submit }));

    expect(screen.getByText(EN.errors.firstName)).toBeInTheDocument();
    expect(screen.getByText(EN.errors.lastName)).toBeInTheDocument();
    expect(screen.getByText(EN.errors.message)).toBeInTheDocument();
    expect(opened).not.toHaveBeenCalled();
  });

  it('refuses whitespace, so a message cannot arrive signed by nobody', async () => {
    const user = userEvent.setup();
    render(<WhatsAppLauncher copy={EN} />);
    await user.click(trigger());

    await user.type(field(EN.fields.firstName), '   ');
    await user.type(field(EN.fields.lastName), 'Mammadova');
    await user.type(field(EN.fields.message), 'Salam!');
    await user.click(screen.getByRole('button', { name: EN.submit }));

    expect(screen.getByText(EN.errors.firstName)).toBeInTheDocument();
    expect(screen.queryByText(EN.errors.lastName)).toBeNull();
    expect(opened).not.toHaveBeenCalled();
  });

  it('marks the empty field as invalid rather than leaving the colour to say it', async () => {
    const user = userEvent.setup();
    render(<WhatsAppLauncher copy={EN} />);
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: EN.submit }));

    expect(field(EN.fields.firstName)).toHaveAttribute('aria-invalid', 'true');
    expect(field(EN.fields.firstName)).toHaveAccessibleDescription(EN.errors.firstName);
  });
});

describe('a complete enquiry', () => {
  const HREF = `https://wa.me/${WHATSAPP_CONTACT_NUMBER}?text=Aysel%20Mammadova%0A%0ASalam!`;

  it('opens the deep link in a tab that holds no handle on this one', async () => {
    const user = userEvent.setup();
    render(<WhatsAppLauncher copy={EN} />);
    await user.click(trigger());
    await fillIn(user);

    await user.click(screen.getByRole('button', { name: EN.submit }));

    expect(opened).toHaveBeenCalledWith(HREF, '_blank', 'noopener,noreferrer');
  });

  it('never says the message was sent, because this page did not send it', async () => {
    const user = userEvent.setup();
    render(<WhatsAppLauncher copy={EN} />);
    await user.click(trigger());
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: EN.submit }));

    expect(screen.getByText(EN.handoff.title)).toBeInTheDocument();
    expect(screen.getByText(EN.handoff.detail)).toBeInTheDocument();
  });

  it('keeps the same link as a real anchor, for the browser that blocked the first attempt', async () => {
    const user = userEvent.setup();
    render(<WhatsAppLauncher copy={EN} />);
    await user.click(trigger());
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: EN.submit }));

    const again = screen.getByRole('link', { name: EN.handoff.again });
    expect(again).toHaveAttribute('href', HREF);
    expect(again).toHaveAttribute('target', '_blank');
    expect(again).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('moves focus to that link, rather than dropping it with the submit control', async () => {
    const user = userEvent.setup();
    render(<WhatsAppLauncher copy={EN} />);
    await user.click(trigger());
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: EN.submit }));

    await waitFor(() =>
      expect(screen.getByRole('link', { name: EN.handoff.again })).toHaveFocus(),
    );
  });

  it('has no accessibility violations on the handoff panel', async () => {
    const user = userEvent.setup();
    const { container } = render(<WhatsAppLauncher copy={EN} />);
    await user.click(trigger());
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: EN.submit }));

    await expectNoViolations(container);
  });
});

describe('the movement', () => {
  /**
   * `docs/motion-system.md` §5 gives the campaign editor "None — autosave indicator only", and
   * the editor tabs carry this shell (#347). The control stays on those routes, because the way
   * to reach us should not disappear with the animation; what stops is the halo and the wave.
   */
  const classOf = (element: Element) => element.getAttribute('class') ?? '';

  /*
   * `getAttribute` rather than `className`, which on an SVG element is an `SVGAnimatedString`
   * and not a string at all — and every element is read rather than selected, because a CSS
   * attribute selector carrying an unbalanced `[` is not something to rely on jsdom parsing.
   */
  const animated = () =>
    Array.from(document.querySelectorAll('*')).filter((element) =>
      classOf(element).includes('animate-[whatsapp'),
    );

  it('runs where the surface has a motion budget', () => {
    render(<WhatsAppLauncher copy={EN} />);

    expect(animated().length).toBe(2);
  });

  it.each(['/projects/new', '/projects/7/edit/story', '/projects/7/edit'])(
    'stops on %s, where the budget is none',
    (at) => {
      pathname = at;
      render(<WhatsAppLauncher copy={EN} />);

      expect(animated()).toEqual([]);
      /* The control itself is still there — only the movement stopped. */
      expect(trigger()).toBeInTheDocument();
    },
  );

  it('asks for the movement only under motion-safe, so the preference removes it', () => {
    render(<WhatsAppLauncher copy={EN} />);

    for (const element of animated()) {
      expect(classOf(element)).toContain('motion-safe:animate-[whatsapp');
    }
  });
});
