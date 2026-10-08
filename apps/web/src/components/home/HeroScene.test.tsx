import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HeroScene } from './HeroScene';

afterEach(cleanup);

const CAPTION = 'Kiçik dəstəklər birləşəndə böyük ideyalar reallaşır.';

describe('HeroScene (#337)', () => {
  it('hides the picture from assistive technology and keeps the caption as text', () => {
    render(<HeroScene caption={CAPTION} />);

    expect(screen.getByTestId('hero-scene')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(CAPTION).tagName).toBe('FIGCAPTION');
  });

  it('starts every animation only for a reader who has not asked for reduced motion', () => {
    const { container } = render(<HeroScene caption={CAPTION} />);
    const animated = [...container.querySelectorAll('[class*="animate-"]')];

    expect(animated.length).toBeGreaterThan(40);
    for (const element of animated) {
      const classes = element.getAttribute('class') ?? '';
      expect(classes.match(/(^|\s)animate-/), classes).toBeNull();
      expect(classes).toMatch(/motion-safe:animate-\[hero-/);
    }
  });

  it('names only keyframes that exist, and keeps every keyframe literal', () => {
    const css = readFileSync(join(import.meta.dirname, '../../app/globals.css'), 'utf8');
    const { container } = render(<HeroScene caption={CAPTION} />);
    const used = new Set(
      [...container.innerHTML.matchAll(/animate-\[(hero-[a-z-]+)_/g)].map(([, name]) => name),
    );

    expect(used.size).toBeGreaterThan(8);
    for (const name of used) {
      const block = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`).exec(css);
      expect(block, `@keyframes ${name}`).not.toBeNull();
      // A variable or calc() inside a keyframe takes the animation off the compositor.
      expect(block?.[1]).not.toMatch(/var\(|calc\(/);
    }
  });
});
