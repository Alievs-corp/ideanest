import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  readOwnProfile,
  saveOwnProfile,
  type OwnProfile,
  type ProfileLocation,
  type ProfileSocialLink,
} from '../../lib/profiles/api';
import { listProfileLocations } from '../../lib/profiles/locations';
import { ProfileEditorPanel } from './ProfileEditorPanel';
import { profileEditorCopyFrom } from '../../lib/i18n/profile-copy';
import { translatorFor } from '../../test-copy';

/*
 * The words, built from `messages/en.json` with the builder the route calls — #82.
 *
 * Retyping the sentences here would give a test that passes whatever the catalogue says, and
 * would still be green with the message file empty. `src/test-copy.ts` carries the argument.
 */
const COPY = profileEditorCopyFrom(translatorFor('profile'));

/**
 * §4.2's profile editor — P-01 to P-03, issue #276.
 *
 * WHAT THESE COVER:
 *
 *   - **every field opens holding what the service says is there.** A form that rendered
 *     blank controls over a stored profile is a form whose first save deletes five fields
 *     somebody never touched.
 *   - **an untouched field is absent from the request body.** `PATCH /v1/me/profile` is
 *     three-way — absent leaves alone, `null` clears, a value sets — and sending all six keys
 *     every time would make two tabs open on one account overwrite each other silently. This
 *     is the assertion that keeps `editFrom` a diff.
 *   - **an emptied field sends `null` and never `""`.** They are different instructions to
 *     the endpoint and identical states on screen, so the conversion happens once, on the way
 *     out, and nothing else can be relied on to notice.
 *   - **a refusal lands under the control it is about.** The service names the field in
 *     `meta.field` precisely so that "a link has to start with https://" appears beneath the
 *     website rather than in a banner over a form with six controls in it. The test asserts
 *     the `aria-invalid` as well as the sentence, because a message beside the wrong input is
 *     the same defect as no message.
 *   - **the cap and the one-link-per-platform rule are visible before the server enforces
 *     them.** Five is the most a profile carries and a platform appears once; both are stated
 *     in words rather than by a control that stops working, and the second is made
 *     unreachable rather than merely refused.
 *   - **the handle is presented as fixed, with the reason.** `slug` is readable and has no
 *     key on the write. docs/ui-kit.md §7.13's argument about a hint applies here: a disabled
 *     box with no sentence tells somebody the thing is broken rather than decided.
 *   - **the form renders from the response, not from its own draft.** The endpoint answers
 *     200 with the whole profile because the result is not inferable from the request — text
 *     comes back trimmed and a location comes back with a name this browser never sent.
 *   - the avatar says plainly that nothing is uploaded, because §13.1's pipeline does not
 *     exist and a control that implied otherwise would be worse than the missing feature.
 */

vi.mock('../session/SessionProvider', () => ({
  useSession: () => ({
    status: 'signed-in',
    session: {
      id: 'u1',
      email: 'aysel@example.com',
      name: 'Aysel Qasımova',
      slug: 'aysel',
      emailVerified: true,
    },
    refresh: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock('../../lib/profiles/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/profiles/api')>()),
  readOwnProfile: vi.fn(),
  saveOwnProfile: vi.fn(),
}));

vi.mock('../../lib/profiles/locations', () => ({
  listProfileLocations: vi.fn(),
}));

const readMock = vi.mocked(readOwnProfile);
const saveMock = vi.mocked(saveOwnProfile);
const locationsMock = vi.mocked(listProfileLocations);

/** One place in the gazetteer. */
function location(overrides: Partial<ProfileLocation> = {}): ProfileLocation {
  return { slug: 'baku', name: 'Bakı', ...overrides };
}

function link(overrides: Partial<ProfileSocialLink> = {}): ProfileSocialLink {
  return { platform: 'INSTAGRAM', url: 'https://instagram.com/aysel', ...overrides };
}

/**
 * A profile as `GET /v1/me/profile` answers it.
 *
 * Every optional field is populated by default, because the interesting assertions are about
 * *clearing* one and about leaving five alone. A fixture full of nulls would make "absent
 * from the body" pass for the wrong reason.
 */
function profile(overrides: Partial<OwnProfile> = {}): OwnProfile {
  return {
    name: 'Aysel Qasımova',
    slug: 'aysel',
    bio: 'I make ceramics.',
    avatarUrl: 'https://images.example.com/aysel.jpg',
    websiteUrl: 'https://aysel.example',
    location: location(),
    socialLinks: [link()],
    ...overrides,
  };
}

const GAZETTEER: readonly ProfileLocation[] = [
  location(),
  location({ slug: 'ganja', name: 'Gəncə' }),
];

beforeEach(() => {
  readMock.mockReset();
  saveMock.mockReset();
  locationsMock.mockReset();

  readMock.mockResolvedValue(profile());
  saveMock.mockImplementation(async () => profile());
  locationsMock.mockResolvedValue(GAZETTEER);
});

afterEach(cleanup);

/** Renders and waits for the read, so no test asserts against a form that is still loading. */
async function open(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<ProfileEditorPanel copy={COPY} />);
  await screen.findByRole('textbox', { name: /^Name/u });
  return user;
}

function save(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  return user.click(screen.getByRole('button', { name: 'Save profile' }));
}

describe('the form as it opens', () => {
  it('shows the name, biography, picture, website and links the service answered with', async () => {
    await open();

    expect(screen.getByRole('textbox', { name: /^Name/u })).toHaveValue('Aysel Qasımova');
    expect(screen.getByRole('textbox', { name: 'Biography' })).toHaveValue('I make ceramics.');
    expect(screen.getByRole('textbox', { name: 'Profile picture address' })).toHaveValue(
      'https://images.example.com/aysel.jpg',
    );
    expect(screen.getByRole('textbox', { name: 'Website' })).toHaveValue('https://aysel.example');
    expect(screen.getByRole('textbox', { name: 'Instagram address' })).toHaveValue(
      'https://instagram.com/aysel',
    );
  });

  it('shows the stored location as the chosen one, rather than reopening on nothing', async () => {
    await open();

    expect(await screen.findByRole('combobox', { name: /^Location/u })).toHaveValue('baku');
  });

  it('says the handle cannot be changed here and why, rather than disabling a box', async () => {
    await open();

    expect(screen.getByText(/cannot be changed here/u)).toBeInTheDocument();
    expect(screen.getByText(/every campaign you publish/u)).toBeInTheDocument();
    // Not a greyed input with no sentence beside it: there is no control for it at all.
    expect(screen.queryByRole('textbox', { name: /handle/iu })).not.toBeInTheDocument();
  });

  it('says the picture is an address rather than an upload, because §13.1 does not exist', async () => {
    await open();

    expect(screen.getByText(/cannot store a file yet/u)).toBeInTheDocument();
  });
});

describe('what reaches the wire', () => {
  it('sends nothing at all when nothing was changed', async () => {
    const user = await open();

    await save(user);

    expect(saveMock).toHaveBeenCalledWith({});
  });

  it('sends only the field that changed, and leaves the other five absent', async () => {
    const user = await open();

    const name = screen.getByRole('textbox', { name: /^Name/u });
    await user.clear(name);
    await user.type(name, 'Aysel Q');
    await save(user);

    expect(saveMock).toHaveBeenCalledWith({ name: 'Aysel Q' });
  });

  it('sends null rather than an empty string for a biography somebody deleted', async () => {
    const user = await open();

    await user.clear(screen.getByRole('textbox', { name: 'Biography' }));
    await save(user);

    expect(saveMock).toHaveBeenCalledWith({ bio: null });
  });

  it('sends null for a website somebody deleted, and for a picture', async () => {
    const user = await open();

    await user.clear(screen.getByRole('textbox', { name: 'Website' }));
    await user.clear(screen.getByRole('textbox', { name: 'Profile picture address' }));
    await save(user);

    expect(saveMock).toHaveBeenCalledWith({ websiteUrl: null, avatarUrl: null });
  });

  it('sends the slug of a chosen place, and null for "not saying"', async () => {
    const user = await open();
    const select = await screen.findByRole('combobox', { name: /^Location/u });

    await user.selectOptions(select, 'ganja');
    await save(user);
    expect(saveMock).toHaveBeenCalledWith({ locationSlug: 'ganja' });

    await user.selectOptions(select, '');
    await save(user);
    expect(saveMock).toHaveBeenLastCalledWith({ locationSlug: null });
  });

  it('writes the links as a whole list, because the endpoint replaces it rather than merging', async () => {
    readMock.mockResolvedValue(
      profile({
        socialLinks: [link(), link({ platform: 'GITHUB', url: 'https://github.com/aysel' })],
      }),
    );
    const user = await open();

    await user.click(screen.getByRole('button', { name: 'Remove the Instagram link' }));
    await save(user);

    // The surviving link is sent again, not a deletion of the other one.
    expect(saveMock).toHaveBeenCalledWith({
      socialLinks: [{ platform: 'GITHUB', url: 'https://github.com/aysel' }],
    });
  });
});

describe('when the service refuses a field', () => {
  function refusal(field: string, detail: string): ApiError {
    return new ApiError(400, {
      status: 400,
      title: 'Invalid field',
      detail,
      code: 'PROFILE_FIELD_INVALID',
      meta: { field },
    });
  }

  it('puts a refused http:// address under the website and marks that control invalid', async () => {
    saveMock.mockRejectedValue(
      refusal('websiteUrl', 'A link has to start with https:// and hold no spaces.'),
    );
    const user = await open();

    const website = screen.getByRole('textbox', { name: 'Website' });
    await user.clear(website);
    await user.type(website, 'http://aysel.example');
    await save(user);

    /*
     * Matched on the half of the sentence the field's own hint does not also carry. The hint
     * says "Has to start with https://" before anybody gets it wrong, which is the point of a
     * hint — so a looser pattern here would pass on the guidance and never see the refusal.
     */
    expect(await screen.findByText(/hold no spaces/u)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Website' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    // And nowhere else: a message under the wrong control is the same defect as none.
    expect(screen.getByRole('textbox', { name: /^Name/u })).not.toHaveAttribute('aria-invalid');
  });

  it('puts a refused picture address under the picture, not in a banner over the form', async () => {
    saveMock.mockRejectedValue(
      refusal('avatarUrl', 'A link has to start with https:// and hold no spaces.'),
    );
    const user = await open();

    await user.type(screen.getByRole('textbox', { name: 'Profile picture address' }), 'x');
    await save(user);

    expect(await screen.findByText(/hold no spaces/u)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Profile picture address' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.queryByText('Nothing was saved')).not.toBeInTheDocument();
  });

  it('puts a refused name under the name, since an emptied one is sent rather than blocked', async () => {
    saveMock.mockRejectedValue(refusal('name', 'A name is between 1 and 80 characters.'));
    const user = await open();

    await user.clear(screen.getByRole('textbox', { name: /^Name/u }));
    await save(user);

    expect(saveMock).toHaveBeenCalledWith({ name: '' });
    expect(await screen.findByText(/between 1 and 80 characters/u)).toBeInTheDocument();
  });

  it('shows a refusal about the whole list on the links field', async () => {
    saveMock.mockRejectedValue(refusal('socialLinks', 'A profile carries at most 5 links.'));
    const user = await open();

    await user.type(screen.getByRole('textbox', { name: 'Instagram address' }), '/x');
    await save(user);

    expect(await screen.findByText(/at most 5 links/u)).toBeInTheDocument();
  });

  it('falls back to a banner for a refusal that names no field of this form', async () => {
    saveMock.mockRejectedValue(new ApiError(503, null, 'The service is unavailable.'));
    const user = await open();

    await user.type(screen.getByRole('textbox', { name: /^Name/u }), '!');
    await save(user);

    expect(await screen.findByText('The service is unavailable.')).toBeInTheDocument();
  });
});

describe('the social links', () => {
  it('stops offering another link at five, and says so in words rather than by a grey button', async () => {
    readMock.mockResolvedValue(
      profile({
        socialLinks: [
          link(),
          link({ platform: 'FACEBOOK', url: 'https://facebook.com/a' }),
          link({ platform: 'X', url: 'https://x.com/a' }),
          link({ platform: 'YOUTUBE', url: 'https://youtube.com/@a' }),
          link({ platform: 'TIKTOK', url: 'https://tiktok.com/@a' }),
        ],
      }),
    );
    await open();

    expect(screen.getByRole('button', { name: 'Add a link' })).toBeDisabled();
    expect(screen.getByText(/5 of 5 used/u)).toBeInTheDocument();
  });

  it('reaches the cap by adding, rather than by being refused after a round trip', async () => {
    readMock.mockResolvedValue(
      profile({
        socialLinks: [
          link(),
          link({ platform: 'FACEBOOK', url: 'https://facebook.com/a' }),
          link({ platform: 'X', url: 'https://x.com/a' }),
          link({ platform: 'YOUTUBE', url: 'https://youtube.com/@a' }),
        ],
      }),
    );
    const user = await open();

    expect(screen.getByText(/4 of 5 used/u)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add a link' }));

    expect(screen.getByRole('button', { name: 'Add a link' })).toBeDisabled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('does not offer a platform another link already uses, so a duplicate cannot be chosen', async () => {
    const user = await open();

    await user.click(screen.getByRole('button', { name: 'Add a link' }));

    const second = screen.getByRole('combobox', { name: 'Platform for link 2' });
    expect(within(second).queryByRole('option', { name: 'Instagram' })).not.toBeInTheDocument();
    // The row holding it still offers it, or the select would silently reselect another.
    const first = screen.getByRole('combobox', { name: 'Platform for link 1' });
    expect(within(first).getByRole('option', { name: 'Instagram' })).toBeInTheDocument();
  });

  it('opens a new row on a platform nobody has taken, so no row is left unset', async () => {
    const user = await open();

    await user.click(screen.getByRole('button', { name: 'Add a link' }));

    expect(screen.getByRole('combobox', { name: 'Platform for link 2' })).toHaveValue('FACEBOOK');
  });
});

describe('after a save', () => {
  it('renders what the service answered with, not the draft that was typed', async () => {
    saveMock.mockResolvedValue(profile({ name: 'Aysel Q', location: location({ slug: 'ganja', name: 'Gəncə' }) }));
    const user = await open();

    const name = screen.getByRole('textbox', { name: /^Name/u });
    await user.clear(name);
    await user.type(name, '  Aysel Q  ');
    await save(user);

    // The service trims, and what is on screen afterwards is its answer rather than the box.
    expect(await screen.findByRole('textbox', { name: /^Name/u })).toHaveValue('Aysel Q');
    expect(screen.getByRole('combobox', { name: /^Location/u })).toHaveValue('ganja');
  });

  it('confirms the save politely, without interrupting whatever is being read', async () => {
    const user = await open();

    await save(user);

    const confirmation = await screen.findByText('Your profile is saved');

    /*
     * Inside a polite live region and NOT inside an alert. `InlineAlert` asserts for `warning`
     * and `danger` only, and interrupting somebody mid-sentence to say "saved" is a cost with
     * no payoff — an alert that fires for everything stops being an alert.
     */
    expect(confirmation.closest('[role="status"]')).not.toBeNull();
    expect(confirmation.closest('[role="alert"]')).toBeNull();
  });
});

describe('when the gazetteer cannot be read', () => {
  it('says so, keeps the stored place on screen, and still saves everything else', async () => {
    locationsMock.mockRejectedValue(new Error('unreachable'));
    const user = await open();

    expect(await screen.findByText(/list of places could not be loaded/u)).toBeInTheDocument();
    expect(screen.getByText(/Bakı/u)).toBeInTheDocument();

    const name = screen.getByRole('textbox', { name: /^Name/u });
    await user.clear(name);
    await user.type(name, 'Aysel Q');
    await save(user);

    // `locationSlug` is absent, so a save made while the list was down cannot clear a place.
    expect(saveMock).toHaveBeenCalledWith({ name: 'Aysel Q' });
  });
});

describe('when the profile itself cannot be read', () => {
  it('says so instead of rendering an empty form somebody would save over their profile', async () => {
    readMock.mockRejectedValue(new ApiError(503, null, 'The service is unavailable.'));
    render(<ProfileEditorPanel copy={COPY} />);

    expect(await screen.findByText('Your profile could not be loaded')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save profile' })).not.toBeInTheDocument();
  });
});
