import { describe, expect, it } from 'vitest';
import {
  BLURB_MAX_CHARACTERS,
  DURATION_MAX_DAYS,
  DURATION_MIN_DAYS,
  TITLE_MAX_CHARACTERS,
  characterCount,
  draftFromProject,
  fromDateTimeLocal,
  patchForField,
  toDateTimeLocal,
  validateBasics,
  type BasicsDraft,
} from './basics';
import type { ProjectEdit } from './api';
import { BASICS_COPY } from '../../test-editor-copy';

/**
 * The boundaries of docs/architecture.md §5.3, which is where this fails: 60
 * and 135 characters, 1 and 60 days, and a goal that must not become a float on
 * the way out.
 */

const NOW = new Date('2026-08-15T09:00:00.000Z');

function draft(overrides: Partial<BasicsDraft> = {}): BasicsDraft {
  return {
    title: 'A field recorder for people who write outdoors',
    blurb: 'Pocket-sized, repairable, and quiet enough to record a forest.',
    categoryId: 'category-technology',
    subcategoryId: '',
    goalAmount: '5000.00',
    currency: 'AZN',
    durationDays: '30',
    scheduledLaunchAt: '',
    latePledgeEnabled: false,
    coverImageUrl: 'https://cdn.example.test/cover.jpg',
    coverImage: { url: 'https://cdn.example.test/cover.jpg', width: 1600, height: 900 },
    ...overrides,
  };
}

const of = (length: number): string => 'a'.repeat(length);

describe('characterCount', () => {
  it('counts code points, the way varchar(60) does', () => {
    // '🙂'.length is 2 in UTF-16, and telling a creator they have used two
    // characters for one emoji contradicts the column they are being measured
    // against.
    expect(characterCount('🙂')).toBe(1);
    expect('🙂'.length).toBe(2);
    expect(characterCount('ənənə')).toBe(5);
  });
});

describe('validateBasics', () => {
  it('accepts a well-formed draft', () => {
    expect(validateBasics(draft(), BASICS_COPY.validation, { now: NOW })).toEqual({});
  });

  describe('title', () => {
    it(`accepts exactly ${TITLE_MAX_CHARACTERS} characters and refuses one more`, () => {
      expect(validateBasics(draft({ title: of(60) }), BASICS_COPY.validation, { now: NOW }).title).toBeUndefined();

      const errors = validateBasics(draft({ title: of(61) }), BASICS_COPY.validation, { now: NOW });
      expect(errors.title).toContain('60 characters or fewer');
      // The message says how much has to go, so the fix does not need counting.
      expect(errors.title).toContain('Remove 1');
    });

    /*
     * The one required-ness the editor enforces. Everything else in §5.3 is a
     * submission gate the checklist reports (#37) — but a title was supplied at
     * creation, the column is NOT NULL, and clearing it is a mistake being made
     * now rather than work not yet done.
     */
    it('refuses an empty title', () => {
      expect(validateBasics(draft({ title: '   ' }), BASICS_COPY.validation, { now: NOW }).title).toBe(
        'A project needs a title.',
      );
    });
  });

  describe('summary', () => {
    it(`accepts exactly ${BLURB_MAX_CHARACTERS} characters and refuses one more`, () => {
      expect(validateBasics(draft({ blurb: of(135) }), BASICS_COPY.validation, { now: NOW }).blurb).toBeUndefined();
      expect(validateBasics(draft({ blurb: of(136) }), BASICS_COPY.validation, { now: NOW }).blurb).toContain('Remove 1');
    });

    it('says nothing about an empty summary, because a draft is unfinished', () => {
      expect(validateBasics(draft({ blurb: '' }), BASICS_COPY.validation, { now: NOW })).toEqual({});
    });
  });

  describe('duration', () => {
    it(`runs from ${DURATION_MIN_DAYS} to ${DURATION_MAX_DAYS} days inclusive`, () => {
      for (const days of ['1', '30', '60']) {
        expect(validateBasics(draft({ durationDays: days }), BASICS_COPY.validation, { now: NOW }).durationDays).toBeUndefined();
      }
    });

    it.each(['0', '61', '600'])('refuses %s days', (days) => {
      expect(validateBasics(draft({ durationDays: days }), BASICS_COPY.validation, { now: NOW }).durationDays).toBe(
        'A campaign runs for 1 to 60 days.',
      );
    });

    it('refuses a fraction of a day', () => {
      expect(validateBasics(draft({ durationDays: '14.5' }), BASICS_COPY.validation, { now: NOW }).durationDays).toContain(
        'whole number',
      );
    });

    it('accepts an empty duration, which simply is not chosen yet', () => {
      expect(validateBasics(draft({ durationDays: '' }), BASICS_COPY.validation, { now: NOW })).toEqual({});
    });
  });

  describe('goal', () => {
    it('explains a comma instead of silently reading half the figure', () => {
      expect(validateBasics(draft({ goalAmount: '5,000' }), BASICS_COPY.validation, { now: NOW }).goal).toContain(
        'full stop',
      );
    });

    it.each([
      ['0', 'more than zero'],
      ['5.005', 'two decimal places'],
      ['not a number', 'digits'],
    ])('refuses %s', (input, fragment) => {
      expect(validateBasics(draft({ goalAmount: input }), BASICS_COPY.validation, { now: NOW }).goal).toContain(fragment);
    });

    it('refuses a currency the platform cannot collect in', () => {
      expect(validateBasics(draft({ currency: 'BTC' }), BASICS_COPY.validation, { now: NOW }).goal).toContain('currency');
    });
  });

  describe('scheduled launch', () => {
    it('refuses a moment that has already passed', () => {
      const past = toDateTimeLocal('2026-08-14T09:00:00.000Z');
      expect(validateBasics(draft({ scheduledLaunchAt: past }), BASICS_COPY.validation, { now: NOW }).scheduledLaunchAt).toBe(
        'Choose a date and time in the future.',
      );
    });

    it('accepts one in the future', () => {
      const future = toDateTimeLocal('2026-09-01T09:00:00.000Z');
      expect(
        validateBasics(draft({ scheduledLaunchAt: future }), BASICS_COPY.validation, { now: NOW }).scheduledLaunchAt,
      ).toBeUndefined();
    });
  });

  describe('cover image', () => {
    /*
     * THIS USED TO BE A FORM ERROR, and its absence is the change. A small cover meant the
     * basics tab would not save, so a creator holding an 800x450 photograph could not get
     * past the first screen of the editor -- on a platform that had nowhere for them to
     * upload a larger one.
     *
     * It is advice now, and in two non-blocking places: CoverImageField says so when the
     * image is set, and the checklist carries COVER_IMAGE_SIZE as an advisory row. What
     * still blocks is having a cover at all, which the checklist owns rather than this.
     */
    it('does not refuse one below 1024×576', () => {
      const small = { url: 'https://cdn.example.test/small.jpg', width: 800, height: 450 };
      expect(validateBasics(draft({ coverImage: small }), BASICS_COPY.validation, { now: NOW }).coverImage).toBeUndefined();
    });

    it('accepts exactly the minimum', () => {
      const exact = { url: 'https://cdn.example.test/exact.jpg', width: 1024, height: 576 };
      expect(validateBasics(draft({ coverImage: exact }), BASICS_COPY.validation, { now: NOW }).coverImage).toBeUndefined();
    });

    it('carries a media identifier through to the patch when the cover came from an upload', () => {
      const uploaded = {
        url: 'https://cdn.example.test/media/abc.jpg',
        width: 1440,
        height: 810,
        mediaId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      };
      expect(validateBasics(draft({ coverImage: uploaded }), BASICS_COPY.validation, { now: NOW }).coverImage).toBeUndefined();
    });
  });

  it('refuses a subcategory with no category, which the server would too', () => {
    const errors = validateBasics(
      draft({ categoryId: '', subcategoryId: 'sub-hardware' }),
      BASICS_COPY.validation,
      { now: NOW },
    );
    expect(errors.subcategoryId).toBe(BASICS_COPY.validation.subcategoryWithoutCategory);
  });
});

describe('patchForField', () => {
  it('sends one field, never the whole form', () => {
    // A patch carrying every field would rewrite the goal each time the title
    // changed, and merge-patch would honour it.
    expect(patchForField('title', draft({ title: 'A new title' }))).toEqual({
      title: 'A new title',
    });
  });

  it('keeps every digit of the goal, as a string', () => {
    const patch = patchForField('goal', draft({ goalAmount: '1234567890.12' }));
    expect(patch).toEqual({ goal: { amount: '1234567890.12', currency: 'AZN' } });
  });

  it('normalises the goal to the scale the column holds', () => {
    expect(patchForField('goal', draft({ goalAmount: '5000' }))).toEqual({
      goal: { amount: '5000.00', currency: 'AZN' },
    });
  });

  it('clears an emptied optional field with an explicit null', () => {
    // Merge-patch reads an absent key as "leave it alone", so clearing has to
    // be said out loud.
    expect(patchForField('goal', draft({ goalAmount: '' }))).toEqual({ goal: null });
    expect(patchForField('durationDays', draft({ durationDays: '' }))).toEqual({
      durationDays: null,
    });
    expect(patchForField('blurb', draft({ blurb: '' }))).toEqual({ blurb: null });
    expect(patchForField('scheduledLaunchAt', draft({ scheduledLaunchAt: '' }))).toEqual({
      scheduledLaunchAt: null,
    });
  });

  it('sends nothing at all when the value is not valid', () => {
    expect(patchForField('title', draft({ title: of(61) }))).toBeNull();
    expect(patchForField('title', draft({ title: '' }))).toBeNull();
    expect(patchForField('blurb', draft({ blurb: of(136) }))).toBeNull();
    expect(patchForField('durationDays', draft({ durationDays: '61' }))).toBeNull();
    expect(patchForField('durationDays', draft({ durationDays: '0' }))).toBeNull();
    expect(patchForField('goal', draft({ goalAmount: '5,000' }))).toBeNull();
  });

  it('takes the subcategory with the category, so nothing is orphaned', () => {
    expect(patchForField('categoryId', draft({ categoryId: '', subcategoryId: '' }))).toEqual({
      categoryId: null,
      subcategoryId: null,
    });
  });

  it('sends a scheduled launch as an instant in UTC', () => {
    const local = '2026-09-01T10:00';
    expect(patchForField('scheduledLaunchAt', draft({ scheduledLaunchAt: local }))).toEqual({
      // Local wall-clock in, UTC out — the control has no offset to give.
      scheduledLaunchAt: new Date(local).toISOString(),
    });
  });

  it('trims what it sends, so a stray space is not saved as content', () => {
    expect(patchForField('blurb', draft({ blurb: '  Quiet enough for a forest.  ' }))).toEqual({
      blurb: 'Quiet enough for a forest.',
    });
  });
});

describe('the local date conversion', () => {
  it('round-trips an instant through the control and back', () => {
    const iso = new Date('2026-09-01T10:00').toISOString();
    expect(fromDateTimeLocal(toDateTimeLocal(iso))).toBe(iso);
  });

  it('reads nothing from an absent or unusable value', () => {
    expect(toDateTimeLocal(null)).toBe('');
    expect(toDateTimeLocal('not a date')).toBe('');
    expect(fromDateTimeLocal('')).toBeNull();
    expect(fromDateTimeLocal('not a date')).toBeNull();
  });
});

describe('draftFromProject', () => {
  const project: ProjectEdit = {
    id: 'project-1',
    slug: 'field-recorder',
    state: 'DRAFT',
    title: 'A field recorder',
    latePledgeEnabled: false,
    lockedFields: [],
    createdAt: '2026-08-15T09:00:00.000Z',
    updatedAt: '2026-08-15T09:00:00.000Z',
  };

  it('reads an absent optional field as an empty control', () => {
    // The service omits nulls rather than serialising them, so "absent" and
    // "null" have to mean the same thing here.
    expect(draftFromProject(project)).toMatchObject({
      blurb: '',
      categoryId: '',
      subcategoryId: '',
      goalAmount: '',
      currency: 'AZN',
      durationDays: '',
      scheduledLaunchAt: '',
      coverImageUrl: '',
      coverImage: null,
    });
  });

  it('keeps the goal amount exactly as the API wrote it', () => {
    const draftOf = draftFromProject({
      ...project,
      goal: { amount: '999999999999.99', currency: 'AZN' },
    });
    expect(draftOf.goalAmount).toBe('999999999999.99');
  });
});
