import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HeroPhoneScene, HeroScene } from './HeroScene';
import { HeroSceneDrawing } from './HeroSceneDrawing';

afterEach(cleanup);

const CAPTION = 'Kiçik dəstəklər birləşəndə böyük ideyalar reallaşır.';
const LINES = [
  'Müəllif ideyasını hədəf və son tarixlə paylaşır',
  'Dəstəkçilər hər tərəfdən qoşulur',
  'Hədəfin 80%-i toplananda kampaniya uğurlu sayılır',
  CAPTION,
] as const;

describe('HeroScene (#337, #490)', () => {
  it('hides the picture from assistive technology and keeps the caption as text', () => {
    render(<HeroScene caption={CAPTION} />);

    expect(screen.getByTestId('hero-scene')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(CAPTION).tagName).toBe('FIGCAPTION');
  });

  it('plays a video loop, and fetches nothing but its poster from the markup', () => {
    const { container } = render(<HeroScene caption={CAPTION} />);
    const video = container.querySelector('video');

    expect(video).toHaveAttribute('preload', 'none');
    expect(video).toHaveAttribute('poster', expect.stringMatching(/\.webp$/));
    expect(video).not.toHaveAttribute('src');
  });
});

describe('HeroSceneDrawing, the source of the loops (#337)', () => {
  it('starts every animation only for a reader who has not asked for reduced motion', () => {
    const { container } = render(<HeroSceneDrawing className="" />);
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
    const { container } = render(<HeroSceneDrawing className="" />);
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

describe('HeroPhoneScene (#490)', () => {
  it('is decoration, with every line on its own beat', () => {
    const { container } = render(<HeroPhoneScene lines={LINES} />);
    const lines = [...container.querySelectorAll('p')];

    expect(screen.getByTestId('hero-phone-scene')).toHaveAttribute('aria-hidden', 'true');
    expect(lines.map((line) => line.textContent)).toEqual([...LINES]);
    lines.forEach((line, index) => {
      expect(line).toHaveStyle({ animationDelay: `${index * 3.2}s` });
    });
  });

  it('animates only under motion-safe, and leaves the last line standing under reduced motion', () => {
    const { container } = render(<HeroPhoneScene lines={LINES} />);

    for (const element of container.querySelectorAll('[class*="animate-"]')) {
      const classes = element.getAttribute('class') ?? '';
      expect(classes.match(/(^|\s)animate-/), classes).toBeNull();
    }
    const standing = [...container.querySelectorAll('p')]
      .filter((line) => line.className.includes('motion-reduce:opacity-100'))
      .map((line) => line.textContent);
    expect(standing).toEqual([CAPTION]);
  });

  it('names only literal keyframes that exist', () => {
    const css = readFileSync(join(import.meta.dirname, '../../app/globals.css'), 'utf8');
    const { container } = render(<HeroPhoneScene lines={LINES} />);
    const used = new Set(
      [...container.innerHTML.matchAll(/animate-\[(hero-[a-z-]+)_/g)].map(([, name]) => name),
    );

    expect(used).toContain('hero-line');
    for (const name of used) {
      const block = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`).exec(css);
      expect(block, `@keyframes ${name}`).not.toBeNull();
      expect(block?.[1]).not.toMatch(/var\(|calc\(/);
    }
  });
});
