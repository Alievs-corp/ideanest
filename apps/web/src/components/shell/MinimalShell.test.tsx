import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FailureAction, FailureState } from './FailureState';
import { MinimalShell } from './MinimalShell';
import { MAIN_CONTENT_ID } from './SkipLink';
import en from '../../../messages/en.json';

const FAILURE_COPY = {
  elsewhere: en.shell.failure.elsewhere,
  links: en.shell.failure.links,
};

/**
 * The minimal frame and the skip link inside it — §4.13 WS-01 and WS-09.
 *
 * **The skip link is not optional and it is part of this component** (docs/ui-kit.md §8.6).
 * The assertions below are the three things that make one work, and every one of them is
 * invisible in a screenshot:
 *
 *   1. it is the FIRST focusable element in the document. Second is useless.
 *   2. it points at the page's one `<main>`.
 *   3. that `<main>` is focusable. A fragment link scrolls to an element but does not move
 *      focus into it unless the element can take focus — which is the failure that makes
 *      people believe skip links do not work.
 *
 * The frame also has to have exactly one `<main>`: a second landmark is not a duplicate so
 * much as an ambiguous one, and "jump to main" becomes a question with two answers.
 */

afterEach(cleanup);

function renderShell() {
  return render(
    <MinimalShell skipToContent={en.shell.skipToContent} footer={<p>A footer line</p>}>
      <FailureState
        copy={FAILURE_COPY}
        title="There is nothing at this address"
        description={<p>Try somewhere else.</p>}
        action={<FailureAction href="/">Go to the home page</FailureAction>}
      />
    </MinimalShell>,
  );
}

describe('the skip link', () => {
  it('is the first thing Tab reaches', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.tab();

    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to content' }));
  });

  it('points at the page’s main content', () => {
    renderShell();

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      `#${MAIN_CONTENT_ID}`,
    );
  });

  it('is aimed at an element that can actually take focus', () => {
    renderShell();

    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', MAIN_CONTENT_ID);
    expect(main).toHaveAttribute('tabindex', '-1');
  });
});

describe('the frame', () => {
  it('has exactly one main landmark', () => {
    renderShell();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('offers a way home from the wordmark', () => {
    renderShell();
    expect(screen.getByRole('link', { name: 'IdeyaNest' })).toHaveAttribute('href', '/en');
  });

  it('renders no footer when it was given none', () => {
    render(
      <MinimalShell skipToContent={en.shell.skipToContent}>
        <p>Body</p>
      </MinimalShell>,
    );
    expect(screen.queryByRole('contentinfo')).toBeNull();
  });
});

describe('a failure state', () => {
  it('says what happened as a heading, and never a status code', () => {
    renderShell();

    expect(
      screen.getByRole('heading', { level: 1, name: 'There is nothing at this address' }),
    ).toBeInTheDocument();
    // A "404" printed on a page is what makes a crawler index an error, and this page's status
    // is Next's to set.
    expect(screen.queryByText(/404|500/u)).toBeNull();
  });

  it('is not a dead end', () => {
    renderShell();

    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/en');
    const elsewhere = screen.getByRole('navigation', { name: 'Elsewhere on IdeyaNest' });
    expect(elsewhere).toBeInTheDocument();
  });

  it('hides the elsewhere links when the page exists because everything is unavailable', () => {
    render(
      <MinimalShell skipToContent={en.shell.skipToContent}>
        <FailureState
        copy={FAILURE_COPY}
          showLinks={false}
          title="IdeyaNest is down for a short while"
          description={<p>Planned maintenance.</p>}
          action={<FailureAction href="/">Try the home page</FailureAction>}
        />
      </MinimalShell>,
    );

    // Offering "Browse campaigns" from a maintenance page is an invitation into the outage.
    expect(screen.queryByRole('navigation', { name: 'Elsewhere on IdeyaNest' })).toBeNull();
  });
});
