import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = import.meta.dirname;

function files(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) files(full, found);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

describe('the film source', () => {
  it('takes every colour from @ideanest/design-tokens', () => {
    const offenders = files(SOURCE).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, at: `${relative(SOURCE, file)}:${i + 1}` }))
        .filter(({ line }) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(line))
        .map(({ at, line }) => `${at}  ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it('uses lime in exactly one place, the call to action', () => {
    const uses = files(SOURCE).flatMap((file) =>
      (readFileSync(file, 'utf8').match(/\blime\d{3}\b|\blimeGlow\b|\btextOnLime\b/g) ?? []).map(() =>
        relative(SOURCE, file).split(sep).join('/'),
      ),
    );
    expect(new Set(uses)).toEqual(new Set(['scenes/Finale.tsx']));
  });
});
