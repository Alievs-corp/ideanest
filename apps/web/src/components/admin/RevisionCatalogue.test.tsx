import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { RevisionItem, RevisionItemWriting, RevisionZones } from '../../lib/admin/revisions';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { revisionReviewCopyFrom } from '../../lib/i18n/admin/revision-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { expectNoViolations } from '../../test-axe';
import { translatorFor } from '../../test-copy';
import { RevisionItems, RevisionShippingZones, zoneDiffs } from './RevisionCatalogue';

const COPY = revisionReviewCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);
const IC = COPY.items;
const ZC = COPY.shippingZones;

const ITEM = '0193f2a1-0000-7000-8000-00000000e001';
const EUROPE = '0193f2a1-0000-7000-8000-00000000f001';
const CAUCASUS = '0193f2a1-0000-7000-8000-00000000f002';
const ASIA = '0193f2a1-0000-7000-8000-00000000f003';

function writing(overrides: Partial<RevisionItemWriting> = {}): RevisionItemWriting {
  return {
    name: 'Mug',
    description: 'A stoneware mug',
    imageUrl: null,
    weightGrams: 350,
    isDigital: false,
    ...overrides,
  };
}

function item(overrides: Partial<RevisionItem>): RevisionItem {
  return { id: ITEM, changedFields: [], live: writing(), proposed: writing(), ...overrides };
}

function renderItems(...items: RevisionItem[]) {
  return render(<RevisionItems items={items} copy={COPY} />);
}

function renderZones(zones: RevisionZones) {
  return render(<RevisionShippingZones zones={zones} locale="en" copy={COPY} />);
}

function card(label: string, name: string): HTMLElement {
  return screen.getByRole('article', { name: fillPlaceholders(label, { name }) });
}

function pane(root: HTMLElement, heading: string, name: string, field: string): HTMLElement {
  return within(root).getByRole('group', { name: `${heading}: ${name}: ${field}` });
}

describe('the items of an edit, issue #589', () => {
  it('names the item by its live name and marks a changed name and description in words on both sides', () => {
    renderItems(
      item({
        changedFields: ['name', 'description'],
        proposed: writing({ name: 'Enamel mug', description: 'A stoneware mug with a lid' }),
      }),
    );

    // Named as the moderator finds it on the campaign, not as proposed.
    const mug = card(IC.itemLabel, 'Mug');
    expect(within(mug).getByRole('heading', { name: 'Mug' })).toBeInTheDocument();

    const nameProposed = pane(mug, COPY.proposedHeading, 'Mug', IC.fields.name);
    const added = within(nameProposed).getByText('Enamel', { exact: false });
    expect(added.tagName).toBe('INS');
    expect(added).toHaveTextContent(COPY.added);
    expect(within(pane(mug, COPY.liveHeading, 'Mug', IC.fields.name)).queryByText('Enamel', { exact: false })).not.toBeInTheDocument();

    const description = pane(mug, COPY.proposedHeading, 'Mug', IC.fields.description);
    expect(within(description).getByText('lid', { exact: false }).tagName).toBe('INS');

    // A field the service did not name is not drawn.
    expect(within(mug).queryByText(IC.fields.weightGrams)).not.toBeInTheDocument();
    expect(within(mug).queryByText(IC.fields.isDigital)).not.toBeInTheDocument();
  });

  it('shows weight and digital delivery as before and after, in words', () => {
    renderItems(
      item({
        changedFields: ['weightGrams', 'isDigital'],
        proposed: writing({ weightGrams: null, isDigital: true }),
      }),
    );

    const mug = card(IC.itemLabel, 'Mug');
    const weightLive = pane(mug, COPY.liveHeading, 'Mug', IC.fields.weightGrams);
    const weightProposed = pane(mug, COPY.proposedHeading, 'Mug', IC.fields.weightGrams);
    expect(within(weightLive).getByText(fillPlaceholders(IC.weight, { grams: '350' })).tagName).toBe('DEL');
    expect(within(weightProposed).getByText(IC.noWeight).tagName).toBe('INS');

    expect(within(pane(mug, COPY.liveHeading, 'Mug', IC.fields.isDigital)).getByText(COPY.rewards.no)).toBeInTheDocument();
    expect(within(pane(mug, COPY.proposedHeading, 'Mug', IC.fields.isDigital)).getByText(COPY.rewards.yes)).toBeInTheDocument();
  });

  it('shows the picture and its address before and after, and draws only an https picture', () => {
    renderItems(
      item({
        changedFields: ['imageUrl'],
        live: writing({ imageUrl: 'http://old.test/mug.jpg' }),
        proposed: writing({ imageUrl: 'https://img.test/mug.jpg' }),
      }),
    );

    const mug = card(IC.itemLabel, 'Mug');
    const live = pane(mug, COPY.liveHeading, 'Mug', IC.fields.imageUrl);
    const proposed = pane(mug, COPY.proposedHeading, 'Mug', IC.fields.imageUrl);

    expect(within(live).queryByRole('img')).not.toBeInTheDocument();
    expect(within(live).getByText('http://old.test/mug.jpg').tagName).toBe('DEL');
    expect(within(proposed).getByRole('img', { name: fillPlaceholders(IC.imageAlt, { name: 'Mug' }) })).toHaveAttribute(
      'src',
      'https://img.test/mug.jpg',
    );
    expect(within(proposed).getByText('https://img.test/mug.jpg').tagName).toBe('INS');
  });

  it('says what is missing rather than drawing nothing', () => {
    renderItems(
      item({
        changedFields: ['name', 'description', 'imageUrl'],
        live: writing({ name: null, description: null, imageUrl: null }),
        proposed: writing({ name: 'Poster', description: '', imageUrl: 'https://img.test/poster.jpg' }),
      }),
    );

    const poster = card(IC.itemLabel, 'Poster');
    expect(within(pane(poster, COPY.liveHeading, 'Poster', IC.fields.name)).getByText(COPY.empty)).toBeInTheDocument();
    expect(within(pane(poster, COPY.proposedHeading, 'Poster', IC.fields.description)).getByText(COPY.empty)).toBeInTheDocument();
    expect(within(pane(poster, COPY.liveHeading, 'Poster', IC.fields.imageUrl)).getByText(COPY.rewards.noImage)).toBeInTheDocument();
  });

  it('names an item with no name at all', () => {
    renderItems(item({ changedFields: ['isDigital'], live: null, proposed: { isDigital: true } }));

    expect(card(IC.itemLabel, IC.untitled)).toBeInTheDocument();
  });

  it('draws every item of the edit under one heading, and passes the automated accessibility rules', async () => {
    const { container } = renderItems(
      item({ id: 'a', changedFields: ['name'], proposed: writing({ name: 'Cup' }) }),
      item({ id: 'b', changedFields: ['isDigital'], live: writing({ name: 'Poster' }), proposed: writing({ name: 'Poster', isDigital: true }) }),
    );

    expect(screen.getByRole('heading', { name: COPY.fields.items })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    await expectNoViolations(container);
  });
});

describe('the shipping zones of an edit, issue #589', () => {
  it('draws an added zone whole, as new, with its countries by name, a word, an icon and a spoken marker', () => {
    renderZones({ live: [], proposed: [{ id: CAUCASUS, name: 'Caucasus', countryCodes: ['GE', 'AZ'] }] });

    const zone = card(ZC.zoneLabel, 'Caucasus');
    expect(within(zone).getByText(ZC.changes.added)).toBeInTheDocument();
    expect(zone.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(within(zone).getByText(ZC.addedNote)).toBeInTheDocument();
    expect(within(zone).getByText(COPY.added, { exact: false })).toBeInTheDocument();
    expect(within(zone).getByText('Azerbaijan')).toBeInTheDocument();
    expect(within(zone).getByText('Georgia')).toBeInTheDocument();
    expect(within(zone).queryByText('AZ')).not.toBeInTheDocument();
  });

  it('draws a removed zone whole, as to be removed and still live', () => {
    renderZones({ live: [{ id: ASIA, name: 'Asia', countryCodes: ['JP'] }], proposed: [] });

    const zone = card(ZC.zoneLabel, 'Asia');
    expect(within(zone).getByText(ZC.changes.removed)).toBeInTheDocument();
    expect(within(zone).getByText(ZC.removedNote)).toBeInTheDocument();
    expect(within(zone).getByText(COPY.removed, { exact: false })).toBeInTheDocument();
    expect(within(zone).getByText('Japan')).toBeInTheDocument();
  });

  it('matches a zone by identifier, so a rename with other countries is one changed zone', () => {
    renderZones({
      live: [
        { id: EUROPE, name: 'Europe', countryCodes: ['DE', 'FR'] },
        { id: CAUCASUS, name: 'Caucasus', countryCodes: ['AZ'] },
      ],
      proposed: [
        { id: EUROPE, name: 'Western Europe', countryCodes: ['FR', 'NL'] },
        { id: CAUCASUS, name: 'Caucasus', countryCodes: ['AZ'] },
      ],
    });

    // The unchanged zone is not drawn, and the renamed one is named as it is live.
    expect(screen.getAllByRole('article')).toHaveLength(1);
    const zone = card(ZC.zoneLabel, 'Europe');
    expect(within(zone).getByText(ZC.changes.renamed)).toBeInTheDocument();
    expect(within(zone).getByText(ZC.changes.countries)).toBeInTheDocument();
    expect(within(zone).queryByText(ZC.changes.added)).not.toBeInTheDocument();
    expect(within(zone).queryByText(ZC.changes.removed)).not.toBeInTheDocument();

    const nameProposed = pane(zone, COPY.proposedHeading, 'Europe', ZC.name);
    expect(within(nameProposed).getByText('Western', { exact: false }).tagName).toBe('INS');

    const countriesLive = pane(zone, COPY.liveHeading, 'Europe', ZC.countries);
    const countriesProposed = pane(zone, COPY.proposedHeading, 'Europe', ZC.countries);
    expect(within(countriesLive).getByText('Germany').closest('del')).not.toBeNull();
    expect(within(countriesLive).getByText('France').closest('del, ins')).toBeNull();
    expect(within(countriesProposed).getByText('Netherlands').closest('ins')).not.toBeNull();
    expect(within(countriesProposed).queryByText('Germany')).not.toBeInTheDocument();
  });

  it('shows only the countries row when only the countries change', () => {
    renderZones({
      live: [{ id: EUROPE, name: 'Europe', countryCodes: ['DE'] }],
      proposed: [{ id: EUROPE, name: 'Europe', countryCodes: ['DE', 'IT'] }],
    });

    const zone = card(ZC.zoneLabel, 'Europe');
    expect(within(zone).queryByText(ZC.changes.renamed)).not.toBeInTheDocument();
    expect(within(zone).queryByRole('group', { name: `${COPY.liveHeading}: Europe: ${ZC.name}` })).not.toBeInTheDocument();
    expect(within(pane(zone, COPY.proposedHeading, 'Europe', ZC.countries)).getByText('Italy').closest('ins')).not.toBeNull();
  });

  it('says so when the proposed set is the same as the live one', () => {
    renderZones({
      live: [{ id: EUROPE, name: 'Europe', countryCodes: ['DE', 'FR'] }],
      proposed: [{ id: EUROPE, name: 'Europe', countryCodes: ['FR', 'DE'] }],
    });

    expect(screen.getByText(ZC.unchanged)).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('reads a zone with no name or no countries', () => {
    renderZones({ live: [], proposed: [{ id: ASIA, name: null, countryCodes: null }] });

    const zone = card(ZC.zoneLabel, ZC.untitled);
    expect(within(zone).getByText(COPY.noCountries)).toBeInTheDocument();
  });

  it('lists the zones in their proposed order and the removed ones after, and passes the automated accessibility rules', async () => {
    const zones: RevisionZones = {
      live: [
        { id: ASIA, name: 'Asia', countryCodes: ['JP'] },
        { id: EUROPE, name: 'Europe', countryCodes: ['DE'] },
      ],
      proposed: [
        { id: CAUCASUS, name: 'Caucasus', countryCodes: ['AZ'] },
        { id: EUROPE, name: 'Europe', countryCodes: ['FR'] },
      ],
    };

    expect(zoneDiffs(zones).map((diff) => [diff.id, diff.changes])).toEqual([
      [CAUCASUS, ['added']],
      [EUROPE, ['countries']],
      [ASIA, ['removed']],
    ]);

    const { container } = renderZones(zones);
    expect(screen.getByRole('heading', { name: COPY.fields.shippingZones })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    await expectNoViolations(container);
  });
});
