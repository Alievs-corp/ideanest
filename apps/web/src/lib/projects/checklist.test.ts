import { describe, expect, it } from 'vitest';
import { EDITOR_TABS, editorTabHref } from '../../components/campaign-editor/tabs';
import type { ChecklistItem, ProjectChecklist } from './api';
import { EDITOR_COPY, REVIEW_COPY } from '../../test-editor-copy';
import {
  CHECKLIST_SECTIONS,
  describeProgress,
  isChecklistSection,
  progressOf,
  sectionHref,
  unmetFromRefusal,
  unmetOf,
} from './checklist';

function item(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    requirement: 'COVER_IMAGE',
    label: 'Cover image',
    satisfied: false,
    section: 'basics',
    detail: 'A cover image is required.',
    ...overrides,
  };
}

function checklist(overrides: Partial<ProjectChecklist> = {}): ProjectChecklist {
  return {
    projectId: 'project-1',
    state: 'DRAFT',
    submittable: false,
    score: 50,
    blocking: [item({ requirement: 'TITLE', satisfied: true }), item()],
    advisory: [item({ requirement: 'REWARDS_OFFERED', section: 'rewards' })],
    ...overrides,
  };
}

describe('checklist sections', () => {
  /*
   * The service sends a route segment and the client builds a link out of it. If
   * the two lists drifted, every "fix this" link for the renamed section would
   * resolve to nothing — and it would look like a checklist bug rather than a
   * routing one.
   */
  it('names only sections the editor actually routes to', () => {
    const segments = EDITOR_TABS.map((tab) => tab.segment);

    for (const section of CHECKLIST_SECTIONS) {
      expect(segments).toContain(section);
      /* The section's name is the tab's own now, so this asserts the catalogue has one. */
      expect(EDITOR_COPY.tabs[section]).toBeTruthy();
    }
  });

  it('builds the same href the section navigation builds', () => {
    for (const section of CHECKLIST_SECTIONS) {
      const tab = EDITOR_TABS.find((candidate) => candidate.segment === section);
      expect(tab).toBeDefined();
      expect(sectionHref('project-1', section)).toBe(editorTabHref('project-1', tab!));
    }
  });

  it('encodes an identifier that would otherwise break the path', () => {
    expect(sectionHref('a/b', 'basics')).toBe('/projects/a%2Fb/edit/basics');
  });

  /*
   * A section this build does not know about means the service is ahead of the
   * client. The requirement is still real and still shown; what it does not get is
   * a link to a route that does not exist.
   */
  it('refuses to link to a section it does not recognise', () => {
    expect(isChecklistSection('people')).toBe(false);
    expect(sectionHref('project-1', 'people')).toBeNull();
  });
});

describe('progress', () => {
  it('counts what is done in each group and keeps the server score', () => {
    const progress = progressOf(checklist({ score: 71 }));

    // The score is the server's: the weighting between blocking and advisory is
    // its rule, and a client that recomputed it would be a second answer.
    expect(progress).toEqual({
      score: 71,
      blockingDone: 1,
      blockingTotal: 2,
      advisoryDone: 0,
      advisoryTotal: 1,
    });
  });

  it('says the score in words, with the counts a bar cannot carry', () => {
    const described = describeProgress(
      progressOf(checklist({ score: 83 })),
      REVIEW_COPY.progressSummary,
    );

    expect(described).toContain('83%');
    // The half that answers "is what is left optional".
    expect(described).toContain('1 of 2 required items done');
    expect(described).toContain('0 of 1 recommended');
  });

  it('lists only what is not done', () => {
    expect(unmetOf(checklist().blocking).map((entry) => entry.requirement)).toEqual([
      'COVER_IMAGE',
    ]);
  });
});

describe('reading a refusal', () => {
  it('reads the requirements the server named', () => {
    const unmet = unmetFromRefusal({
      unmet: [
        { requirement: 'RISKS', label: 'Risks and challenges', section: 'story', detail: 'Required.' },
      ],
    });

    expect(unmet).toEqual([
      { requirement: 'RISKS', label: 'Risks and challenges', section: 'story', detail: 'Required.' },
    ]);
  });

  /*
   * `meta` is `unknown` at the boundary. Casting it would put `undefined` into the
   * interface as a rendered field, which reads as a checklist row with no name.
   */
  it('drops an entry that is not the shape it claims to be', () => {
    expect(unmetFromRefusal({ unmet: [{ requirement: 'RISKS' }, 'RISKS', null, 42] })).toEqual([]);
  });

  it('is empty for a refusal that carries no requirements', () => {
    // PROJECT_TRANSITION_NOT_ALLOWED, which means the state refused the move
    // rather than the contents.
    expect(unmetFromRefusal({ state: 'REJECTED', allowed: [] })).toEqual([]);
    expect(unmetFromRefusal(undefined)).toEqual([]);
  });
});
