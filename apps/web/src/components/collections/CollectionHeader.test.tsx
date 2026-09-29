import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { Collection } from '../../lib/collections/api';
import { CollectionHeader } from './CollectionHeader';
import { collectionHeaderCopyFrom } from '../../lib/i18n/collection-copy';
import { translatorFor } from '../../test-copy';
/*
 * The copy the route would have resolved, built from `messages/en.json` by the same function it
 * calls — issue #324. Retyping the sentences here would give a test that passes whatever the
 * catalogue says, which is the opposite of what it is for.
 */
const COPY = collectionHeaderCopyFrom(
  translatorFor('discovery.collections'),
  translatorFor('common'),
);

/** The English catalogue's `discovery.collections.window`. */

/**
 * The head of a collection landing page — D-08, issue #266.
 *
 * WHAT THESE COVER:
 *
 *   - the trail is rendered for a reader as well as declared in JSON-LD for a crawler. A page
 *     with only the machine half is one somebody lands on from a search result with no way up.
 *   - **an open call states when it closes**, as a date and never a countdown: the endpoint is
 *     cached for sixty seconds, and being wrong about a deadline is the expensive failure on
 *     the one kind of list somebody acts on a deadline for.
 *   - the editorial badge is a sentence with an icon, never a colour on its own (§9.2).
 *   - a cover is decorative and says so. `alt=""` removes it from the accessibility tree; an
 *     omitted attribute would have a screen reader read out the file name.
 */

function collection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 'c1',
    slug: 'spring-2026',
    kind: 'open_call',
    title: 'Spring 2026',
    description: 'Applications for the spring programme.',
    image: null,
    grantsBadge: false,
    projectCount: 3,
    opensAt: '2026-03-01T00:00:00Z',
    closesAt: '2026-05-31T20:59:59Z',
    ...overrides,
  };
}

afterEach(cleanup);

describe('a collection header', () => {
  it('names the collection and shows the trail it sits in', () => {
    render(<CollectionHeader locale="en" copy={COPY} collection={collection()} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Spring 2026' })).toBeInTheDocument();

    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Collections' })).toHaveAttribute('href', '/en/collections');
  });

  it('prints the curator’s standfirst rather than paraphrasing it', () => {
    render(<CollectionHeader locale="en" copy={COPY} collection={collection()} />);

    expect(screen.getByText('Applications for the spring programme.')).toBeInTheDocument();
  });

  it('says what an open call is, because it is the one kind a creator can act on', () => {
    render(<CollectionHeader locale="en" copy={COPY} collection={collection()} />);

    expect(screen.getByText(/programme campaigns can be submitted to/u)).toBeInTheDocument();
  });

  it('states the closing date, machine-readable, and never as a countdown', () => {
    render(<CollectionHeader locale="en" copy={COPY} collection={collection()} />);

    expect(screen.getByText('Closes')).toBeInTheDocument();

    const closing = screen.getByText('31 May 2026');
    expect(closing.tagName).toBe('TIME');
    expect(closing).toHaveAttribute('datetime', '2026-05-31T20:59:59Z');

    // No "closes in 3 days" anywhere: this response may be a minute old.
    expect(screen.queryByText(/closes in/iu)).toBeNull();
  });

  it('states the collection’s own size as text', () => {
    render(<CollectionHeader locale="en" copy={COPY} collection={collection({ projectCount: 3 })} />);

    expect(screen.getByText('3 campaigns')).toBeInTheDocument();
  });

  it('says nothing about a window a standing collection does not have', () => {
    render(
      <CollectionHeader
        locale="en"
        copy={COPY}
        collection={collection({ kind: 'staff_selection', opensAt: null, closesAt: null })}
      />,
    );

    expect(screen.queryByText('Closes')).toBeNull();
    expect(screen.queryByText('Open since')).toBeNull();
  });
});

describe('the editorial badge', () => {
  it('is stated in words when membership grants it', () => {
    render(<CollectionHeader locale="en" copy={COPY} collection={collection({ grantsBadge: true })} />);

    expect(screen.getByText(/carry the IdeyaNest editorial badge/u)).toBeInTheDocument();
  });

  it('says nothing when it does not', () => {
    render(<CollectionHeader locale="en" copy={COPY} collection={collection({ grantsBadge: false })} />);

    expect(screen.queryByText(/editorial badge/u)).toBeNull();
  });
});

describe('the cover', () => {
  it('is decorative, so a screen reader does not read out a file name', () => {
    const { container } = render(
      <CollectionHeader
        locale="en"
        copy={COPY}
        collection={collection({
          image: { url: 'https://example.test/cover.jpg', width: 1600, height: 900 },
        })}
      />,
    );

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute('alt', '');
  });

  it('is simply absent when there is none, rather than a broken element', () => {
    const { container } = render(<CollectionHeader locale="en" copy={COPY} collection={collection()} />);

    expect(container.querySelector('img')).toBeNull();
  });
});
