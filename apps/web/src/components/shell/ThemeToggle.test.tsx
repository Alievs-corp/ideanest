import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { shellCopyFrom } from '../../lib/i18n/shell-copy';
import { THEME_STORAGE_KEY } from '../../lib/theme/theme';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';
import { ConsoleTheme } from '../admin/ConsoleTheme';
import { ThemeToggle } from './ThemeToggle';

/** The theme control and the console's hold on dark — docs/ui-kit.md §11. */

const copy = shellCopyFrom(translatorFor('shell')).theme;

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('ThemeToggle', () => {
  it('offers the light theme from the dark default and remembers the choice', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle copy={copy} />);

    await user.click(screen.getByRole('button', { name: copy.toLight }));

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(screen.getByRole('button', { name: copy.toDark })).toBeInTheDocument();
  });

  it('goes back to dark and forgets the choice, since dark is the default', async () => {
    const user = userEvent.setup();
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    document.documentElement.dataset.theme = 'light';
    render(<ThemeToggle copy={copy} />);

    await user.click(screen.getByRole('button', { name: copy.toDark }));

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('switches from the drawer row’s word, which leads the row’s name', async () => {
    const user = userEvent.setup();
    const view = render(<ThemeToggle copy={copy} row />);

    expect(screen.getByRole('button', { name: `${copy.label}: ${copy.toLight}` })).toBeInTheDocument();
    await user.click(screen.getByText(copy.label));

    expect(document.documentElement.dataset.theme).toBe('light');
    await expectNoViolations(view.container);
  });

  it('follows a change made in another tab', () => {
    render(<ThemeToggle copy={copy} />);

    act(() => {
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
    });

    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<ThemeToggle copy={copy} />);
    await expectNoViolations(container);
  });
});

describe('ConsoleTheme', () => {
  it('holds the page dark while mounted and gives the reader their theme back after', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    document.documentElement.dataset.theme = 'light';

    const { unmount } = render(<ConsoleTheme />);
    expect(document.documentElement.dataset.theme).toBeUndefined();

    unmount();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
