'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Users } from 'lucide-react';
import {
  CharacterCount,
  Field,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
  Textarea,
  TextInput,
} from '@ideanest/ui';
import { Modal } from '@ideanest/ui/motion';
import {
  getPrelaunchPage,
  openPrelaunch,
  patchProject,
  type CoverImage,
  type ProjectEdit,
  type ProjectPatch,
  type ProjectState,
} from '../../lib/projects/api';
import {
  BLURB_MAX_CHARACTERS,
  TITLE_MAX_CHARACTERS,
  characterCount,
  draftFromProject,
  isBasicsField,
  patchForField,
  validateBasics,
  type BasicsDraft,
  type BasicsErrors,
  type BasicsField,
} from '../../lib/projects/basics';
import { CoverImageField } from './CoverImageField';
import type {
  BasicsValidationCopy,
  EditorChromeCopy,
} from '../../lib/i18n/campaign-editor-copy';
import { EditorShell } from './EditorShell';
import { SaveStatus } from './SaveStatus';
import { useAutosave, describeFailure, type SaveFailure } from './useAutosave';
import { useProjectEdit } from './useProjectEdit';

/**
 * The pre-launch tab: what the pre-launch page will say, the link to share, how
 * many people are waiting, and the control that makes it public.
 *
 * THE CONTENT IS THE BASICS, ON PURPOSE. There is no separate pre-launch
 * headline or pre-launch summary. A dedicated pair would let a creator promise
 * one thing on the page people follow and a different thing on the campaign it
 * becomes, and the follower signed up for the first. So this edits `title`,
 * `blurb`, and `coverImage` through the same `PATCH /v1/projects/{id}` autosave
 * the Basics tab uses — the same fields, shown here in the arrangement the
 * public page renders them in, so a creator can see what they are publishing
 * rather than imagining it.
 *
 * OPENING THE PAGE IS NOT AN AUTOSAVE. It publishes the campaign's title,
 * summary, and cover to anybody with the link, and docs/architecture.md §6.1 has
 * no edge back — there is no PRELAUNCH → DRAFT. A switch that did that silently
 * on the way past would be the worst control on the platform, so it is a button,
 * behind a dialog that says what cannot be undone.
 *
 * MOTION: none beyond the save indicator (docs/motion-system.md §5, "campaign
 * editor — none"). The modal's own entry is the overlay pattern of §4.11 and
 * belongs to the component, not to this surface's budget.
 */

const LOADING_ROWS = [0, 1, 2];

/** The states in which a pre-launch page exists and collects followers. */
const COLLECTING: readonly ProjectState[] = ['PRELAUNCH', 'SCHEDULED'];

/** Maps a validation failure's `errors` map onto the fields this form has. */
function serverErrors(failure: SaveFailure | null): BasicsErrors {
  if (failure === null) return {};

  const mapped: BasicsErrors = {};
  for (const [key, message] of Object.entries(failure.fieldErrors)) {
    const [field = ''] = key.split('.');
    if (isBasicsField(field)) mapped[field] = message;
  }
  return mapped;
}

/**
 * The address to share.
 *
 * Built from `window.location.origin` rather than from a configured base URL,
 * because the correct host is whichever one the creator is looking at — a
 * staging deployment that handed out production links would be a link that
 * showed the wrong campaign. Empty on the server, where there is no origin; the
 * field is read-only and shows nothing until the client has hydrated, which is
 * one frame.
 */
function prelaunchLink(projectId: string): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/projects/${encodeURIComponent(projectId)}/prelaunch`;
}

export interface PrelaunchPanelProps {
  projectId: string;
  /** The editor frame's words, resolved by this tab's page. */
  copy: EditorChromeCopy;
  /**
   * The basics form's refusals. This tab edits the same fields through the same
   * `validateBasics`, so it refuses in the same vocabulary rather than a second one.
   */
  validation: BasicsValidationCopy;
}

export function PrelaunchPanel({ projectId, copy, validation }: PrelaunchPanelProps) {
  const { project, status, error, reload, apply } = useProjectEdit(projectId);

  /** Seeded once, for the reason `BasicsPanel` gives: re-seeding eats keystrokes. */
  const [draft, setDraft] = useState<BasicsDraft | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openFailure, setOpenFailure] = useState<SaveFailure | null>(null);
  const [copied, setCopied] = useState(false);
  const [followerCount, setFollowerCount] = useState<number | null>(null);

  const autosave = useAutosave<ProjectPatch, ProjectEdit>({
    send: (patch) => patchProject(projectId, patch),
    onSaved: apply,
  });

  useEffect(() => {
    if (project !== null && draft === null) setDraft(draftFromProject(project));
  }, [project, draft]);

  const collecting = project !== null && COLLECTING.includes(project.state);

  useEffect(() => {
    if (!collecting) return;

    const controller = new AbortController();
    void (async () => {
      try {
        const page = await getPrelaunchPage(projectId, controller.signal);
        setFollowerCount(page.followerCount);
      } catch {
        /*
         * The count is the one thing on this tab that is read from the public
         * endpoint, and losing it must not take the editor with it. `null` is
         * rendered as "not available" rather than as zero — telling a creator
         * that nobody has signed up when the request simply failed is worse than
         * telling them nothing.
         */
        if (!controller.signal.aborted) setFollowerCount(null);
      }
    })();

    return () => controller.abort();
  }, [projectId, collecting]);

  function change(field: BasicsField, next: BasicsDraft): void {
    setDraft(next);

    const patch = patchForField(field, next);
    if (patch !== null) autosave.save(patch);
  }

  async function open(): Promise<void> {
    setOpening(true);
    setOpenFailure(null);
    try {
      // Anything still queued goes first. Opening the page publishes whatever the
      // server holds, and a summary typed a second ago is not there yet.
      autosave.flush();
      apply(await openPrelaunch(projectId));
      setConfirming(false);
    } catch (cause) {
      setOpenFailure(describeFailure(cause));
    } finally {
      setOpening(false);
    }
  }

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(prelaunchLink(projectId));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused, and there is nothing to do about it:
      // the address is in a focusable read-only field beside the button, so the
      // fallback is the ordinary one of selecting it.
      setCopied(false);
    }
  }

  if (status === 'signed-out') {
    return (
      <EditorShell projectId={projectId} copy={copy} active="prelaunch">
        <InlineAlert variant="info" title="You are signed out">
          This browser no longer has a session. Sign in again to keep editing this campaign.
        </InlineAlert>
      </EditorShell>
    );
  }

  if (status === 'failed' || draft === null || project === null) {
    return (
      <EditorShell projectId={projectId} copy={copy} active="prelaunch">
        {status === 'failed' ? (
          <>
            <InlineAlert variant="danger" title="This project could not be loaded">
              {error}
            </InlineAlert>
            <Pill variant="ghost" size="sm" className="mt-4" onClick={reload}>
              Try again
            </Pill>
          </>
        ) : (
          <SkeletonGroup label="Loading this campaign">
            <div className="flex flex-col gap-6">
              {LOADING_ROWS.map((row) => (
                <div key={row} className="flex flex-col gap-2">
                  <Skeleton height="0.875rem" width="30%" />
                  <Skeleton height="2.75rem" />
                </div>
              ))}
            </div>
          </SkeletonGroup>
        )}
      </EditorShell>
    );
  }

  const errors: BasicsErrors = { ...validateBasics(draft, validation), ...serverErrors(autosave.failure) };
  const canOpen = project.state === 'DRAFT';
  const closed = !canOpen && !collecting;

  return (
    <EditorShell
      projectId={projectId}
      copy={copy}
      active="prelaunch"
      title={project.title}
      state={project.state}
      status={<SaveStatus state={autosave.state} copy={copy.save} />}
    >
      <div className="flex flex-col gap-7">
        {autosave.failure !== null && (
          <InlineAlert variant="danger" title="This change was not saved">
            <p>{autosave.failure.message}</p>
            <p className="mt-2 text-white/64">
              Nothing you typed has been lost — it is still in the fields below and will be sent
              again.
            </p>
            <Pill variant="ghost" size="sm" className="mt-3" onClick={autosave.retry}>
              Try again
            </Pill>
          </InlineAlert>
        )}

        {/* ---------------------------------------------------------------
            The state of the page itself: not opened, open, or finished.
           --------------------------------------------------------------- */}

        {canOpen && (
          <section
            aria-labelledby="prelaunch-open-heading"
            className="rounded-lg border border-white/8 bg-surface-2 p-5"
          >
            <h2 id="prelaunch-open-heading" className="text-base font-semibold text-white">
              The pre-launch page is not open yet
            </h2>
            <p className="mt-2 text-[13px] text-white/64">
              Opening it publishes the title, summary, and cover image below at a link you can
              share, and lets people ask to be told the moment the campaign opens. Nothing else
              about the campaign becomes public, and no money is involved.
            </p>
            <p className="mt-2 text-[13px] text-white/64">
              It cannot be closed again — the campaign moves forward from here, to review and then
              to launch.
            </p>
            {openFailure !== null && (
              <InlineAlert variant="danger" title="The page was not opened" className="mt-4">
                {openFailure.message}
              </InlineAlert>
            )}
            <Pill className="mt-4" onClick={() => setConfirming(true)}>
              Open the pre-launch page
            </Pill>
          </section>
        )}

        {collecting && (
          <section
            aria-labelledby="prelaunch-live-heading"
            className="rounded-lg border border-white/8 bg-surface-2 p-5"
          >
            <h2 id="prelaunch-live-heading" className="text-base font-semibold text-white">
              The pre-launch page is open
            </h2>

            <div className="mt-4 flex items-center gap-2 text-sm text-white">
              {/* An icon and a word. Colour alone never carries meaning
                  (docs/ui-kit.md §9.2), and a bare number beside a glyph is not a
                  sentence a screen reader can read out usefully. */}
              <Users aria-hidden="true" className="size-4 text-white/64" />
              {followerCount === null ? (
                <span className="text-white/64">
                  The number of people waiting could not be loaded.
                </span>
              ) : (
                <span>
                  <strong className="font-semibold">{followerCount}</strong>{' '}
                  {followerCount === 1 ? 'person is' : 'people are'} waiting for this campaign.
                </span>
              )}
            </div>

            <Field
              label="Pre-launch link"
              hint="Share this anywhere. Anybody who opens it can ask to be told when the campaign goes live."
              className="mt-5"
            >
              <div className="flex gap-2">
                {/* Read-only rather than disabled: a disabled input cannot be
                    focused, selected, or read by a screen reader on its own, and
                    selecting the address by hand is the fallback when the
                    clipboard is refused. */}
                <TextInput readOnly value={prelaunchLink(projectId)} className="font-mono" />
                <Pill
                  variant="ghost"
                  onClick={copyLink}
                  iconLeft={
                    copied ? (
                      <Check aria-hidden="true" className="size-4" />
                    ) : (
                      <Copy aria-hidden="true" className="size-4" />
                    )
                  }
                >
                  {copied ? 'Copied' : 'Copy'}
                </Pill>
              </div>
              {/* Announced rather than only shown, so that a keyboard user who
                  pressed Copy is told it worked. Present from the first render so
                  the region is registered before anything is put in it. */}
              <span role="status" aria-live="polite" className="sr-only">
                {copied ? 'Link copied' : ''}
              </span>
            </Field>
          </section>
        )}

        {closed && (
          <InlineAlert variant="info" title="The pre-launch page has closed">
            This campaign has moved past its pre-launch page. Everybody who asked to be reminded is
            told once, when it goes live.
          </InlineAlert>
        )}

        {/* ---------------------------------------------------------------
            What the page says. The Basics fields, in the order the public
            page renders them.
           --------------------------------------------------------------- */}

        <form className="flex flex-col gap-7" onSubmit={(event) => event.preventDefault()}>
          <div>
            <h2 className="text-base font-semibold text-white">What the page says</h2>
            <p className="mt-1 text-[13px] text-white/64">
              These are the campaign&rsquo;s title, summary, and cover image — the same ones the
              Basics tab holds. A pre-launch page that promised something different from the
              campaign would be promising it to the people most likely to notice.
            </p>
          </div>

          <Field
            label="Title"
            required
            hint={`The name on the pre-launch page and on the discovery grid. ${TITLE_MAX_CHARACTERS} characters or fewer.`}
            error={errors.title}
          >
            <TextInput
              value={draft.title}
              autoComplete="off"
              onChange={(event) => change('title', { ...draft, title: event.target.value })}
              onBlur={autosave.flush}
            />
            <CharacterCount
            count={characterCount(draft.title)}
            limit={TITLE_MAX_CHARACTERS}
            copy={copy.characterCount}
            locale={copy.locale}
          />
          </Field>

          <Field
            label="Summary"
            hint={`One or two sentences. This is what somebody reads before deciding to follow. ${BLURB_MAX_CHARACTERS} characters or fewer.`}
            error={errors.blurb}
          >
            <Textarea
              rows={3}
              value={draft.blurb}
              onChange={(event) => change('blurb', { ...draft, blurb: event.target.value })}
              onBlur={autosave.flush}
            />
            <CharacterCount
            count={characterCount(draft.blurb)}
            limit={BLURB_MAX_CHARACTERS}
            copy={copy.characterCount}
            locale={copy.locale}
          />
          </Field>

          <CoverImageField
            url={draft.coverImageUrl}
            cover={draft.coverImage}
            error={errors.coverImage}
            onUrlChange={(url) => setDraft({ ...draft, coverImageUrl: url })}
            onAccept={(cover: CoverImage) =>
              change('coverImage', { ...draft, coverImage: cover, coverImageUrl: cover.url })
            }
            onRemove={() => change('coverImage', { ...draft, coverImage: null, coverImageUrl: '' })}
          />
        </form>
      </div>

      <Modal
        open={confirming}
        onOpenChange={setConfirming}
        size="sm"
        title="Open the pre-launch page?"
        description="The title, summary, and cover image become public at a link anyone can open. This cannot be undone."
        footer={
          <div className="flex justify-end gap-2">
            <Pill variant="outline" onClick={() => setConfirming(false)} disabled={opening}>
              Cancel
            </Pill>
            <Pill onClick={() => void open()} disabled={opening}>
              {opening ? 'Opening' : 'Open the page'}
            </Pill>
          </div>
        }
      >
        {/* `text-on-white`, not `text-white`: the modal is the one white surface
            in the system (docs/ui-kit.md §7.14), and white text on it is
            invisible. */}
        <p className="text-sm text-on-white/64">
          Nothing about your rewards, story, or funding goal is published, and the campaign does not
          take money until it is reviewed and launched.
        </p>
      </Modal>
    </EditorShell>
  );
}
