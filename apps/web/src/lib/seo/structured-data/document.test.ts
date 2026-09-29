import { describe, expect, it } from 'vitest';

import { SCHEMA_CONTEXT, serialiseStructuredData, withoutAbsent } from './document';

/**
 * The envelope and the escaping.
 *
 * Everything else in this directory decides WHAT to claim; this decides how the
 * claim reaches the document without taking the document with it.
 */

describe('serialiseStructuredData', () => {
  it('puts every node in one graph under one context', () => {
    const json = serialiseStructuredData([
      { '@type': 'Organization', name: 'IdeyaNest' },
      { '@type': 'WebSite', name: 'IdeyaNest' },
    ]);

    expect(JSON.parse(json ?? '')).toEqual({
      '@context': SCHEMA_CONTEXT,
      '@graph': [
        { '@type': 'Organization', name: 'IdeyaNest' },
        { '@type': 'WebSite', name: 'IdeyaNest' },
      ],
    });
  });

  it('is null when there is nothing to claim, so no empty block is written', () => {
    expect(serialiseStructuredData([])).toBeNull();
  });

  it('escapes every `<`, so a title carrying a closing tag cannot end the block', () => {
    const json = serialiseStructuredData([
      { '@type': 'Product', name: '</script><img src=x onerror=alert(1)>' },
    ]);

    expect(json).not.toContain('<');
    expect(json).toContain('\\u003c');
  });

  it('escapes without changing what the value says', () => {
    const name = '</script> <!-- 1 < 2 & 3 > 2';
    const json = serialiseStructuredData([{ '@type': 'Product', name }]);

    const parsed = JSON.parse(json ?? '') as { '@graph': readonly { name: string }[] };
    expect(parsed['@graph'][0]?.name).toBe(name);
  });
});

describe('withoutAbsent', () => {
  it('drops the properties that have no value', () => {
    expect(withoutAbsent({ name: 'IdeyaNest', description: undefined })).toEqual({
      name: 'IdeyaNest',
    });
  });

  it('keeps a property whose value is falsy but stated', () => {
    expect(withoutAbsent({ position: 0, isAccessibleForFree: false, name: '' })).toEqual({
      position: 0,
      isAccessibleForFree: false,
      name: '',
    });
  });
});
