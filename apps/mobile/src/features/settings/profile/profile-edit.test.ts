import { ApiError } from '@ideanest/api-client';
import { ownProfileFrom, profileFieldRefusal, type OwnProfile } from './api';
import { characterCount, draftFrom, editFrom, isProfileField } from './profile-edit';
import { availableTo, firstUnused } from './social-links-field';

const PROFILE: OwnProfile = {
  name: 'Aysel Məmmədova',
  slug: 'aysel',
  bio: 'I make things.',
  avatarUrl: 'https://media.example.com/a.webp',
  websiteUrl: 'https://aysel.example.com',
  location: { slug: 'baku', name: 'Bakı' },
  socialLinks: [
    { platform: 'INSTAGRAM', url: 'https://instagram.com/aysel' },
    { platform: 'GITHUB', url: 'https://github.com/aysel' },
  ],
};

describe('the profile Merge-Patch', () => {
  it('sends nothing for a form saved untouched', () => {
    expect(editFrom(PROFILE, draftFrom(PROFILE))).toEqual({});
  });

  it('sends only the changed keys, trimmed', () => {
    const draft = { ...draftFrom(PROFILE), name: '  Aysel M.  ', websiteUrl: 'https://new.example.com ' };
    expect(editFrom(PROFILE, draft)).toEqual({
      name: 'Aysel M.',
      websiteUrl: 'https://new.example.com',
    });
  });

  it('turns an emptied field into null, never ""', () => {
    const draft = {
      ...draftFrom(PROFILE),
      bio: '   ',
      avatarUrl: '',
      websiteUrl: '',
      locationSlug: '',
    };
    expect(editFrom(PROFILE, draft)).toEqual({
      bio: null,
      avatarUrl: null,
      websiteUrl: null,
      locationSlug: null,
    });
  });

  it('sends an emptied name as "" for the service to refuse, not null', () => {
    expect(editFrom(PROFILE, { ...draftFrom(PROFILE), name: ' ' })).toEqual({ name: '' });
  });

  it('omits unchanged social links, even when only whitespace differs', () => {
    const draft = {
      ...draftFrom(PROFILE),
      socialLinks: [
        { platform: 'INSTAGRAM', url: ' https://instagram.com/aysel ' },
        { platform: 'GITHUB', url: 'https://github.com/aysel' },
      ],
    };
    expect(editFrom(PROFILE, draft)).toEqual({});
  });

  it('sends the whole list when one link changed, in order', () => {
    const draft = {
      ...draftFrom(PROFILE),
      socialLinks: [
        { platform: 'INSTAGRAM', url: 'https://instagram.com/aysel' },
        { platform: 'BEHANCE', url: 'https://behance.net/aysel' },
      ],
    };
    expect(editFrom(PROFILE, draft)).toEqual({
      socialLinks: [
        { platform: 'INSTAGRAM', url: 'https://instagram.com/aysel' },
        { platform: 'BEHANCE', url: 'https://behance.net/aysel' },
      ],
    });
  });

  it('sends an empty list when every link was removed, and notices a reorder', () => {
    expect(editFrom(PROFILE, { ...draftFrom(PROFILE), socialLinks: [] })).toEqual({ socialLinks: [] });
    const reordered = [...PROFILE.socialLinks].reverse();
    expect(editFrom(PROFILE, { ...draftFrom(PROFILE), socialLinks: reordered })).toEqual({
      socialLinks: reordered,
    });
  });

  it('sets a location where there was none', () => {
    const none = { ...PROFILE, location: null };
    expect(editFrom(none, { ...draftFrom(none), locationSlug: 'ganja' })).toEqual({
      locationSlug: 'ganja',
    });
    expect(editFrom(none, draftFrom(none))).toEqual({});
  });

  it('counts characters as code points', () => {
    expect(characterCount('🙂🙂')).toBe(2);
    expect(characterCount('Məmmədova')).toBe(9);
  });
});

describe('a PROFILE_FIELD_INVALID refusal', () => {
  function refused(meta: Record<string, unknown> | undefined, code = 'PROFILE_FIELD_INVALID') {
    return new ApiError(400, {
      type: 'about:blank',
      title: 'Invalid',
      status: 400,
      detail: 'A website has to start with https://.',
      code,
      ...(meta === undefined ? {} : { meta }),
    });
  }

  it('maps to the field meta.field names, with the service sentence', () => {
    const refusal = profileFieldRefusal(refused({ field: 'websiteUrl' }));
    expect(refusal).toEqual({ field: 'websiteUrl', message: 'A website has to start with https://.' });
    expect(isProfileField(refusal?.field ?? '')).toBe(true);
  });

  it('maps avatarUrl and socialLinks to their own fields', () => {
    expect(profileFieldRefusal(refused({ field: 'avatarUrl' }))?.field).toBe('avatarUrl');
    expect(profileFieldRefusal(refused({ field: 'socialLinks' }))?.field).toBe('socialLinks');
  });

  it('is null for another code, a missing or non-string field, or not an ApiError', () => {
    expect(profileFieldRefusal(refused({ field: 'name' }, 'SOMETHING_ELSE'))).toBeNull();
    expect(profileFieldRefusal(refused(undefined))).toBeNull();
    expect(profileFieldRefusal(refused({ field: 3 }))).toBeNull();
    expect(profileFieldRefusal(new TypeError('Network request failed'))).toBeNull();
  });

  it('names only this form fields', () => {
    expect(isProfileField('slug')).toBe(false);
    expect(isProfileField('locationSlug')).toBe(true);
  });
});

describe('the response', () => {
  it('reads absent scalars as null and absent links as []', () => {
    expect(ownProfileFrom({ name: 'Aysel', slug: 'aysel' })).toEqual({
      name: 'Aysel',
      slug: 'aysel',
      bio: null,
      avatarUrl: null,
      websiteUrl: null,
      location: null,
      socialLinks: [],
    });
  });
});

describe('social link platforms', () => {
  const links = [
    { platform: 'INSTAGRAM', url: '' },
    { platform: 'FACEBOOK', url: '' },
  ];

  it('offers a row only the platforms no other row has', () => {
    expect(availableTo(links, 0)).not.toContain('FACEBOOK');
    expect(availableTo(links, 0)).toContain('INSTAGRAM');
    expect(availableTo(links, 1)).not.toContain('INSTAGRAM');
  });

  it('opens a new row on the first unused platform, or none when all nine are taken', () => {
    expect(firstUnused(links)).toBe('X');
    const all = availableTo([], 0).map((platform) => ({ platform, url: '' }));
    expect(all).toHaveLength(9);
    expect(firstUnused(all)).toBeUndefined();
  });
});
