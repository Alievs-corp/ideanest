import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { PRELAUNCH_COVER_SIZES } from '../../lib/images/sizes';
import { getPrelaunchPage, remindMe, type PrelaunchPage } from '../../lib/projects/api';
import { PrelaunchView } from './PrelaunchView';
import { prelaunchCopyFrom } from '../../lib/i18n/prelaunch-copy';
import { translatorFor } from '../../test-copy';

/*
 * Built from `messages/en.json` with the function the route calls, rather than retyped:
 * `test-copy.ts` carries the argument, and it is the reason these assertions are still
 * about the wiring after the page stopped carrying its own English.
 */
const COPY = prelaunchCopyFrom(translatorFor('campaign.prelaunch'));

/**
 * The public pre-launch page. Appearance is reviewed in Storybook; these cover
 * what fails silently.
 *
 * The three that carry the design are the ones about the signup: a real labelled
 * field rather than a placeholder standing in for a label, a refusal that is
 * ANNOUNCED rather than only coloured, and a confirmed state that replaces the
 * form instead of leaving a button somebody presses twice. The remaining tests
 * are about the two refusals this page is most likely to meet in the wild — a
 * campaign that never opened a page, and one that opened while the visitor was
 * reading it.
 */

vi.mock('../../lib/projects/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/projects/api')>()),
  getPrelaunchPage: vi.fn(),
  remindMe: vi.fn(),
}));

const getPrelaunchPageMock = vi.mocked(getPrelaunchPage);
const remindMeMock = vi.mocked(remindMe);

const PAGE: PrelaunchPage = {
  id: 'project-1',
  slug: 'a-field-recorder',
  state: 'PRELAUNCH',
  title: 'A field recorder',
  blurb: 'Pocket-sized and repairable.',
  coverImage: null,
  scheduledLaunchAt: null,
  followerCount: 41,
};

async function tick(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function openPage(overrides: Partial<PrelaunchPage> = {}): Promise<UserEvent> {
  getPrelaunchPageMock.mockResolvedValue({ ...PAGE, ...overrides });

  const user = userEvent.setup();
  render(<PrelaunchView projectId="project-1" copy={COPY} locale="en" />);
  await tick();

  return user;
}

const emailField = (): HTMLElement =>
  screen.getByRole('textbox', { name: COPY.emailLabel });
const submit = (): HTMLElement => screen.getByRole('button', { name: COPY.submit });

beforeEach(() => {
  vi.clearAllMocks();
  remindMeMock.mockResolvedValue({ following: true, followerCount: 42 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PrelaunchView', () => {
  it('announces that it is loading rather than showing an empty page', () => {
    getPrelaunchPageMock.mockReturnValue(new Promise<PrelaunchPage>(() => {}));
    render(<PrelaunchView projectId="project-1" copy={COPY} locale="en" />);

    const label = screen.getByText(COPY.loading);
    expect(label.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the campaign and how many people are waiting', async () => {
    await openPage();

    expect(screen.getByRole('heading', { level: 1, name: 'A field recorder' })).toBeInTheDocument();
    expect(screen.getByText('Pocket-sized and repairable.')).toBeInTheDocument();
    // The social proof of a campaign that has no pledges yet. A bare number would
    // be read out as "41" and mean nothing.
    expect(screen.getByText(/people are waiting for this campaign/)).toBeInTheDocument();
  });

  it('uses the singular when one person is waiting', async () => {
    await openPage({ followerCount: 1 });

    expect(screen.getByText(/person is waiting for this campaign/)).toBeInTheDocument();
  });

  it('asks for the address with a real label, not a placeholder', async () => {
    await openPage();

    // A placeholder is not an accessible name: it disappears the moment somebody
    // types, and several screen readers do not announce it at all.
    expect(emailField()).toBeInTheDocument();
    expect(submit()).toHaveAttribute('type', 'submit');
  });

  it('refuses an address that is not one, without troubling the server', async () => {
    const user = await openPage();

    await user.type(emailField(), 'not-an-address');
    await user.click(submit());

    expect(remindMeMock).not.toHaveBeenCalled();
    expect(screen.getByText(COPY.emailInvalid)).toBeInTheDocument();
    // Wired to the control rather than floating near it, so the message is read
    // out when the field is focused.
    expect(emailField()).toHaveAccessibleDescription(
      COPY.emailInvalid,
    );
  });

  it('registers the address and replaces the form with a confirmed state', async () => {
    const user = await openPage();

    await user.type(emailField(), 'someone@example.com');
    await user.click(submit());
    await tick();

    expect(remindMeMock).toHaveBeenCalledWith('project-1', { email: 'someone@example.com' });

    // The form is gone. Leaving it on screen invites a second press and the
    // question "am I on this list twice now".
    expect(screen.queryByRole('textbox', { name: COPY.emailLabel })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: COPY.onListTitle })).toBeInTheDocument();

    // Announced, not merely shown.
    expect(screen.getByRole('status')).toHaveTextContent(
      'You are on the list. We will email you when this campaign opens.',
    );

    // And the count the server answered with, rather than one this page guessed
    // by adding one to what it already had.
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.queryByText('41')).not.toBeInTheDocument();
  });

  it('announces a refusal instead of only colouring it', async () => {
    const user = await openPage();
    remindMeMock.mockRejectedValue(
      new ApiError(429, { retryAfterSeconds: 900, code: 'RATE_LIMITED' }),
    );

    await user.type(emailField(), 'someone@example.com');
    await user.click(submit());
    await tick();

    // role="alert" is announced on insertion, which is what a failure the visitor
    // did not expect needs. The form stays, with what they typed still in it.
    expect(screen.getByRole('alert')).toHaveTextContent('Try again in about 15 minutes.');
    expect(emailField()).toHaveValue('someone@example.com');
  });

  it('says nothing is here when the campaign has no pre-launch page', async () => {
    getPrelaunchPageMock.mockRejectedValue(new ApiError(404, null));

    render(<PrelaunchView projectId="project-1" copy={COPY} locale="en" />);
    await tick();

    // 404 covers "no such campaign", "still a draft", and "already launched" — the
    // service will not say which, so neither does this.
    expect(screen.getByText(/There is no pre-launch page here/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.submit })).not.toBeInTheDocument();
  });

  it('tells the visitor when the campaign opened while they were reading', async () => {
    const user = await openPage();
    remindMeMock.mockRejectedValue(
      new ApiError(409, { code: 'REMINDERS_CLOSED', meta: { state: 'LIVE' } }),
    );

    await user.type(emailField(), 'someone@example.com');
    await user.click(submit());
    await tick();

    // The signup did fail, and saying so would be true and useless. What changed
    // is that there is now a campaign to look at.
    expect(screen.getByText(/already opened/)).toBeInTheDocument();
  });

  /*
   * The cover: the largest contentful paint on this route, and the one element
   * above the heading. Every assertion here is invisible once the photograph
   * has loaded, and paid for on the first paint of a cold connection.
   */
  describe('the cover', () => {
    const COVER = { url: 'https://images.example.test/cover.jpg', width: 1600, height: 1200 };

    function frame(): HTMLElement {
      const found = document.querySelector<HTMLElement>('[data-media-frame]');
      if (found === null) throw new Error('the cover reserved no box at all');
      return found;
    }

    it('reserves the shape the picture really is', async () => {
      // Shown whole rather than cropped, so a 4:3 photograph reserves 4:3. A
      // 16:9 box would be right and the picture would not be in it.
      await openPage({ coverImage: COVER });

      expect(frame().style.aspectRatio).toBe('1600 / 1200');
    });

    it('falls back to the crop when the recorded size is unusable', async () => {
      // Zero is what a failed measurement leaves behind, and `1600 / 0` is a
      // declaration the browser drops — taking the reservation with it.
      await openPage({ coverImage: { ...COVER, width: 0, height: 0 } });

      expect(frame().style.aspectRatio).toBe('16 / 9');
    });

    it('loads eagerly, because it is the largest contentful paint here', async () => {
      await openPage({ coverImage: COVER });

      expect(document.querySelector('img')).not.toHaveAttribute('loading', 'lazy');
    });

    it('declares the width of the reading column', async () => {
      await openPage({ coverImage: COVER });

      expect(document.querySelector('img')).toHaveAttribute('sizes', PRELAUNCH_COVER_SIZES);
    });

    it('reserves nothing when there is no cover', async () => {
      // No frame rather than an empty one: the heading is the first thing on a
      // campaign that never set a cover, and a reserved strip of surface above
      // it would be furniture standing in for nothing.
      await openPage();

      expect(document.querySelector('[data-media-frame]')).toBeNull();
    });
  });
});
