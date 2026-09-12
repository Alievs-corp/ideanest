'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Field,
  InlineAlert,
  Pill,
  TextInput,
  Textarea,
  cn,
  useBackdropDismiss,
  useDismiss,
  useFocusTrap,
  useScrollLock,
} from '@ideanest/ui';
import { usePathname } from '../../i18n/navigation';
import {
  MESSAGE_MAX_LENGTH,
  missingFields,
  whatsappHref,
  type EnquiryField,
} from '../../lib/contact/whatsapp';
import type { WhatsAppCopy } from '../../lib/i18n/shell-copy';

/**
 * The floating WhatsApp control, and the enquiry form behind it.
 *
 * <h2>What pressing send does, and what it does not</h2>
 *
 * It opens WhatsApp with the message written and waiting, and the visitor presses send there.
 * `lib/contact/whatsapp.ts` carries the reasoning — the short version is that this needs no
 * credential and the reply goes back to a person, because the message is sent from the
 * visitor's own number.
 *
 * **So this component never says "sent".** The handoff panel says WhatsApp is open and that
 * nothing has left this page, and it keeps the link on screen: a browser that refused the
 * `window.open` is otherwise a form that swallowed somebody's message in silence, and the
 * second press is a real anchor, which no popup blocker stops.
 *
 * <h2>Why the panel is dark when §7.14 says a modal is white</h2>
 *
 * Because the kit's form controls are not. `inputSkin` fills a field with `--surface-3` and
 * `Field` draws its label in `--text-primary`; both on white are invisible, and §7.14's own
 * "inside a modal use `text-on-white`" has no `on-white` variant of `TextInput`, `Textarea` or
 * `Field` to be applied through. A white panel here would mean adding those variants to the
 * kit, which is a change to the kit rather than to this feature. `ReportControl` reached the
 * same wall and resolved it the same way, and the two dialogs look alike as a result.
 *
 * <h2>Motion</h2>
 *
 * The halo and the glyph's wave are CSS keyframes in `app/globals.css`, which explains why
 * they are written rather than imported and why the ring moves while the button stays put.
 *
 * **`docs/motion-system.md` §5 gives the site shell a budget of one animation** — §4.7's
 * collapse — "paid on all of them at once" because the shell is on every route. A control that
 * pulses is a second one, and that is a decision the budget does not currently authorise. Two
 * things keep the cost where the table can see it:
 *
 *   - It stops where the budget is zero. `/projects/new` and the six editor tabs take
 *     `SiteShell` (#347) and are given "None — autosave indicator only"; a halo pulsing beside
 *     a creator who has been writing for an hour is exactly what that row refuses. The control
 *     stays, still, because the way to reach us should not disappear with the animation.
 *   - The checkout never sees it at all, because `/projects/[id]/back` does not carry this
 *     shell. §5's "motion decreases as money gets closer" is kept by the route table rather
 *     than by a condition here.
 */

export interface WhatsAppLauncherProps {
  /** Resolved on the server by `SiteShell` — `lib/i18n/shell-copy.ts` explains why. */
  readonly copy: WhatsAppCopy;
}

/**
 * The surfaces whose motion budget is "None", and which still carry this shell.
 *
 * `docs/motion-system.md` §5: the campaign editor gets the autosave indicator and nothing
 * else, for a reason it states plainly — creators spend hours in it.
 */
function movementIsBudgeted(pathname: string): boolean {
  return !(pathname === '/projects/new' || /^\/projects\/[^/]+\/edit(\/|$)/u.test(pathname));
}

export function WhatsAppLauncher({ copy }: WhatsAppLauncherProps) {
  const pathname = usePathname();
  const panel = useRef<HTMLDivElement>(null);
  const handoffLink = useRef<HTMLAnchorElement>(null);

  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [message, setMessage] = useState('');
  const [missing, setMissing] = useState<readonly EnquiryField[]>([]);
  /** The link that was handed over, kept so it can be followed again. */
  const [handoff, setHandoff] = useState<string | null>(null);

  /*
   * What a dismissal clears, and what it keeps. The refusals and the handoff go: both are
   * answers to a press, and neither is true of the next time the dialog is opened. THE THREE
   * FIELDS STAY. Escape is one keystroke away from the message box, and a dialog that empties
   * itself on a mistaken press is a paragraph somebody has to type again.
   */
  const close = useCallback(() => {
    setOpen(false);
    setMissing([]);
    setHandoff(null);
  }, []);

  useDismiss({ open, onDismiss: close });
  useScrollLock(open);
  useFocusTrap(open, panel);
  const backdrop = useBackdropDismiss(true, close);

  /*
   * The form is replaced by the handoff panel, so the control that was focused is unmounted
   * mid-press. Without this, focus falls to the body: a keyboard reader is dropped at the top
   * of the document holding a dialog they cannot read, and the one thing worth reaching — the
   * link, for when the browser blocked the first attempt — is the thing they have lost.
   */
  useEffect(() => {
    if (handoff !== null) handoffLink.current?.focus();
  }, [handoff]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const enquiry = { firstName, lastName, message };
    const empty = missingFields(enquiry);
    setMissing(empty);
    if (empty.length > 0) return;

    const href = whatsappHref(enquiry);
    setHandoff(href);

    /*
     * Inside the submit handler, which is what keeps this a user gesture and therefore
     * allowed. `noopener` and `noreferrer` because the opened tab has no business holding a
     * handle on this one. A blocked open answers `null` and is not an error path: the panel
     * below renders the same link for the reader to follow themselves.
     */
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  const errorFor = (field: EnquiryField): string | undefined =>
    missing.includes(field) ? copy.errors[field] : undefined;

  return (
    <>
      {/*
        A `div` rather than a fragment because the halo has to be positioned against the
        control, and `fixed` on both would put the animation's geometry in two places.
        `pointer-events-none` on the wrapper and back on for the button, so a decorative ring
        expanding past the control never eats a click meant for the page underneath it.

        Below the mobile drawer (z 60) and the dialogs (z 70), above everything else.
      */}
      <div
        className="pointer-events-none fixed right-5 bottom-5 z-[55] grid size-14 place-items-center md:right-6 md:bottom-6"
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-0 rounded-full bg-white/24',
            movementIsBudgeted(pathname) &&
              'motion-safe:animate-[whatsapp-halo_2.4s_ease-out_infinite]',
            /*
              Still, and therefore invisible, where the budget is zero. `opacity-0` rather
              than unmounting it: the element is decoration either way, and one class is easier
              to read than a branch.
            */
            !movementIsBudgeted(pathname) && 'opacity-0',
          )}
        />

        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={copy.open}
          title={copy.open}
          className={cn(
            'pointer-events-auto relative grid size-14 place-items-center rounded-full',
            /*
              White with a near-black glyph. §2.5: white is what floats above the system, and
              §3 gives the only shadow in the system to the things that genuinely do. Lime was
              the other candidate and is wrong — it means "act now" (§2.2), and a contact
              control is available rather than urgent.
            */
            'bg-white text-on-white shadow-float',
            'transition-colors duration-150 ease-in-out hover:bg-[var(--white-muted)]',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]',
          )}
        >
          <WhatsAppGlyph
            className={cn(
              'size-7',
              movementIsBudgeted(pathname) &&
                'motion-safe:animate-[whatsapp-wave_6s_ease-in-out_infinite]',
            )}
          />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4">
          {/*
            `aria-hidden`, so it is not in the accessibility tree and the click on it is a
            convenience rather than a control — every route out of this dialog exists twice
            (Escape, and the Cancel below). `useBackdropDismiss` is what makes a press that
            STARTED inside the panel and ended out here not a dismissal: selecting a sentence
            in the message box and releasing past the edge would otherwise throw it away.
          */}
          <div
            aria-hidden="true"
            onMouseDown={backdrop.onMouseDown}
            onClick={backdrop.onClick}
            className="absolute inset-0 bg-black/60 motion-safe:animate-[dialog-backdrop_200ms_ease-out]"
          />

          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={copy.title}
            tabIndex={-1}
            className={cn(
              'relative flex w-full max-w-[32rem] flex-col gap-5',
              'max-h-[85vh] overflow-y-auto rounded-2xl border border-white/8 bg-surface-2 p-6 sm:p-8',
              'motion-safe:animate-[dialog-panel_200ms_ease-out]',
            )}
          >
            <h2 className="flex items-center gap-2.5 text-lg font-medium tracking-[-0.02em] text-white">
              <WhatsAppGlyph className="size-5 shrink-0" />
              {copy.title}
            </h2>

            {handoff === null ? (
              <form onSubmit={submit} noValidate className="flex flex-col gap-5">
                {/*
                  `noValidate` for the reason `SignInForm` gives: the browser's own bubble is
                  not this system's error treatment. It disappears on the next keystroke and is
                  invisible to a screen reader that is not focused on the control, while
                  `Field` puts the sentence beside the field and wires it up.
                */}
                <p className="text-[15px] leading-relaxed text-white/64">{copy.intro}</p>

                <Field label={copy.fields.firstName} required error={errorFor('firstName')}>
                  <TextInput
                    name="firstName"
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                  />
                </Field>

                <Field label={copy.fields.lastName} required error={errorFor('lastName')}>
                  <TextInput
                    name="lastName"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                  />
                </Field>

                <Field label={copy.fields.message} required error={errorFor('message')}>
                  {/*
                    The cap is the field's, not a warning after the fact: the text travels in
                    a URL, and `lib/contact/whatsapp.ts` explains that where a browser stops
                    reading one is neither specified nor consistent.
                  */}
                  <Textarea
                    name="message"
                    rows={4}
                    maxLength={MESSAGE_MAX_LENGTH}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                  />
                </Field>

                <div className="flex flex-wrap gap-3">
                  <Pill type="submit" iconLeft={<WhatsAppGlyph className="size-4 shrink-0" />}>
                    {copy.submit}
                  </Pill>
                  <Pill type="button" variant="ghost" onClick={close}>
                    {copy.cancel}
                  </Pill>
                </div>
              </form>
            ) : (
              <div className="flex flex-col gap-5">
                {/*
                  `info` and not `success`. Nothing has been sent — the visitor presses send in
                  WhatsApp — and an interface that claimed otherwise would be claiming something
                  it cannot know. §2.4: lime is not success either, and success is not this.
                */}
                <InlineAlert variant="info" title={copy.handoff.title}>
                  <p>{copy.handoff.detail}</p>
                </InlineAlert>

                <div className="flex flex-wrap items-center gap-3">
                  {/*
                    A REAL ANCHOR, and that is the point of it. This is the way through for a
                    browser that blocked the `window.open`, and a second scripted attempt would
                    be blocked for the same reason. A plain link click never is. It carries the
                    kit's primary-pill treatment by hand because `Pill` renders a `<button>`,
                    and a button inside a link is neither.
                  */}
                  <a
                    ref={handoffLink}
                    href={handoff}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      'inline-flex h-10 items-center justify-center gap-2 rounded-full px-[18px]',
                      'bg-white text-sm font-medium tracking-[-0.01em] text-on-white',
                      'transition-colors duration-150 ease-in-out hover:bg-[var(--white-muted)]',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]',
                    )}
                  >
                    <WhatsAppGlyph className="size-4 shrink-0" />
                    {copy.handoff.again}
                  </a>

                  <Pill type="button" variant="ghost" onClick={close}>
                    {copy.cancel}
                  </Pill>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The WhatsApp mark, as one path.
 *
 * `aria-hidden` in every position it appears in: beside the dialog's heading and inside the
 * submit pill it duplicates words that are already there, and on the floating control the
 * accessible name is the button's `aria-label` (§9.2 — an icon-only control needs a name, and
 * a name on both the button and its glyph is the name read twice).
 *
 * `currentColor`, so the one glyph is near-black on the white control and white inside the
 * dialog's heading without a second copy of the path or a colour of its own.
 */
function WhatsAppGlyph({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.966 1.164-.199.198-.397.223-.694.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.05-.52-.099-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.885 9.888-9.885 2.641 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}
