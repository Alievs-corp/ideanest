import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import { AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES } from './audit';

/**
 * Every action the service records has words on the audit trail, in all four languages.
 *
 * <p>The trail falls back to an action's wire spelling when the catalogue has no label for it,
 * which is the right failure for a row nobody taught the screen about — and it is also how
 * twenty-seven actions reached an Azerbaijani reader as `compliance.payout_destination_read`.
 * This reads `AuditAction.java` itself, so an action another change adds is checked the moment
 * it exists, without anybody remembering to list it here.
 */

const ENUM = resolve(process.cwd(), '../api/src/main/java/az/ideanest/audit/AuditAction.java');

/** `PROJECT_APPROVED("project.approved", "project"),` — every constant, with its two strings. */
function writtenPairs(): readonly { readonly action: string; readonly entityType: string }[] {
  const source = readFileSync(ENUM, 'utf8');
  const pairs: { action: string; entityType: string }[] = [];
  for (const match of source.matchAll(/^\s*[A-Z][A-Z0-9_]*\("([a-z0-9_.]+)",\s*"([a-z0-9_]+)"\)\s*[,;]/gm)) {
    pairs.push({ action: match[1] as string, entityType: match[2] as string });
  }
  return pairs;
}

interface AuditCatalogue {
  readonly action: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly entity: Readonly<Record<string, string>>;
  readonly entityOne: Readonly<Record<string, string>>;
  readonly actorType: Readonly<Record<string, string>>;
}

const CATALOGUES = { az, en, ru, tr } as const;

function auditOf(catalogue: unknown): AuditCatalogue {
  return (catalogue as { admin: { screens: { audit: AuditCatalogue } } }).admin.screens.audit;
}

function label(audit: AuditCatalogue, action: string): string | undefined {
  const dot = action.indexOf('.');
  return audit.action[action.slice(0, dot)]?.[action.slice(dot + 1)];
}

describe('the audit trail’s words', () => {
  const pairs = writtenPairs();

  it('finds the actions in the enum, so the checks below are about something', () => {
    // A regex that silently stopped matching would make every assertion below vacuous.
    expect(pairs.length).toBeGreaterThan(90);
    expect(pairs).toContainEqual({ action: 'project.approved', entityType: 'project' });
  });

  for (const [language, catalogue] of Object.entries(CATALOGUES)) {
    const audit = auditOf(catalogue);

    it(`labels every action the service records, in ${language}`, () => {
      const missing = pairs.filter(({ action }) => {
        const words = label(audit, action);
        return words === undefined || words.trim() === '';
      });
      expect(missing.map(({ action }) => action)).toEqual([]);
    });

    it(`names every kind of thing the service records, as a chip and as a row, in ${language}`, () => {
      const kinds = [...new Set(pairs.map(({ entityType }) => entityType))];
      expect(kinds.filter((kind) => !audit.entity[kind])).toEqual([]);
      expect(kinds.filter((kind) => !audit.entityOne[kind])).toEqual([]);
    });

    it(`names every kind of actor, in ${language}`, () => {
      expect(AUDIT_ACTOR_TYPES.filter((type) => !audit.actorType[type])).toEqual([]);
    });
  }

  it('offers a chip for exactly the kinds the service records', () => {
    const kinds = new Set(pairs.map(({ entityType }) => entityType));
    expect([...AUDIT_ENTITY_TYPES].sort()).toEqual([...kinds].sort());
  });
});
