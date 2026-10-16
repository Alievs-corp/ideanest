import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  addProject,
  listCollections,
  readCollection,
  replaceCollection,
  searchCampaigns,
  type AdminCollection,
  type CampaignMatch,
} from '../../lib/admin/curation';
import {
  createSubcategory,
  editTaxonomyEntry,
  readTaxonomy,
  readTaxonomyTags,
  translateTaxonomyEntry,
  type TaxonomyTree,
} from '../../lib/admin/taxonomy';
import { translatorFor } from '../../test-copy';
import { consoleChromeCopyFrom, noteDialogCopyFrom } from '../../lib/i18n/admin/common-copy';
import {
  badgeManagerCopyFrom,
  collectionEditorCopyFrom,
  collectionManagerCopyFrom,
  curationChromeFrom,
  openCallManagerCopyFrom,
  placementEditorCopyFrom,
  taxonomyManagerCopyFrom,
} from '../../lib/i18n/admin/curation-copy';
import { BadgeManager } from './BadgeManager';
import { CollectionEditor } from './CollectionEditor';
import { CollectionManager } from './CollectionManager';
import { NoteDialog } from './NoteDialog';
import { OpenCallManager } from './OpenCallManager';
import { PlacementEditor } from './PlacementEditor';
import { TaxonomyManager } from './TaxonomyManager';

const ADMIN = translatorFor('admin');
const CHROME = curationChromeFrom(ADMIN, consoleChromeCopyFrom(ADMIN, translatorFor('common')));
const NOTE = noteDialogCopyFrom(ADMIN, translatorFor('common'));
const MANAGER = collectionManagerCopyFrom(ADMIN, CHROME);
const EDITOR = collectionEditorCopyFrom(ADMIN, CHROME);
const BADGES = badgeManagerCopyFrom(ADMIN, CHROME);
const OPEN_CALLS = openCallManagerCopyFrom(ADMIN, CHROME);
const PLACEMENT = placementEditorCopyFrom(ADMIN, CHROME);
const TAXONOMY = taxonomyManagerCopyFrom(ADMIN, CHROME);

vi.mock('../../lib/admin/curation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/curation')>();
  return {
    ...actual,
    listCollections: vi.fn(),
    readCollection: vi.fn(),
    replaceCollection: vi.fn(),
    createCollection: vi.fn(),
    addProject: vi.fn(),
    searchCampaigns: vi.fn(),
  };
});

vi.mock('../../lib/admin/taxonomy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/taxonomy')>();
  return {
    ...actual,
    readTaxonomy: vi.fn(),
    readTaxonomyTags: vi.fn(),
    editTaxonomyEntry: vi.fn(),
    translateTaxonomyEntry: vi.fn(),
    createSubcategory: vi.fn(),
  };
});

const listCollectionsMock = vi.mocked(listCollections);
const readCollectionMock = vi.mocked(readCollection);
const replaceCollectionMock = vi.mocked(replaceCollection);
const addProjectMock = vi.mocked(addProject);
const searchCampaignsMock = vi.mocked(searchCampaigns);
const readTaxonomyMock = vi.mocked(readTaxonomy);
const readTaxonomyTagsMock = vi.mocked(readTaxonomyTags);
const editTaxonomyEntryMock = vi.mocked(editTaxonomyEntry);
const translateTaxonomyEntryMock = vi.mocked(translateTaxonomyEntry);
const createSubcategoryMock = vi.mocked(createSubcategory);

const PROJECT_ID = '0191f2ab-1234-7000-8000-000000000002';

function collection(overrides: Partial<AdminCollection> = {}): AdminCollection {
  return {
    id: 'c-1',
    slug: 'autumn-picks',
    kind: 'staff_selection',
    copy: { az: { title: 'Payız seçimi' }, en: { title: 'Autumn picks' } },
    grantsBadge: false,
    sortOrder: 0,
    ...overrides,
  };
}

function campaign(overrides: Partial<CampaignMatch> = {}): CampaignMatch {
  return {
    projectId: PROJECT_ID,
    title: 'Solar lamp',
    slug: 'solar-lamp',
    state: 'LIVE',
    creatorName: 'Leyla',
    ...overrides,
  };
}

const TREE: TaxonomyTree = {
  branches: [
    {
      category: {
        id: 'k-1',
        slug: 'technology',
        nameAz: 'Texnologiya',
        nameEn: 'Technology',
        sortOrder: 0,
        translations: { az: 'Texnologiya', en: 'Technology', ru: 'Технологии' },
      },
      subcategories: [
        {
          id: 's-1',
          parentId: 'k-1',
          slug: 'hardware',
          nameAz: 'Avadanlıq',
          nameEn: 'Hardware',
          sortOrder: 0,
          translations: {},
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  listCollectionsMock.mockResolvedValue([collection()]);
  readTaxonomyMock.mockResolvedValue(TREE);
  readTaxonomyTagsMock.mockResolvedValue({ tags: [] });
});

describe('the note dialog', () => {
  it('counts characters in the reader’s words rather than in English', () => {
    const az = noteDialogCopyFrom(translatorFor('admin', 'az'), translatorFor('common', 'az'));
    render(
      <NoteDialog
        title="Dərc olunsun?"
        confirmLabel="Dərc et"
        busyLabel="Dərc olunur"
        busy={false}
        error={null}
        onCancel={() => {}}
        onConfirm={() => {}}
        copy={az}
      />,
    );

    expect(screen.queryByText(/characters remaining/)).not.toBeInTheDocument();
  });

  it('confirms without a reason when the change has nowhere to keep one', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <NoteDialog
        title="Badge everything?"
        confirmLabel="Grant"
        busyLabel="Saving"
        noteless
        busy={false}
        error={null}
        onCancel={() => {}}
        onConfirm={onConfirm}
        copy={NOTE}
      />,
    );

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Grant' }));
    expect(onConfirm).toHaveBeenCalledWith('');
  });
});

describe('the collection manager', () => {
  it('refuses a handle that would collide with one of the console’s own screens', async () => {
    const user = userEvent.setup();
    render(<CollectionManager allowCreate copy={MANAGER} note={NOTE} />);
    await screen.findByText('Payız seçimi');

    await user.type(screen.getByRole('textbox', { name: /Handle/ }), 'badges');
    await user.type(screen.getByRole('textbox', { name: /Title/ }), 'Nişanlar');
    await user.click(screen.getByRole('button', { name: MANAGER.create }));

    expect(await screen.findByText(MANAGER.handleErrors.reserved)).toBeInTheDocument();
  });

  it('no longer prints a raw placement number on every row', async () => {
    render(<CollectionManager allowCreate copy={MANAGER} note={NOTE} />);
    await screen.findByText('Payız seçimi');

    expect(screen.queryByText(/Placement 0/)).not.toBeInTheDocument();
  });
});

describe('the badge manager', () => {
  it('confirms a grant without asking for a reason it would throw away', async () => {
    const user = userEvent.setup();
    replaceCollectionMock.mockResolvedValue(collection({ grantsBadge: true }));
    render(<BadgeManager copy={BADGES} note={NOTE} />);

    await user.click(await screen.findByRole('button', { name: BADGES.grant }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: BADGES.grantConfirm }));

    await waitFor(() =>
      expect(replaceCollectionMock).toHaveBeenCalledWith(
        'autumn-picks',
        expect.objectContaining({ grantsBadge: true, sortOrder: 0 }),
      ),
    );
  });

  it('says an unpublished collection badges nothing only when it grants the badge', async () => {
    listCollectionsMock.mockResolvedValue([
      collection({ slug: 'granting', grantsBadge: true, copy: { az: { title: 'Verən' } } }),
      collection({ slug: 'plain', copy: { az: { title: 'Adi' } } }),
    ]);
    render(<BadgeManager copy={BADGES} note={NOTE} />);

    expect(await screen.findAllByText(BADGES.unpublishedBadgesNothing)).toHaveLength(1);
    expect(screen.getByText(BADGES.curation.unpublished)).toBeInTheDocument();
  });

  it('sends a curator to create a collection when there is none, rather than claiming they all grant', async () => {
    listCollectionsMock.mockResolvedValue([]);
    render(<BadgeManager copy={BADGES} note={NOTE} />);

    expect(await screen.findByText(BADGES.noCollectionsTitle)).toBeInTheDocument();
    expect(screen.queryByText(BADGES.allGrant)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: BADGES.toCollections })).toBeInTheDocument();
  });
});

describe('the placement editor', () => {
  it('renumbers collections that share a number, because swapping equal numbers moves nothing', async () => {
    const user = userEvent.setup();
    const a = collection({ id: 'a', slug: 'a-list', copy: { az: { title: 'A' } } });
    const b = collection({ id: 'b', slug: 'b-list', copy: { az: { title: 'B' } } });
    listCollectionsMock.mockResolvedValue([a, b]);
    replaceCollectionMock.mockImplementation(async (slug, body) => ({
      ...(slug === 'a-list' ? a : b),
      sortOrder: body.sortOrder ?? 0,
    }));
    render(<PlacementEditor copy={PLACEMENT} />);

    await user.click(await screen.findByRole('button', { name: 'Move down: A' }));

    await waitFor(() => expect(replaceCollectionMock).toHaveBeenCalledTimes(2));
    expect(replaceCollectionMock).toHaveBeenCalledWith('b-list', expect.objectContaining({ sortOrder: 10 }));
    expect(replaceCollectionMock).toHaveBeenCalledWith('a-list', expect.objectContaining({ sortOrder: 20 }));

    const rows = await screen.findAllByRole('listitem');
    await waitFor(() => expect(within(rows[0] as HTMLElement).queryByText('B')).toBeInTheDocument());
  });
});

describe('the open call manager', () => {
  it('will not save a window that closes before it opens', async () => {
    const user = userEvent.setup();
    listCollectionsMock.mockResolvedValue([
      collection({
        kind: 'open_call',
        opensAt: '2026-11-10T00:00:00.000Z',
        closesAt: '2026-12-01T00:00:00.000Z',
      }),
    ]);
    const { container } = render(<OpenCallManager copy={OPEN_CALLS} />);
    await screen.findByText('Payız seçimi');

    const [, closes] = Array.from(container.querySelectorAll('input[type="date"]'));
    await user.clear(closes as HTMLInputElement);
    await user.type(closes as HTMLInputElement, '2026-11-01');

    expect(screen.getByText(OPEN_CALLS.closesBeforeOpens)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: OPEN_CALLS.saveWindow })).toBeDisabled();
  });

  it('offers nothing to save until a date changes', async () => {
    listCollectionsMock.mockResolvedValue([collection({ kind: 'open_call' })]);
    render(<OpenCallManager copy={OPEN_CALLS} />);

    expect(await screen.findByRole('button', { name: OPEN_CALLS.saveWindow })).toBeDisabled();
  });
});

describe('the collection editor', () => {
  it('finds a campaign by its title rather than asking for its identifier', async () => {
    const user = userEvent.setup();
    readCollectionMock.mockResolvedValue(collection({ projects: [] }));
    searchCampaignsMock.mockResolvedValue([campaign()]);
    addProjectMock.mockResolvedValue(
      collection({
        projects: [
          { projectId: PROJECT_ID, slug: 'solar-lamp', title: 'Solar lamp', state: 'LIVE', position: 0, publiclyVisible: true },
        ],
      }),
    );
    render(<CollectionEditor slug="autumn-picks" copy={EDITOR} note={NOTE} />);

    await user.type(await screen.findByRole('searchbox', { name: EDITOR.addLabel }), 'solar');
    await user.click(screen.getByRole('button', { name: EDITOR.search }));
    expect(searchCampaignsMock).toHaveBeenCalledWith('solar', 8);

    await user.click(await screen.findByRole('button', { name: 'Add Solar lamp' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'Autumn feature.');
    await user.click(within(dialog).getByRole('button', { name: EDITOR.add }));

    await waitFor(() =>
      expect(addProjectMock).toHaveBeenCalledWith('autumn-picks', PROJECT_ID, 'Autumn feature.'),
    );
  });

  it('names a hidden campaign’s state in words rather than as an enum', async () => {
    readCollectionMock.mockResolvedValue(
      collection({
        projects: [
          { projectId: PROJECT_ID, slug: 'carpet', title: 'Carpet', state: 'SUSPENDED', position: 0, publiclyVisible: false },
        ],
      }),
    );
    render(<CollectionEditor slug="autumn-picks" copy={EDITOR} note={NOTE} />);

    expect(await screen.findByText('Suspended')).toBeInTheDocument();
    expect(screen.queryByText('SUSPENDED')).not.toBeInTheDocument();
  });

  it('saves a translation with every other field the collection already had', async () => {
    const user = userEvent.setup();
    const loaded = collection({ grantsBadge: true, sortOrder: 30, projects: [] });
    readCollectionMock.mockResolvedValue(loaded);
    replaceCollectionMock.mockResolvedValue(loaded);
    const { container } = render(<CollectionEditor slug="autumn-picks" copy={EDITOR} note={NOTE} />);
    await screen.findByRole('heading', { name: EDITOR.detailsHeading });

    const russian = container.querySelector('input[lang="ru"]') as HTMLInputElement;
    await user.type(russian, 'Осенний выбор');
    await user.click(screen.getByRole('button', { name: EDITOR.save }));

    await waitFor(() =>
      expect(replaceCollectionMock).toHaveBeenCalledWith('autumn-picks', {
        kind: 'staff_selection',
        copy: {
          az: { title: 'Payız seçimi' },
          en: { title: 'Autumn picks' },
          ru: { title: 'Осенний выбор' },
        },
        cover: null,
        opensAt: null,
        closesAt: null,
        grantsBadge: true,
        sortOrder: 30,
      }),
    );
  });

  it('will not save a collection without its Azerbaijani title', async () => {
    const user = userEvent.setup();
    readCollectionMock.mockResolvedValue(collection({ projects: [] }));
    const { container } = render(<CollectionEditor slug="autumn-picks" copy={EDITOR} note={NOTE} />);
    await screen.findByRole('heading', { name: EDITOR.detailsHeading });

    await user.clear(container.querySelector('input[lang="az"]') as HTMLInputElement);
    await user.click(screen.getByRole('button', { name: EDITOR.save }));

    expect(await screen.findByText(EDITOR.titleMissing)).toBeInTheDocument();
    expect(replaceCollectionMock).not.toHaveBeenCalled();
  });
});

describe('the taxonomy manager', () => {
  it('writes a changed Russian name as a translation and leaves the row alone', async () => {
    const user = userEvent.setup();
    translateTaxonomyEntryMock.mockResolvedValue(undefined);
    const { container } = render(<TaxonomyManager copy={TAXONOMY} />);

    await user.click((await screen.findAllByRole('button', { name: TAXONOMY.edit }))[0] as HTMLElement);
    const russian = container.querySelector('input[lang="ru"]') as HTMLInputElement;
    expect(russian).toHaveValue('Технологии');
    await user.clear(russian);
    await user.type(russian, 'Техника');
    await user.click(screen.getAllByRole('button', { name: TAXONOMY.save })[0] as HTMLElement);

    await waitFor(() =>
      expect(translateTaxonomyEntryMock).toHaveBeenCalledWith('categories', 'k-1', 'ru', 'Техника'),
    );
    expect(editTaxonomyEntryMock).not.toHaveBeenCalled();
    expect(await screen.findByText(TAXONOMY.savedNotice)).toBeInTheDocument();
  });

  it('asks for the Azerbaijani name of a new subcategory, which the service requires', async () => {
    const user = userEvent.setup();
    render(<TaxonomyManager copy={TAXONOMY} />);

    await user.click((await screen.findAllByRole('button', { name: TAXONOMY.edit }))[0] as HTMLElement);
    const form = screen.getByRole('heading', { name: TAXONOMY.newSubcategoryLabel }).closest('section') as HTMLElement;
    const [handle, , english] = within(form).getAllByRole('textbox');
    await user.type(handle as HTMLElement, 'robots');
    await user.type(english as HTMLElement, 'Robots');

    expect(within(form).getByRole('button', { name: TAXONOMY.add })).toBeDisabled();
    expect(createSubcategoryMock).not.toHaveBeenCalled();
  });
});
