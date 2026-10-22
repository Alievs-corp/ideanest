import { colors as darkTokens, lightColors } from '@ideanest/design-tokens';
import { memoryStore } from '../lib/storage';
import { chooseTheme, readStoredTheme, takeThemeReturn } from '../lib/theme-preference';
import { darkColors, paletteFor } from './index';

jest.mock('expo-updates', () => ({ reloadAsync: jest.fn(() => Promise.resolve()) }));

/** The light theme on the phone — docs/ui-kit.md §11. Contrast of the light set is measured on the web. */

describe('paletteFor', () => {
  it('draws the dark theme from the token file unchanged', () => {
    expect(paletteFor('dark')).toMatchObject(darkTokens);
    expect(paletteFor('dark').inverse).toBe(darkTokens.whiteSurface);
    expect(paletteFor('dark').limeInk).toBe(darkTokens.lime500);
  });

  it('takes the canvas, the inks and the status hues from the light set', () => {
    const light = paletteFor('light');
    expect(light.surface1).toBe(lightColors.surface1);
    expect(light.textPrimary).toBe(lightColors.textPrimary);
    expect(light.textSecondary).toBe(lightColors.textSecondary);
    expect(light.danger).toBe(lightColors.danger);
    expect(light.textOnDanger).toBe(lightColors.textOnDanger);
    expect(light.inverse).toBe(lightColors.inverse);
    expect(light.limeInk).toBe(lightColors.limeInk);
    expect(light.focusRing).toBe(lightColors.focusRing);
  });

  it('keeps what looks the same in both themes', () => {
    const light = paletteFor('light');
    for (const name of ['lime500', 'whiteSurface', 'whiteMuted', 'textOnWhite', 'textOnLime', 'black'] as const) {
      expect(light[name]).toBe(darkTokens[name]);
    }
  });

  it('exports the dark set for surfaces that are dark on purpose', () => {
    expect(darkColors).toEqual(paletteFor('dark'));
  });
});

describe('the stored choice', () => {
  it('is dark until light is chosen, and forgets light when dark is chosen again', () => {
    const store = memoryStore();
    expect(readStoredTheme(store)).toBe('dark');

    chooseTheme('light', '/settings/language', store);
    expect(readStoredTheme(store)).toBe('light');

    chooseTheme('dark', null, store);
    expect(readStoredTheme(store)).toBe('dark');
    expect(store.getAllKeys()).not.toContain('theme');
  });

  it('opens the screen it was switched from once, and only once', () => {
    const store = memoryStore();
    chooseTheme('light', '/me', store);
    expect(takeThemeReturn(store)).toBe('/me');
    expect(takeThemeReturn(store)).toBeNull();
  });

  it('does not record Home, which a restart opens anyway', () => {
    const store = memoryStore();
    chooseTheme('light', '/', store);
    expect(takeThemeReturn(store)).toBeNull();
  });
});
