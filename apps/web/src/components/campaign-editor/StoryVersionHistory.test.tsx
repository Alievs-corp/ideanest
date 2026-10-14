import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { storyPanelCopyFrom } from '@ideanest/campaign-editor/copy';
import { listStoryVersions, type StoryVersionSummary } from '../../lib/projects/api';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralise } from '../../lib/i18n/plurals';
import { EDITOR_COPY } from '../../test-editor-copy';
import { translatorFor } from '../../test-copy';
import { StoryVersionHistory } from './StoryVersionHistory';

/*
 * #78: until the editor's last strings left it, this drawer said "Version 3", "most recent",
 * "1,240 characters" and every one of its refusals in English, and printed its dates with
 * `en-GB` — inside a drawer whose title and buttons were already translated. English cannot
 * show that is fixed, so this renders in Russian, whose plural rule is the one a ternary on
 * `=== 1` gets wrong: 21 takes the singular, 5 the genitive plural. `src/test-copy.ts` carries
 * the argument for asserting through the catalogue rather than retyping its words.
 */

vi.mock('../../lib/projects/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/projects/api')>()),
  listStoryVersions: vi.fn(),
  getStoryVersion: vi.fn(),
  restoreStoryVersion: vi.fn(),
}));

const listStoryVersionsMock = vi.mocked(listStoryVersions);

const RU = storyPanelCopyFrom(translatorFor('campaignEditor', 'ru'), 'ru', EDITOR_COPY.characterCount);

const VERSIONS: readonly StoryVersionSummary[] = [
  { number: 3, createdAt: '2026-10-01T09:30:00.000Z', authorId: 'creator-1', characters: 21 },
  { number: 2, createdAt: '2026-09-28T16:05:00.000Z', authorId: 'creator-1', characters: 5 },
];

function characters(count: number): string {
  return pluralise('ru', RU.history.characters, count);
}

function renderHistory() {
  return render(
    <StoryVersionHistory
      copy={RU.history}
      vocabulary={RU.vocabulary}
      projectId="project-1"
      open
      onOpenChange={() => {}}
      currentCharacters={5}
      onRestored={() => {}}
    />,
  );
}

describe('StoryVersionHistory', () => {
  beforeEach(() => {
    listStoryVersionsMock.mockReset().mockResolvedValue(VERSIONS);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('names each version and its length in the reader’s language', async () => {
    renderHistory();

    const newest = (await screen.findByText(fillPlaceholders(RU.history.version, { number: '3' })))
      .closest('li');
    expect(newest).not.toBeNull();
    const row = within(newest as HTMLElement);

    expect(row.getByText(RU.history.mostRecent)).toBeInTheDocument();
    expect(row.getByText(characters(21), { exact: false })).toBeInTheDocument();
    expect(screen.getByText(characters(5), { exact: false })).toBeInTheDocument();

    // And nothing on the drawer is the English it used to draw.
    expect(screen.queryByText(/Version|most recent|characters/)).toBeNull();
  });

  it('prints the moment a version was saved in the reader’s language, not en-GB', async () => {
    renderHistory();
    await screen.findByText(fillPlaceholders(RU.history.version, { number: '3' }));

    const moments = document.querySelectorAll('time');
    expect(moments.length).toBe(2);
    for (const moment of moments) {
      expect(moment.textContent).not.toMatch(/Oct|Sept|Sep/);
    }
  });

  it('puts the version and the story at risk into words before a restore', async () => {
    const user = userEvent.setup();
    renderHistory();
    await screen.findByText(fillPlaceholders(RU.history.version, { number: '3' }));

    const [restore] = screen.getAllByRole('button', {
      name: fillPlaceholders(RU.history.restoreVersion, { number: '3' }),
    });
    await user.click(restore as HTMLElement);

    const dialog = await screen.findByRole('dialog', {
      name: fillPlaceholders(RU.history.confirmTitle, { number: '3' }),
    });
    expect(
      within(dialog).getByText(
        fillPlaceholders(RU.history.currentHolds, { characters: characters(5) }),
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(characters(21), { exact: false })).toBeInTheDocument();
  });

  it('says an unreachable service in the reader’s language', async () => {
    listStoryVersionsMock.mockReset().mockRejectedValue(new TypeError('Failed to fetch'));
    renderHistory();

    expect(await screen.findByText(RU.history.unreachable)).toBeInTheDocument();
  });
});
